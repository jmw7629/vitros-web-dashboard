// Pure, side-effect-free packing-list review logic for Incoming Stock.
// Owns parse / validate / match / aggregate / provenance behavior for OCR review.
// No auth, no database, no network, no environment access: deterministic given inputs.
// Imported by the production action (after auth + stock lookup) and by acceptance harnesses.
import {
  canonicalPartNumber,
  canonicalReceiptLineIdentity,
} from "./incomingStockDeterministicIdentity";

export const MAX_OCR_JSON_CHARS = 256_000;
export const MAX_LINES = 500;

export type StockRow = {
  id: string;
  part_number: string;
  description?: string | null;
  qty_on_hand?: number | string | null;
};

export type MatchStatus =
  | "matched"
  | "unknown_part"
  | "ambiguous_part"
  | "invalid_part_number"
  | "invalid_quantity";

export type ReviewedLine = {
  lineNo: number;
  partNumberOcr: string;
  partNumberCanonical: string;
  descriptionOcr: string;
  qtyOcr: number | null;
  confidence: number | null;
  matchStatus: MatchStatus;
  resolvedPartNumber: string | null;
  stockId: string | null;
  stockDescription: string | null;
  qtyOnHand: number | null;
  sourcePage: string | null;
  sourceLineNo: number;
  deterministicIdentity: string | null;
};

export type ReviewSummary = Record<"total" | MatchStatus, number>;

export type AggregateEntry = {
  canonicalPartNumber: string;
  totalQty: number;
  lineCount: number;
  matchedCount: number;
};

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asFiniteNumber(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : null;
}

export function parseOcrArray(raw: string): unknown[] {
  if (!raw.trim()) return [];
  if (raw.length > MAX_OCR_JSON_CHARS)
    throw new Error("OCR result is too large");

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
  if (!Array.isArray(parsed))
    throw new Error("OCR result must be a JSON array");
  if (parsed.length > MAX_LINES)
    throw new Error(`OCR result exceeds ${MAX_LINES} lines`);
  return parsed;
}

export function indexStockByCanonical(
  stockRows: StockRow[],
): Map<string, StockRow[]> {
  const stockByCanonical = new Map<string, StockRow[]>();
  for (const row of stockRows) {
    const key = canonicalPartNumber(asString(row.part_number));
    if (!key) continue;
    const existing = stockByCanonical.get(key) ?? [];
    existing.push(row);
    stockByCanonical.set(key, existing);
  }
  return stockByCanonical;
}

export function reviewOcrLines(
  rawLines: unknown[],
  stockByCanonical: Map<string, StockRow[]>,
  documentRef: string | null | undefined,
): ReviewedLine[] {
  const effectiveDocRef = documentRef?.trim() || null;
  return rawLines.map((raw, index) => {
    const obj =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const partNumberOcr = asString(obj.partNumber ?? obj.part_number);
    const canonical = canonicalPartNumber(partNumberOcr);
    const descriptionOcr = asString(obj.description);
    // Packing-list receipt quantity is SHIP QTY when available. Generic qty is
    // accepted only as a fallback for document families that expose QTY/UNIT.
    const qtyNumber = asFiniteNumber(
      obj.shippedQuantity ??
        obj.shipped_quantity ??
        obj.shipQty ??
        obj.ship_qty ??
        obj.qty ??
        obj.quantity,
    );
    const confidenceNumber = asFiniteNumber(obj.confidence);
    const confidence =
      confidenceNumber !== null &&
      confidenceNumber >= 0 &&
      confidenceNumber <= 1
        ? confidenceNumber
        : null;

    // Provenance from OCR: page, lineNo
    const sourcePage = asString(obj.page);
    const sourceLineNo = asFiniteNumber(obj.lineNo ?? obj.line_no);

    let matchStatus: MatchStatus;
    let matches: StockRow[] = [];
    if (!canonical) {
      matchStatus = "invalid_part_number";
    } else if (
      qtyNumber === null ||
      !Number.isInteger(qtyNumber) ||
      qtyNumber <= 0
    ) {
      matchStatus = "invalid_quantity";
    } else {
      matches = stockByCanonical.get(canonical) ?? [];
      matchStatus =
        matches.length === 1
          ? "matched"
          : matches.length === 0
            ? "unknown_part"
            : "ambiguous_part";
    }

    const match = matchStatus === "matched" ? matches[0] : undefined;
    const deterministicIdentity = effectiveDocRef
      ? canonicalReceiptLineIdentity({
          documentRef: effectiveDocRef,
          sourcePage: sourcePage || null,
          sourceLineNo: sourceLineNo ?? index + 1,
        })
      : null;
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
      sourcePage: sourcePage || null,
      sourceLineNo: sourceLineNo ?? index + 1,
      deterministicIdentity,
    };
  });
}

export function computeSummary(lines: ReviewedLine[]): ReviewSummary {
  return lines.reduce(
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
    } as ReviewSummary,
  );
}

export function computeAggregateSummary(
  lines: ReviewedLine[],
): AggregateEntry[] {
  const aggregateByPart = new Map<string, AggregateEntry>();
  for (const line of lines) {
    const key = line.partNumberCanonical || "INVALID";
    const existing = aggregateByPart.get(key) ?? {
      canonicalPartNumber: key,
      totalQty: 0,
      lineCount: 0,
      matchedCount: 0,
    };
    existing.totalQty += line.qtyOcr ?? 0;
    existing.lineCount += 1;
    if (line.matchStatus === "matched") existing.matchedCount += 1;
    aggregateByPart.set(key, existing);
  }
  return Array.from(aggregateByPart.values()).map(v => ({
    canonicalPartNumber: v.canonicalPartNumber,
    totalQty: v.totalQty,
    lineCount: v.lineCount,
    matchedCount: v.matchedCount,
  }));
}
