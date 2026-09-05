import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const parser = read("src/lib/remWorkbookAuthoritative.ts");
const action = read("convex/remWorkbookActions.ts");
const ui = read("src/pages/rem/BulkImport.tsx");
const migration = read("supabase/migrations/20260905074500_rem_authoritative_workbook_parity.sql");

const requireMatch = (source, pattern, message) => {
  if (!pattern.test(source)) throw new Error(message);
};

for (const signature of ["tracker", "build plan", "staff", "notes - issues"]) {
  if (!parser.includes(`\"${signature}\"`)) throw new Error(`Parser must require internal ${signature} signature`);
}
requireMatch(parser, /inferPlanYear\(workbook\)/, "Parser must derive plan year from workbook structure");
requireMatch(parser, /match\(\/\^\(20\\d\{2\}\) summary\$\//, "Parser must identify year from internal summary sheet");
requireMatch(parser, /latestVitrosWip\(workbook\)/, "Parser must select the latest VITROS WIP sheet by schema");
if (/fileName[^\n]{0,120}(includes|match|startsWith|endsWith)/.test(parser)) {
  throw new Error("Parser must not identify the authoritative workbook by filename");
}

requireMatch(action, /requireCapability\(ctx, ["']rem\.write["']\)/, "Import action must require server-authoritative rem.write");
requireMatch(action, /const userId = await requireCapability/, "Actor must derive from authenticated server identity");
requireMatch(action, /p_actor:\s*String\(userId\)/, "RPC actor must be server-derived");
requireMatch(action, /apply_rem_authoritative_workbook_import/, "Action must use authoritative transactional RPC");
if (/actor:\s*v\.string\(\)/.test(action)) throw new Error("Caller-authoritative actor is forbidden");
if (/serviceKey\s*[:=].*VITE_/i.test(action)) throw new Error("Service-role credential must never use browser VITE environment");

requireMatch(ui, /parseAuthoritativeRemWorkbook/, "REM upload UI must use authoritative parser");
requireMatch(ui, /api\.remWorkbookActions\.applyAuthoritativeWorkbookImport/, "REM upload UI must use authoritative write action");
for (const field of ["trackerWeekly", "buildPlan", "staff", "weeklyNotes", "targets"]) {
  if (!ui.includes(field)) throw new Error(`REM upload UI must preview/apply ${field}`);
}

requireMatch(migration, /security definer/i, "REM import RPC must be SECURITY DEFINER");
requireMatch(migration, /set search_path = public, pg_temp/i, "REM import RPC must lock search_path");
requireMatch(migration, /pg_advisory_xact_lock/, "REM import must serialize idempotent/concurrent operations");
requireMatch(migration, /rem_authoritative_import_runs/, "REM import must persist immutable import history");
requireMatch(migration, /before update or delete[\s\S]*reject_rem_authoritative_import_run_mutation/i, "Import history must reject update/delete");
requireMatch(migration, /revoke all on function public\.apply_rem_authoritative_workbook_import[\s\S]*from public, anon, authenticated/i, "Browser roles must not execute authoritative import RPC");
requireMatch(migration, /grant execute on function public\.apply_rem_authoritative_workbook_import[\s\S]*to service_role/i, "Only service_role must execute authoritative import RPC");
requireMatch(migration, /insert into public\.audit_log/i, "Successful authoritative import must emit audit history");
if (/\bdelete\s+from\s+public\.rem_/i.test(migration)) throw new Error("Authoritative workbook import must never delete REM business rows");
if (/truncate\s+(table\s+)?public\.rem_/i.test(migration)) throw new Error("Authoritative workbook import must never truncate REM business rows");

console.log("REM_AUTHORITATIVE_SCHEMA_DETECTION=PASS");
console.log("REM_AUTHORITATIVE_SERVER_IDENTITY=PASS");
console.log("REM_AUTHORITATIVE_ATOMIC_IDEMPOTENT_IMPORT=PASS");
console.log("REM_AUTHORITATIVE_NO_DESTRUCTIVE_OMISSION_DELETE=PASS");
console.log("REM_AUTHORITATIVE_BROWSER_RPC_BYPASS=CLOSED");
