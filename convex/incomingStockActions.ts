// Server-authoritative Incoming Stock OCR review + confirmed RECEIVE boundary.
// OCR matching is canonical part-number only; inventory mutation is allowed only after an
// explicit human-confirmed line is submitted through the atomic inventory transition RPC.
// Deterministic receipt-line identity: documentRef + sourcePage + sourceLineNo (normalized).
// Random confirmation IDs are presentation keys only; they are not authoritative for idempotency.
// All parse/validate/match/aggregate/provenance logic lives in the side-effect-free
// ./incomingStockReview module; this file owns only auth, stock lookup and writes.

import { v } from "convex/values";
import { action } from "./_generated/server";
import { requireCapability } from "./authGuard";
import {
  canonicalPartNumber,
  canonicalReceiptLineIdentity,
  MAX_DOCUMENT_REF_CHARS,
  MAX_SOURCE_PAGE_CHARS,
  normalizeDocumentRef,
} from "./incomingStockDeterministicIdentity";
import {
  computeAggregateSummary,
  computeSummary,
  indexStockByCanonical,
  MAX_LINES,
  parseOcrArray,
  reviewOcrLines,
  type StockRow,
} from "./incomingStockReview";
import { publishRealtimePulse } from "./realtimePulsePublisher";

declare const process: { env: Record<string, string | undefined> };

const MAX_CONFIRMATION_ID_CHARS = 180;

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    throw new Error("Server inventory configuration is unavailable");
  return { url, serviceKey };
}

async function listStockRows(
  url: string,
  serviceKey: string,
): Promise<StockRow[]> {
  const res = await fetch(
    `${url}/rest/v1/stock?select=id,part_number,description,qty_on_hand&limit=5000`,
    {
      method: "GET",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
      },
    },
  );
  if (!res.ok) throw new Error("Inventory match lookup failed");
  const body = await res.json();
  if (!Array.isArray(body))
    throw new Error("Inventory match lookup returned an invalid response");
  return body as StockRow[];
}

async function applyConfirmedReceive(
  url: string,
  serviceKey: string,
  args: {
    partNumber: string;
    qty: number;
    actor: string;
    correlationId: string;
    batchId?: string;
  },
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${url}/rest/v1/rpc/apply_inventory_transition`,
    {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_part_number: args.partNumber,
        p_mode: "RECEIVE",
        p_qty: args.qty,
        p_user: args.actor,
        p_correlation_id: args.correlationId,
        p_analyzer_serial: null,
        p_batch_id: args.batchId ?? null,
      }),
    },
  );

  if (!response.ok) {
    // The PostgREST/RPC response body is provider-controlled and can contain schema,
    // constraint, policy, SQL, or other internal diagnostics. Keep browser-visible
    // failures status-only and never parse or reflect the provider error payload.
    throw new Error(`Receive failed (${response.status})`);
  }

  const body = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Receive returned an invalid receipt");
  return body as Record<string, unknown>;
}

export const reviewPackingListDraft = action({
  args: {
    ocrJson: v.string(),
    documentRef: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { ocrJson, documentRef }) => {
    await requireCapability(ctx, "inventory.write");
    if ((documentRef?.length ?? 0) > MAX_DOCUMENT_REF_CHARS)
      throw new Error("Document reference is too long");

    const rawLines = parseOcrArray(ocrJson);
    const { url, serviceKey } = getSupabaseConfig();
    const stockRows = await listStockRows(url, serviceKey);
    const stockByCanonical = indexStockByCanonical(stockRows);

    const lines = reviewOcrLines(rawLines, stockByCanonical, documentRef);
    const summary = computeSummary(lines);
    const aggregateSummary = computeAggregateSummary(lines);

    return {
      documentRef: documentRef?.trim() || null,
      requiresHumanConfirmation: true,
      identityRule: "canonical_part_number_only",
      descriptionUsedForIdentity: false,
      quantityRule: "ship_qty_preferred",
      lines,
      summary,
      aggregateSummary,
    };
  },
});

export const commitConfirmedReceiveLine = action({
  args: {
    partNumber: v.string(),
    qty: v.number(),
    confirmationId: v.string(),
    documentRef: v.optional(v.string()),
    sourcePage: v.optional(v.string()),
    sourceLineNo: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "inventory.write");
    const canonical = canonicalPartNumber(args.partNumber);
    if (!canonical) throw new Error("Part number is required");
    if (!Number.isInteger(args.qty) || args.qty <= 0)
      throw new Error("Receive quantity must be a positive integer");
    if (
      !args.confirmationId.trim() ||
      args.confirmationId.length > MAX_CONFIRMATION_ID_CHARS
    )
      throw new Error("A bounded confirmation ID is required");
    // Deterministic identity requires a document reference. Fail closed if absent.
    if (!args.documentRef?.trim())
      throw new Error(
        "Document reference is required for deterministic receipt identity",
      );
    if ((args.documentRef.length ?? 0) > MAX_DOCUMENT_REF_CHARS)
      throw new Error("Document reference is too long");
    if (
      !Number.isInteger(args.sourceLineNo) ||
      args.sourceLineNo <= 0 ||
      args.sourceLineNo > MAX_LINES
    ) {
      throw new Error("Source line number is invalid");
    }
    if (args.sourcePage && args.sourcePage.length > MAX_SOURCE_PAGE_CHARS) {
      throw new Error("Source page is too long");
    }

    const { url, serviceKey } = getSupabaseConfig();
    const stockRows = await listStockRows(url, serviceKey);
    const stockByCanonical = indexStockByCanonical(stockRows);
    const matches = stockByCanonical.get(canonical) ?? [];
    if (matches.length === 0)
      throw new Error("Confirmed part is not present in inventory");
    if (matches.length > 1)
      throw new Error(
        "Confirmed part number is ambiguous and cannot be received",
      );

    const match = matches[0];
    const documentRef = args.documentRef.trim();
    // The user/display document reference stays as entered/trimmed, but the authoritative
    // correlation identity and the material request batch reference use the same normalized
    // document reference so that semantically equivalent retries are idempotent and
    // genuinely changed references still conflict. (matches the RPC IS DISTINCT FROM check)
    const normalizedBatchRef = normalizeDocumentRef(args.documentRef);
    const correlationId = canonicalReceiptLineIdentity({
      documentRef,
      sourcePage: args.sourcePage?.trim() || null,
      sourceLineNo: args.sourceLineNo,
    });
    const receipt = await applyConfirmedReceive(url, serviceKey, {
      partNumber: match.part_number,
      qty: args.qty,
      actor: String(actorId),
      correlationId,
      batchId: normalizedBatchRef,
    });
    await publishRealtimePulse(ctx);

    return {
      success: true,
      humanConfirmed: true,
      lineNo: args.sourceLineNo,
      documentRef,
      sourcePage: args.sourcePage?.trim() || null,
      sourceLineNo: args.sourceLineNo,
      canonicalPartNumber: canonical,
      resolvedPartNumber: match.part_number,
      stockId: match.id,
      qtyReceived: args.qty,
      correlationId,
      batchId: normalizedBatchRef,
      receipt,
    };
  },
});
