import fs from "node:fs";

const sql = fs.readFileSync(
  new URL("../supabase/migrations/20260905191500_dhr_legacy_baseline_guard.sql", import.meta.url),
  "utf8",
);

function requireMatch(pattern, message) {
  if (!pattern.test(sql)) throw new Error(message);
}

function forbid(pattern, message) {
  if (pattern.test(sql)) throw new Error(message);
}

requireMatch(
  /coalesce\(OLD\.scanned_qty, 0\) > 0[\s\S]*?NEW\.scanned_qty IS DISTINCT FROM OLD\.scanned_qty[\s\S]*?NEW\.revision IS DISTINCT FROM OLD\.revision/m,
  "Legacy positive DHR baselines must be guarded when scanner state advances",
);
requireMatch(
  /NOT EXISTS \([\s\S]*?FROM public\.dhr_scan_result_events AS event[\s\S]*?event\.result_id = OLD\.id/m,
  "Guard must require immutable event provenance for a positive existing baseline",
);
requireMatch(
  /RAISE EXCEPTION 'Legacy DHR result requires inventory reconciliation before scanner mutation'/m,
  "Unproven legacy baseline must fail closed",
);
requireMatch(
  /CREATE TRIGGER dhr_legacy_inventory_baseline_guard[\s\S]*?BEFORE UPDATE OF scanned_qty, revision[\s\S]*?ON public\.dhr_scan_results/m,
  "Guard must run before scanner result quantity/revision updates",
);
requireMatch(
  /REVOKE ALL ON FUNCTION public\.guard_dhr_legacy_inventory_baseline\(\)[\s\S]*?FROM PUBLIC, anon, authenticated/m,
  "Legacy guard helper must not be browser executable",
);
requireMatch(
  /GRANT EXECUTE ON FUNCTION public\.guard_dhr_legacy_inventory_baseline\(\)[\s\S]*?TO service_role/m,
  "Legacy guard helper must stay on the trusted service boundary",
);

forbid(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+public\.dhr_scan_results\b/i,
  "Quarantine migration must not rewrite existing DHR business rows");
forbid(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+public\.stock\b/i,
  "Quarantine migration must not mutate inventory");
forbid(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+public\.sap_staging\b/i,
  "Quarantine migration must not mutate SAP staging");

console.log("DHR_LEGACY_POSITIVE_BASELINE_QUARANTINE=PASS");
console.log("DHR_LEGACY_EVENT_PROVENANCE_REQUIRED=PASS");
console.log("DHR_LEGACY_QUARANTINE_NONDESTRUCTIVE=PASS");
