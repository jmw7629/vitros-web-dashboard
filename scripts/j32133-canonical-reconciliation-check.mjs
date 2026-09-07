import fs from "node:fs";
import path from "node:path";

const migrationPath = path.resolve(
  "database/migrations/20260907_reconcile_j32133_canonical_duplicate.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");

function requireMatch(pattern, message) {
  if (!pattern.test(sql)) throw new Error(message);
}

function forbid(pattern, message) {
  if (pattern.test(sql)) throw new Error(message);
}

requireMatch(/LOCK TABLE public\.stock IN SHARE ROW EXCLUSIVE MODE/i, "stock reconciliation must serialize writes");
requireMatch(/upper\(btrim\(part_number\)\)\s*=\s*'J32133'/i, "canonical J32133 assertion is missing");
requireMatch(/part_number\s*=\s*'J32133 '/i, "trailing-space duplicate must be selected explicitly");
requireMatch(/v_duplicate\.qty_on_hand\s*<>\s*0/i, "zero-QOH retirement guard is missing");
requireMatch(/dhr_scan_results[\s\S]*stock_id\s*=\s*v_duplicate\.id/i, "DHR stock-id reference guard is missing");

for (const table of [
  "consume_stock_log",
  "incoming_stock_log",
  "inventory_batch_lines",
  "kit_components",
  "shortages",
  "stocking_plan",
  "dhr_expected_parts",
  "dhr_scan_results",
  "dhr_scan_result_events",
  "inventory_operations",
  "sap_staging",
  "error_queue",
]) {
  requireMatch(new RegExp(`public\\.${table}`, "i"), `reference guard missing for ${table}`);
}

requireMatch(/CANONICAL_RECONCILIATION/i, "explicit reconciliation audit event is missing");
requireMatch(/canonical-reconciliation:J32133:v1/i, "idempotent reconciliation correlation is missing");
requireMatch(/DELETE FROM public\.stock[\s\S]*WHERE id = v_duplicate\.id/i, "retirement must target only the proven duplicate UUID");
requireMatch(/DROP INDEX IF EXISTS public\.stock_part_number_canonical_unique_except_legacy_j32133/i, "legacy index exception must be removed");
requireMatch(/CREATE UNIQUE INDEX IF NOT EXISTS stock_part_number_canonical_unique[\s\S]*upper\(btrim\(part_number\)\)/i, "unconditional canonical uniqueness is missing");

forbid(/UPDATE\s+public\.audit_log/i, "immutable audit history must never be rewritten");
forbid(/DELETE\s+FROM\s+public\.audit_log/i, "immutable audit history must never be deleted");
forbid(/UPDATE\s+public\.stock\s+SET\s+qty_on_hand/i, "reconciliation must not rewrite inventory quantity");
forbid(/INSERT\s+INTO\s+public\.sap_staging/i, "reconciliation must not stage SAP movement");
forbid(/https?:\/\//i, "migration must not invoke external services");

console.log("J32133_CANONICAL_RECONCILIATION_CHECK=PASS");
