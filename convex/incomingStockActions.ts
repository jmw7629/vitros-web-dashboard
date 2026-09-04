// Server-authoritative Incoming Stock OCR review boundary.
// This module validates OCR output and resolves inventory matches by canonical part number only.
// It performs NO inventory mutation; human confirmation and the existing atomic RECEIVE path remain separate.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

const MAX_OCR_JSON_CHARS = 256_000;
const MAX_LINES = 500;
const MAX_DOCUMENT_REF_CHARS = 200;

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
  // Part-number identity is intentionally conservative. Preserve meaningful internal
  // punctuation/hyphens/digits; normalize only surrounding whitespace and case.
  return value.trim().toUpperCase();
}

function parseOcrArray(raw: string): unknown[] {
  if (!raw.trim()) return [];
  if (raw.length > MAX_OCR_JSON_CHARS) {
    throw new Error("OCR result is too large");
  }

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

  if (!Array.isArray(parsed)) {
    throw new Error("OCR result must be a JSON array");
  }
  if (parsed.length > MAX_LINES) {
    throw new Error(`OCR result exceeds ${MAX_LINES} lines`);
  }
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

export const reviewPackingListDraft = action({
  args: {
    ocrJson: v.string(),
    documentRef: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { ocrJson, documentRef }) => {
    // Receiving review is an inventory workflow. Authorization is resolved server-side;
    // the browser never supplies role or actor identity.
    await requireCapability(ctx, "inventory.write");

    if ((documentRef?.length ?? 0) > MAX_DOCUMENT_REF_CHARS) {
      throw new Error("Document reference is too long");
    }

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
      const qtyNumber = asFiniteNumber(obj.qty ?? obj.quantity ?? obj.shippedQuantity ?? obj.shipped_quantity);
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
        matchStatus = matches.length === 1
          ? "matched"
          : matches.length === 0
            ? "unknown_part"
            : "ambiguous_part";
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
      {
        total: 0,
        matched: 0,
        unknown_part: 0,
        ambiguous_part: 0,
        invalid_part_number: 0,
        invalid_quantity: 0,
      } as Record<"total" | MatchStatus, number>,
    );

    return {
      documentRef: documentRef?.trim() || null,
      requiresHumanConfirmation: true,
      identityRule: "canonical_part_number_only",
      descriptionUsedForIdentity: false,
      lines,
      summary,
    };
  },
});
