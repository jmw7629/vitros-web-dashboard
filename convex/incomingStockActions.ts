// Server-authoritative Incoming Stock OCR review + confirmed RECEIVE boundary.
// OCR matching is canonical part-number only; inventory mutation is allowed only after an
// explicit human-confirmed line is submitted through the atomic inventory transition RPC.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

const MAX_OCR_JSON_CHARS = 256_000;
const MAX_LINES = 500;
const MAX_DOCUMENT_REF_CHARS = 200;
const MAX_CONFIRMATION_ID_CHARS = 180;

type StockRow = {
  id: string;
  part_number: string;
  description?: string | null;
  qty_on_hand?: number | string | null;
};

type MatchStatus =
  | "matched"
  | "unknown_part"
  | "ambiguous_part"
  | "invalid_part_number"
  | "invalid_quantity";

function canonicalPartNumber(value: string): string {
  return value.trim().toUpperCase();
}

function parseOcrArray(raw: string): unknown[] {
  if (!raw.trim()) return [];
  if (raw.length > MAX_OCR_JSON_CHARS) throw new Error("OCR result is too large");

  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OCR result is not valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("OCR result must be a JSON array");
  if (parsed.length > MAX_LINES) throw new Error(`OCR result exceeds ${MAX_LINES} lines`);
  return parsed;
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Server inventory configuration is unavailable");
  return { url, serviceKey };
}

async function listStockRows(url: string, serviceKey: string): Promise<StockRow[]> {
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
  if (!Array.isArray(body)) throw new Error("Inventory match lookup returned an invalid response");
  return body as StockRow[];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function matchingCanonicalRows(stockRows: StockRow[], partNumber: string): StockRow[] {
  const canonical = canonicalPartNumber(partNumber);
  return stockRows.filter((row) => canonicalPartNumber(asString(row.part_number)) === canonical);
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
  const response = await fetch(`${url}/rest/v1/rpc/apply_inventory_transition`, {
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
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body && typeof body === "object"
      ? String((body as Record<string, unknown>).message ?? (body as Record<string, unknown>).error ?? "Receive failed")
      : "Receive failed";
    throw new Error(message);
  }

  const body = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Receive returned an invalid receipt");
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
    if ((documentRef?.length ?? 0) > MAX_DOCUMENT_REF_CHARS) throw new Error("Document reference is too long");

    const rawLines = parseOcrArray(ocrJson);
    const { url, serviceKey } = getSupabaseConfig();
    const stockRows = await listStockRows(url, serviceKey);

    const stockByCanonical = new Map<string, StockRow[]>();
    for (const row of stockRows) {
      const key = canonicalPartNumber(asString(row.part_number));
      if (!key) continue;
      const existing = stockByCanonical.get(key) ?? [];
      existing.push(row);
      stockByCanonical.set(key, existing);
    }

    const lines = rawLines.map((raw, index) => {
      const obj = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {};
      const partNumberOcr = asString(obj.partNumber ?? obj.part_number);
      const canonical = canonicalPartNumber(partNumberOcr);
      const descriptionOcr = asString(obj.description);
      // Packing-list receipt quantity is SHIP QTY when available. Generic qty is
      // accepted only as a fallback for document families that expose QTY/UNIT.
      const qtyNumber = asFiniteNumber(
        obj.shippedQuantity ?? obj.shipped_quantity ?? obj.shipQty ?? obj.ship_qty ?? obj.qty ?? obj.quantity,
      );
      const confidenceNumber = asFiniteNumber(obj.confidence);
      const confidence = confidenceNumber !== null && confidenceNumber >= 0 && confidenceNumber <= 1
        ? confidenceNumber
        : null;

      let matchStatus: MatchStatus;
      let matches: StockRow[] = [];
      if (!canonical) {
        matchStatus = "invalid_part_number";
      } else if (qtyNumber === null || !Number.isInteger(qtyNumber) || qtyNumber <= 0) {
        matchStatus = "invalid_quantity";
      } else {
        matches = stockByCanonical.get(canonical) ?? [];
        matchStatus = matches.length === 1 ? "matched" : matches.length === 0 ? "unknown_part" : "ambiguous_part";
      }

      const match = matchStatus === "matched" ? matches[0] : undefined;
      return {
        lineNo: index + 1,
        partNumberOcr,
        partNumberCanonical: canonical,
        descriptionOcr,
        qtyOcr: qtyNumber,
        confidence,
        matchStatus,
        resolvedPartNumber: match?.part_number ?? null,
        stockId: match?.id ?? null,
        stockDescription: match?.description ?? null,
        qtyOnHand: match ? Number(match.qty_on_hand ?? 0) : null,
      };
    });

    const summary = lines.reduce(
      (acc, line) => {
        acc.total += 1;
        acc[line.matchStatus] += 1;
        return acc;
      },
      { total: 0, matched: 0, unknown_part: 0, ambiguous_part: 0, invalid_part_number: 0, invalid_quantity: 0 } as Record<"total" | MatchStatus, number>,
    );

    return {
      documentRef: documentRef?.trim() || null,
      requiresHumanConfirmation: true,
      identityRule: "canonical_part_number_only",
      descriptionUsedForIdentity: false,
      quantityRule: "ship_qty_preferred",
      lines,
      summary,
    };
  },
});

export const commitConfirmedReceiveLine = action({
  args: {
    partNumber: v.string(),
    qty: v.number(),
    confirmationId: v.string(),
    documentRef: v.optional(v.string()),
    lineNo: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "inventory.write");
    const canonical = canonicalPartNumber(args.partNumber);
    if (!canonical) throw new Error("Part number is required");
    if (!Number.isInteger(args.qty) || args.qty <= 0) throw new Error("Receive quantity must be a positive integer");
    if (!args.confirmationId.trim() || args.confirmationId.length > MAX_CONFIRMATION_ID_CHARS) throw new Error("A bounded confirmation ID is required");
    if ((args.documentRef?.length ?? 0) > MAX_DOCUMENT_REF_CHARS) throw new Error("Document reference is too long");
    if (args.lineNo !== undefined && (!Number.isInteger(args.lineNo) || args.lineNo <= 0 || args.lineNo > MAX_LINES)) {
      throw new Error("Line number is invalid");
    }

    const { url, serviceKey } = getSupabaseConfig();
    const stockRows = await listStockRows(url, serviceKey);
    const matches = matchingCanonicalRows(stockRows, canonical);
    if (matches.length === 0) throw new Error("Confirmed part is not present in inventory");
    if (matches.length > 1) throw new Error("Confirmed part number is ambiguous and cannot be received");

    const match = matches[0];
    const documentRef = args.documentRef?.trim() || undefined;
    const correlationId = `incoming:${args.confirmationId.trim()}`;
    const receipt = await applyConfirmedReceive(url, serviceKey, {
      partNumber: match.part_number,
      qty: args.qty,
      actor: String(actorId),
      correlationId,
      batchId: documentRef,
    });

    return {
      success: true,
      humanConfirmed: true,
      lineNo: args.lineNo ?? null,
      documentRef: documentRef ?? null,
      canonicalPartNumber: canonical,
      resolvedPartNumber: match.part_number,
      stockId: match.id,
      qtyReceived: args.qty,
      correlationId,
      receipt,
    };
  },
});
