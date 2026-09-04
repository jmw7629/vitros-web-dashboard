import fs from "node:fs";

const ui = fs.readFileSync("src/pages/rem/BulkImport.tsx", "utf8");
const server = fs.readFileSync("convex/rem.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260904122000_rem_workbook_import.sql", "utf8");

function requireTokens(source, label, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`${label} missing invariant: ${token}`);
  }
}
function forbidTokens(source, label, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) throw new Error(`${label} contains forbidden token: ${token}`);
  }
}

requireTokens(ui, "REM upload UI", [
  'type="file"',
  'inputRef.current?.click()',
  'file.arrayBuffer()',
  'crypto.subtle.digest("SHA-256"',
  'XLSX.read(buffer',
  'sheet.normalized.match(/^wip productivity vitros wk',
  'cells.includes("production order")',
  'cells.includes("release/clean")',
  'Apply REM Update',
  'useAction(api.rem.applyWorkbookImport)',
  'browserSafeRead<RemSummary>("rem_summary")',
  'Detection uses sheet structure, not the file name',
]);
forbidTokens(ui, "REM upload UI", [
  "SUPABASE_SERVICE_ROLE_KEY",
  "service_role",
  "/rest/v1/rem_analyzers",
  'password === "12345"',
]);

requireTokens(server, "REM import server action", [
  'requireCapability(ctx, "rem.write")',
  'export const applyWorkbookImport = action({',
  '/rest/v1/rpc/apply_rem_workbook_import',
  'p_actor: String(userId)',
  'SUPABASE_SERVICE_ROLE_KEY',
  'Duplicate analyzer serial in workbook',
]);
forbidTokens(server, "REM import server action", [
  "callerRole",
  "callerUser",
  "p_actor: args.",
]);

requireTokens(migration, "REM import migration", [
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
]);
forbidTokens(migration, "REM import migration", [
  "grant execute on function public.apply_rem_workbook_import(text,text,text,integer,text,jsonb) to anon",
  "grant execute on function public.apply_rem_workbook_import(text,text,text,integer,text,jsonb) to authenticated",
  "delete from public.rem_analyzers",
  "truncate public.rem_analyzers",
]);

console.log("REM workbook import security invariants: PASS");
