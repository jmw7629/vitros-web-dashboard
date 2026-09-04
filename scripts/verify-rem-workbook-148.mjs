const TARGET_SHA = "a674eb5a5921c5e9cde2438aa0afa7d5fc1a5a45";
const ROOT = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}`;

async function get(path) {
  const response = await fetch(`${ROOT}/${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`target fetch failed ${path}: ${response.status}`);
  return await response.text();
}

const [ui, server, migration, ci] = await Promise.all([
  get("src/pages/rem/BulkImport.tsx"),
  get("convex/rem.ts"),
  get("supabase/migrations/20260904122000_rem_workbook_import.sql"),
  get(".github/workflows/ci.yml"),
]);

function requireAll(source, label, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`${label} missing invariant: ${token}`);
  }
}
function forbidAll(source, label, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) throw new Error(`${label} contains forbidden invariant: ${token}`);
  }
}

requireAll(ui, "REM upload UI", [
  'type="file"',
  'accept=".xlsx,.xls',
  'inputRef.current?.click()',
  'file.arrayBuffer()',
  'crypto.subtle.digest("SHA-256"',
  'XLSX.read(buffer',
  'sheet.normalized.match(/^wip productivity vitros wk',
  'cells.includes("production order")',
  'cells.includes("wip")',
  'cells.includes("clean")',
  'cells.includes("service")',
  'cells.includes("fl")',
  'cells.includes("release/clean")',
  'cells.includes("pack")',
  'Apply REM Update',
  'useAction(api.rem.applyWorkbookImport)',
  'browserSafeRead<RemSummary>("rem_summary")',
  'Detection uses sheet structure, not the file name',
]);
forbidAll(ui, "REM upload UI", [
  "SUPABASE_SERVICE_ROLE_KEY",
  "service_role",
  "/rest/v1/rem_analyzers",
  'password === "12345"',
]);

requireAll(server, "REM import server", [
  'requireCapability(ctx, "rem.write")',
  'export const applyWorkbookImport = action({',
  '/rest/v1/rpc/apply_rem_workbook_import',
  'p_actor: String(userId)',
  'SUPABASE_SERVICE_ROLE_KEY',
  'Duplicate analyzer serial in workbook',
]);
forbidAll(server, "REM import server", [
  "callerRole",
  "callerUser",
  "p_actor: args.",
]);

requireAll(migration, "REM import migration", [
  "create table if not exists public.rem_import_runs",
  "file_hash text not null unique",
  "security definer",
  "set search_path = public, pg_temp",
  "pg_advisory_xact_lock(hashtext('rem-import:' || p_file_hash))",
  "pg_advisory_xact_lock(hashtext('rem-analyzer:' || v_serial))",
  "upper(btrim(serial_number)) = v_serial",
  "duplicate_serial_in_import",
  "ambiguous_existing_serial",
  "insert into public.audit_log",
  "'REM_WORKBOOK_IMPORT'",
  "revoke all on function public.apply_rem_workbook_import",
  "grant execute on function public.apply_rem_workbook_import",
  "to service_role",
]);
forbidAll(migration, "REM import migration", [
  " to anon",
  " to authenticated",
  "delete from public.rem_analyzers",
  "truncate public.rem_analyzers",
]);

requireAll(ci, "combined CI", [
  "Vercel Convex production coupling check",
  "REM workbook import security check",
]);

console.log(`VERIFY=PASS SHA=${TARGET_SHA} REAL_WORKBOOK_CONTRACT=WIP_WK18_56_UNIQUE_ANALYZERS AUTH_DEPENDENCY=ISSUE_56`);
