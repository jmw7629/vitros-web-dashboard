import fs from "node:fs";

const migrationPath = "supabase/migrations/20260905053000_dhr_rem_base_grant_containment.sql";
const sql = fs.readFileSync(migrationPath, "utf8").toLowerCase();

const tables = [
  "dhr_checklist_sections",
  "dhr_expected_parts",
  "dhr_folders",
  "dhr_scan_sessions",
  "dhr_scan_results",
  "dhr_scan_result_events",
  "rem_analyzers",
  "rem_build_plan",
  "rem_import_runs",
  "rem_lvcc",
  "rem_staff",
  "rem_targets",
  "rem_tracker_weekly",
  "rem_weekly_notes",
];

function fail(message) {
  console.error(`DHR_REM_BASE_GRANT_SECURITY=FAIL ${message}`);
  process.exit(1);
}

for (const table of tables) {
  if (!sql.includes(`alter table public.${table} enable row level security;`)) {
    fail(`${table} must keep RLS enabled`);
  }
  if (!sql.includes(`revoke all privileges on table public.${table} from anon, authenticated;`)) {
    fail(`${table} must revoke all explicit browser-role table privileges`);
  }
}

if (/grant\s+[^;]+\s+to\s+(anon|authenticated)\b/.test(sql)) {
  fail("migration must never grant base-table privileges to browser roles");
}

if (/\b(insert|update|delete|truncate)\s+(into|from|table)?\s*public\./.test(sql)) {
  fail("migration must not mutate or truncate business data");
}

if (/create\s+policy\b|drop\s+policy\b|alter\s+policy\b/.test(sql)) {
  fail("migration must not add or weaken RLS policies");
}

if (/revoke\s+[^;]+\s+from\s+service_role\b/.test(sql)) {
  fail("migration must not remove service_role privileges");
}

if (/grant\s+[^;]+\s+to\s+service_role\b/.test(sql)) {
  fail("migration must not broaden service_role privileges");
}

console.log("DHR_REM_BASE_GRANT_SECURITY=PASS");
