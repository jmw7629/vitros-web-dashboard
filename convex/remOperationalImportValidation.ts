import { v } from "convex/values";

export const operationalDatasetValidator = v.union(
  v.literal("field_status"), v.literal("lvcc_reviews"), v.literal("install_parts"),
  v.literal("certified_parts"), v.literal("summary_targets"),
);
export type OperationalDataset = "field_status" | "lvcc_reviews" | "install_parts" | "certified_parts" | "summary_targets";
export type OperationalValue = string | number | boolean | null | Record<string, string> |
  Array<{ slot: number; value: string; sourceCell: string }>;
export type OperationalData = Record<string, OperationalValue>;
export type OperationalRecord = {
  dataset: OperationalDataset; sourceKey: string; sourceSheet: string; sourceRow: number; data: OperationalData;
};

// The generic wire map is bounded below against a dataset-specific allowlist.
// It cannot carry objects/arrays other than the two explicit provenance shapes.
export const operationalValueValidator = v.union(v.string(), v.number(), v.boolean(), v.null(),
  v.record(v.string(), v.string()),
  v.array(v.object({ slot: v.number(), value: v.string(), sourceCell: v.string() })),
);
export const operationalRecordValidator = v.object({
  dataset: operationalDatasetValidator, sourceKey: v.string(), sourceSheet: v.string(),
  sourceRow: v.number(), data: v.record(v.string(), operationalValueValidator),
});

export const OPERATIONAL_FIELDS: Record<OperationalDataset, readonly string[]> = {
  field_status: ["product", "batch", "orderReference", "duplicateCount", "postingDate", "sourcePostingDate", "yearMonth", "cleanliness", "cabinetry", "buildQuality", "finalLine", "release", "releaseFpyPct", "sourceReleaseFpy", "partsAtInstallUsd", "first90", "status", "installDate", "sourceInstallDate", "country", "partsNotCertified", "partsAlsoCertified", "comment", "fpyGoalPct", "sourceFpyGoal", "sourceNumericText"],
  lvcc_reviews: ["partNumber", "weekNumber", "weekStart", "sourceWeekStart", "reviewIds", "listedCount", "recordedTotal", "sourceColumnD", "sourceColumnDLabel", "sourceColumnE", "sourceColumnELabel", "totalDifference", "sourceNumericText"],
  install_parts: ["serviceOrder", "equipmentNumber", "partNumber", "completedAt", "equipmentPartKey", "yearMonth", "quantity", "costUsd", "partCostUsd", "sourceCompletedAt", "sourceYearMonth", "replacedInServiceKey", "region", "country", "productFamily", "problemCode", "feedbackCode", "description", "technicianCode", "technicianName", "serviceMemo", "resolutionMemo", "serviceOrderFeedback", "installFeedbackNotes", "internalComments", "sourceNumericText"],
  certified_parts: ["serviceOrder", "partLineNumber", "laborLineNumber", "partNumber", "lineType", "equipmentNumber", "equipmentPartKey", "yearMonth", "quantity", "partCostUsd", "allCostUsd", "sourceYearMonth", "feedbackCode", "description", "sourceNumericText"],
  summary_targets: ["product", "quarter", "targetValue", "annualTargetValue", "trackerPlanValue", "planVariance", "sourceNumericText"],
};
const required: Record<OperationalDataset, string[]> = {
  field_status: ["product", "batch"],
  lvcc_reviews: ["partNumber", "weekNumber", "weekStart", "sourceWeekStart", "reviewIds", "listedCount"],
  install_parts: ["serviceOrder", "equipmentNumber", "partNumber", "completedAt", "equipmentPartKey", "yearMonth", "quantity", "costUsd", "partCostUsd"],
  certified_parts: ["serviceOrder", "partLineNumber", "laborLineNumber", "partNumber", "lineType", "equipmentNumber", "equipmentPartKey", "quantity", "partCostUsd", "allCostUsd"],
  summary_targets: ["product", "quarter", "targetValue", "annualTargetValue"],
};
const numbers = new Set(["sourceColumnD", "sourceColumnE", "duplicateCount", "finalLine", "release", "releaseFpyPct", "partsAtInstallUsd", "fpyGoalPct", "weekNumber", "listedCount", "recordedTotal", "totalDifference", "quantity", "costUsd", "partCostUsd", "allCostUsd", "targetValue", "annualTargetValue", "trackerPlanValue", "planVariance"]);
const sourceScalars = new Set(["sourcePostingDate", "sourceInstallDate", "sourceReleaseFpy", "sourceFpyGoal", "sourceCompletedAt", "sourceYearMonth", "sourceWeekStart"]);
const identity = new Set(["product", "batch", "partNumber", "serviceOrder", "equipmentNumber", "partLineNumber", "laborLineNumber", "lineType", "quarter"]);

export function assertOperationalYear(year: number) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error("Invalid REM plan year");
}
export function assertOperationalId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("Invalid REM import id");
}
function date(value: string, timestamp: boolean) {
  if (!(timestamp ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/).test(value)) return false;
  const parsed = new Date(timestamp ? `${value}Z` : `${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, timestamp ? 19 : 10) === value;
}

export function operationalSourceKey(year: number, dataset: OperationalDataset, data: OperationalData): string {
  const fields: Record<OperationalDataset, string[]> = {
    field_status: ["product", "batch"], lvcc_reviews: ["partNumber", "weekNumber"],
    install_parts: ["serviceOrder", "equipmentNumber", "partNumber"],
    certified_parts: ["serviceOrder", "partLineNumber", "laborLineNumber", "partNumber", "lineType"],
    summary_targets: ["product", "quarter"],
  };
  const scope = dataset === "install_parts" || dataset === "certified_parts" ? "history" : String(year);
  return `${scope}:${dataset}:` + fields[dataset].map(key => encodeURIComponent(String(data[key]))).join(":");
}

export function validateOperationalRecord(record: OperationalRecord, year: number): OperationalRecord {
  assertOperationalYear(year);
  if (!Object.prototype.hasOwnProperty.call(OPERATIONAL_FIELDS, record.dataset)) throw new Error("Invalid REM dataset");
  if (record.sourceSheet.trim() !== record.sourceSheet || !record.sourceSheet || record.sourceSheet.length > 160) throw new Error("Invalid REM worksheet");
  if (!Number.isInteger(record.sourceRow) || record.sourceRow < 1 || record.sourceRow > 1_048_576) throw new Error("Invalid REM source row");
  if (!record.data || Object.prototype.toString.call(record.data) !== "[object Object]") throw new Error("Invalid REM operational data");
  const entries = Object.entries(record.data);
  if (entries.length > 40 || JSON.stringify(record).length > 32_000) throw new Error("REM operational row is too large");
  for (const [key, value] of entries) {
    if (!OPERATIONAL_FIELDS[record.dataset].includes(key)) throw new Error("Unexpected REM operational field");
    // Blank values are omission, never deletion; required values cannot be blank.
    if (value === null || typeof value === "string" && value.trim() === "") continue;
    if (key === "sourceNumericText") {
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 40 || Object.entries(value).some(([k, val]) => !OPERATIONAL_FIELDS[record.dataset].includes(k) || typeof val !== "string" || val.length > 1000)) throw new Error("Invalid numeric source provenance");
    } else if (key === "reviewIds") {
      if (!Array.isArray(value) || value.length > 100 || value.some(item => !Number.isInteger(item.slot) || item.slot < 1 || item.slot > 100 || !item.value.trim() || item.value.length > 160 || !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(item.sourceCell) || Number(item.sourceCell.replace(/^[A-Z]+/, "")) !== record.sourceRow) || new Set(value.map(item => item.slot)).size !== value.length) throw new Error("Invalid LVCC review identity");
    } else if (numbers.has(key)) {
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000) throw new Error("Invalid REM numeric value");
    } else if (sourceScalars.has(key)) {
      if (!(typeof value === "string" && value.length <= 1000 || typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000)) throw new Error("Invalid REM source value");
    } else if (typeof value !== "string" || value.length > 8000 || value.includes("\u0000")) throw new Error("Invalid REM text value");
    if (identity.has(key) && (typeof value !== "string" || !value.trim() || value !== value.trim().toUpperCase() || value.length > 160)) throw new Error("Invalid REM natural identity");
  }
  for (const key of required[record.dataset]) if (record.data[key] === undefined || record.data[key] === null || typeof record.data[key] === "string" && String(record.data[key]).trim() === "") throw new Error("Required REM operational field missing");
  const d = record.data;
  if (d.product !== undefined && !(record.dataset === "field_status" ? ["VITROS", "VISION"] : ["VITROS", "VISION", "LVCC_ELECTROMETER", "LVCC_IR_WASH"]).includes(String(d.product))) throw new Error("Invalid REM product");
  if (d.quarter !== undefined && !/^Q[1-4]$/.test(String(d.quarter))) throw new Error("Invalid REM quarter");
  for (const key of ["postingDate", "installDate", "weekStart"]) if (d[key] && !date(String(d[key]), false)) throw new Error("Invalid REM date");
  if (d.completedAt && !date(String(d.completedAt), true)) throw new Error("Invalid REM completion timestamp");
  for (const [normal, raw] of [["postingDate", "sourcePostingDate"], ["installDate", "sourceInstallDate"]]) if (String(d[raw] ?? "").trim().toUpperCase() === "TBD" && d[normal]) throw new Error("REM date contradicts its source marker");
  if (d.yearMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(d.yearMonth))) throw new Error("Invalid REM year-month");
  for (const key of ["releaseFpyPct", "fpyGoalPct"]) if (d[key] !== undefined && d[key] !== null && (Number(d[key]) < 0 || Number(d[key]) > 100)) throw new Error("Invalid REM percentage");
  if (d.weekNumber !== undefined && (!Number.isInteger(d.weekNumber) || Number(d.weekNumber) < 1 || Number(d.weekNumber) > 53)) throw new Error("Invalid REM week");
  for (const key of ["listedCount", "recordedTotal", "duplicateCount", "finalLine", "release", "sourceColumnD", "sourceColumnE"]) if (d[key] !== undefined && d[key] !== null && (!Number.isInteger(d[key]) || Number(d[key]) < 0)) throw new Error("Invalid REM count");
  if (record.dataset === "lvcc_reviews" && Number(d.listedCount) !== (d.reviewIds as unknown[]).length) throw new Error("LVCC review count mismatch");
  if (record.dataset === "lvcc_reviews") {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    jan4.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() + 6) % 7 + (Number(d.weekNumber) - 1) * 7);
    if (jan4.toISOString().slice(0, 10) !== d.weekStart) throw new Error("LVCC ISO week/date mismatch");
    if (d.totalDifference !== undefined && (d.recordedTotal === undefined || d.totalDifference !== Number(d.listedCount) - Number(d.recordedTotal))) throw new Error("LVCC recorded total difference mismatch");
  }
  if (d.planVariance !== undefined && (d.trackerPlanValue === undefined || d.planVariance !== Number(d.trackerPlanValue) - Number(d.targetValue))) throw new Error("REM summary variance mismatch");
  for (const key of ["targetValue", "annualTargetValue"]) if (d[key] !== undefined && Number(d[key]) < 0) throw new Error("Invalid REM target");
  if (record.sourceKey !== operationalSourceKey(year, record.dataset, d) || record.sourceKey.length > 1800) throw new Error("REM operational source key mismatch");
  return record;
}
