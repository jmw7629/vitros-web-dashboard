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
const STOCK_LOOKUP_PAGE_SIZE = 1_000;
const MAX_STOCK_LOOKUP_ROWS = 100_000;

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
  const rows: StockRow[] = [];
  for (let offset = 0; offset < MAX_STOCK_LOOKUP_ROWS; offset += STOCK_LOOKUP_PAGE_SIZE) {
    const res = await fetch(
      `${url}/rest/v1/stock?select=id,part_number,description,qty_on_hand&order=id.asc&limit=${STOCK_LOOKUP_PAGE_SIZE}&offset=${offset}`,
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
    if (rows.length + body.length > MAX_STOCK_LOOKUP_ROWS)
      throw new Error("Inventory match lookup exceeds supported row limit");
    rows.push(...(body as StockRow[]));
    if (body.length < STOCK_LOOKUP_PAGE_SIZE) return rows;
  }
  throw new Error("Inventory match lookup exceeds supported row limit");
}

class ReceiptRpcHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Receipt recovery request failed (${status})`);
    this.status = status;
  }
}

async function callReceiptRpc(
  url: string,
  serviceKey: string,
  rpc: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Receipt recovery transport is uncertain");
  }
  if (!response.ok) {
    // Never parse/reflect provider diagnostics. Status is sufficient for a safe operator error.
    throw new ReceiptRpcHttpError(response.status);
  }
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Receipt recovery returned an invalid response");
  return payload as Record<string, unknown>;
}

function requiredAttemptId(payload: Record<string, unknown>) {
  const value = payload.attemptId;
  if (typeof value !== "string" || !value.trim())
    throw new Error("Receipt recovery returned an invalid attempt identity");
  return value;
}

function requiredRevision(payload: Record<string, unknown>) {
  const value = payload.revision;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new Error("Receipt recovery returned an invalid revision");
  return value;
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
    const actor = String(actorId);
    const reviewed = await callReceiptRpc(url, serviceKey, "register_incoming_receipt_review", {
      p_actor: actor,
      p_document_ref: documentRef,
      p_source_page: args.sourcePage?.trim() || null,
      p_source_line_no: args.sourceLineNo,
      p_part_number: match.part_number,
      p_qty: args.qty,
      p_correlation_id: correlationId,
      p_batch_id: normalizedBatchRef,
    });
    const attemptId = requiredAttemptId(reviewed);
    const reviewedState = String(reviewed.state ?? "");
    if (reviewedState === "conflict")
      throw new Error("Receipt attempt conflicts with an earlier reviewed request");

    let attempt = reviewed;
    if (reviewedState !== "accepted") {
      try {
        attempt = await callReceiptRpc(url, serviceKey, "execute_incoming_receipt_attempt", {
          p_attempt_id: attemptId,
          p_actor: actor,
          p_expected_revision: requiredRevision(reviewed),
        });
      } catch (error) {
        if (error instanceof ReceiptRpcHttpError) {
          throw new Error(`Receive failed (${error.status})`);
        }
        try {
          const reconciled = await callReceiptRpc(url, serviceKey, "mark_incoming_receipt_attempt_unknown", {
            p_attempt_id: attemptId,
            p_actor: actor,
          });
          if (String(reconciled.state ?? "") === "accepted") attempt = reconciled;
          else throw new Error("Receipt result is uncertain. Reload Incoming Stock to reconcile this exact receipt before retrying or changing its reference.");
        } catch (reconcileError) {
          if (String((reconcileError as Error)?.message ?? "").includes("Receipt result is uncertain")) throw reconcileError;
          throw new Error("Receipt result is uncertain. Reload Incoming Stock to reconcile this exact receipt before retrying or changing its reference.");
        }
      }
    }
    if (String(attempt.state ?? "") !== "accepted" || !attempt.receipt || typeof attempt.receipt !== "object")
      throw new Error("Receipt result is uncertain. Reload Incoming Stock to reconcile this exact receipt before retrying or changing its reference.");
    const receipt = attempt.receipt as Record<string, unknown>;
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
      attemptId,
      attemptRevision: attempt.revision,
      receipt,
    };
  },
});


export const getIncomingReceiptRecovery = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const actorId = await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    let response: Response;
    try {
      response = await fetch(`${url}/rest/v1/rpc/list_incoming_receipt_recovery`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_actor: String(actorId) }),
      });
    } catch {
      throw new Error("Receipt recovery is temporarily unavailable");
    }
    if (!response.ok) throw new Error(`Receipt recovery failed (${response.status})`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("Receipt recovery returned an invalid response");
    return payload;
  },
});

export const acknowledgeIncomingReceiptAttempt = action({
  args: { attemptId: v.string() },
  returns: v.any(),
  handler: async (ctx, { attemptId }) => {
    const actorId = await requireCapability(ctx, "inventory.write");
    if (!attemptId.trim()) throw new Error("Receipt attempt identity is required");
    const { url, serviceKey } = getSupabaseConfig();
    return callReceiptRpc(url, serviceKey, "acknowledge_incoming_receipt_attempt", {
      p_attempt_id: attemptId,
      p_actor: String(actorId),
    });
  },
});

export const reserveIncomingManualReceiptReview = action({
  args: {
    documentRef: v.string(),
    partNumber: v.string(),
    qty: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, { documentRef, partNumber, qty }) => {
    const actorId = await requireCapability(ctx, "inventory.write");
    const boundedRef = documentRef.trim();
    const canonical = canonicalPartNumber(partNumber);
    if (!boundedRef) throw new Error("Document reference is required for manual receipt identity");
    if (boundedRef.length > MAX_DOCUMENT_REF_CHARS) throw new Error("Document reference is too long");
    if (!canonical) throw new Error("Part number is required");
    if (!Number.isInteger(qty) || qty <= 0) throw new Error("Receive quantity must be a positive integer");

    const { url, serviceKey } = getSupabaseConfig();
    const stockRows = await listStockRows(url, serviceKey);
    const matches = indexStockByCanonical(stockRows).get(canonical) ?? [];
    if (matches.length === 0) throw new Error("Confirmed part is not present in inventory");
    if (matches.length > 1) throw new Error("Confirmed part number is ambiguous and cannot be received");
    const match = matches[0];

    const attempt = await callReceiptRpc(url, serviceKey, "reserve_incoming_manual_receipt_review", {
      p_actor: String(actorId),
      p_document_ref: boundedRef,
      p_part_number: match.part_number,
      p_qty: qty,
    });
    const attemptId = requiredAttemptId(attempt);
    const revision = requiredRevision(attempt);
    const sourceLineNo = Number(attempt.sourceLineNo);
    const correlationId = String(attempt.correlationId ?? "");
    if (!Number.isSafeInteger(sourceLineNo) || sourceLineNo <= 0 || sourceLineNo > MAX_LINES || !correlationId) {
      throw new Error("Manual receipt identity returned an invalid reservation");
    }
    return {
      ...attempt,
      attemptId,
      revision,
      sourceLineNo,
      correlationId,
      documentRef: boundedRef,
      sourcePage: "MANUAL",
      partNumber: match.part_number,
      canonicalPartNumber: canonical,
      stockId: match.id,
      stockDescription: match.description ?? null,
      qtyOnHand: match.qty_on_hand ?? null,
      qty,
      requiresHumanConfirmation: true,
    };
  },
});

export const resolveIncomingReceiptAttempt = action({
  args: { attemptId: v.string(), expectedRevision: v.number() },
  returns: v.any(),
  handler: async (ctx, { attemptId, expectedRevision }) => {
    const actorId = await requireCapability(ctx, "inventory.write");
    if (!attemptId.trim()) throw new Error("Receipt attempt identity is required");
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) throw new Error("Receipt attempt revision is invalid");
    const { url, serviceKey } = getSupabaseConfig();
    try {
      return await callReceiptRpc(url, serviceKey, "resolve_incoming_receipt_attempt", {
        p_attempt_id: attemptId,
        p_actor: String(actorId),
        p_expected_revision: expectedRevision,
      });
    } catch (error) {
      if (error instanceof ReceiptRpcHttpError) {
        throw new Error("Receipt conflict cannot be resolved safely. Reload Incoming Stock and reconcile the authoritative attempt before retrying.");
      }
      throw error;
    }
  },
});
