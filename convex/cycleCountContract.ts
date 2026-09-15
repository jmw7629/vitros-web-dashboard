export type CountSort = "alpha" | "w2w";
export interface CycleLineInput { partNumber: string; countedQty: number | null; incomingQty: number | null; stockToken: string | null }
export interface CycleSession { id: string; schedule_id: string; status: "active" | "paused" | "completed"; revision: number; scope_mode: "standard" | "w2w"; scope_parts: string[]; lines: CycleLineInput[]; sort_mode: CountSort; saved_at: string }
export interface CycleWipPart { partNumber: string; description: string; type: string; systemQty: number; stockToken: string; minQty: number; maxQty: number; onPlan: boolean; wipEntries: Record<string, number> }
export interface CycleWip { serials: string[]; parts: CycleWipPart[]; fingerprint: string; unmatchedParts: number; loadedAt: number }
export const CYCLE_FREQUENCIES = ["Single", "Daily", "Weekly", "Bi-Weekly", "Monthly", "Quarterly", "Annual"] as const;
export function validateCycleLines(lines: CycleLineInput[]) {
 if (!Array.isArray(lines) || lines.length > 5000) throw new Error("A count may contain at most 5000 lines");
 const seen = new Set<string>();
 for (const line of lines) {
  if (!line.partNumber?.trim() || line.partNumber.length > 96 || seen.has(line.partNumber.trim().toUpperCase())) throw new Error("Invalid or duplicate count part");
  seen.add(line.partNumber.trim().toUpperCase());
  for (const value of [line.countedQty, line.incomingQty]) if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)) throw new Error("Counts must be non-negative whole numbers");
  if (line.countedQty !== null && !line.stockToken) throw new Error("Counted parts require a stock snapshot");
 }
}
