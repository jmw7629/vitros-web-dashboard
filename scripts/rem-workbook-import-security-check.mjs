import fs from "node:fs";

const ui = fs.readFileSync("src/pages/rem/BulkImport.tsx", "utf8");
const parser = fs.readFileSync("src/lib/remWorkbookAuthoritative.ts", "utf8");
const legacyServer = fs.readFileSync("convex/rem.ts", "utf8");
const authoritativeServer = fs.readFileSync("convex/remWorkbookActions.ts", "utf8");
const legacyMigration = fs.readFileSync("supabase/migrations/20260904122000_rem_workbook_import.sql", "utf8");
const authoritativeMigration = fs.readFileSync("supabase/migrations/20260905074500_rem_authoritative_workbook_parity.sql", "utf8");

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
  'parseAuthoritativeRemWorkbook',
  'Apply Authoritative REM Update',
  'useAction(api.remWorkbookActions.applyAuthoritativeWorkbookImport)',
  'browserSafeRead<RemSummary>("rem_summary")',
  'Internal workbook structure is authoritative',
]);
forbidTokens(ui, "REM upload UI", [
  "SUPABASE_SERVICE_ROLE_KEY",
  "service_role",
  "/rest/v1/rem_analyzers",
  'password === "12345"',
]);

requireTokens(parser, "REM authoritative workbook parser", [
  'match(/^wip productivity vitros wk',
  'cells.includes("production order")',
  'cells.includes("release/clean")',
  '"tracker"',
  '"build plan"',
  '"staff"',
  '"notes - issues"',
  'inferPlanYear(workbook)',
]);
forbidTokens(parser, "REM authoritative workbook parser", [
  "SUPABASE_SERVICE_ROLE_KEY",
  "service_role",
]);

// Keep the original analyzer-only compatibility importer secure until it is retired.
requireTokens(legacyServer, "legacy REM import server action", [
  'requireCapability(ctx, "rem.write")',
  'export const applyWorkbookImport = action({',
  '/rest/v1/rpc/apply_rem_workbook_import',
  'p_actor: String(userId)',
  'SUPABASE_SERVICE_ROLE_KEY',
  'Duplicate analyzer serial in workbook',
]);
forbidTokens(legacyServer, "legacy REM import server action", [
  "callerRole",
  "callerUser",
  "p_actor: args.",
]);

requireTokens(authoritativeServer, "authoritative REM import server action", [
  'requireCapability(ctx, "rem.write")',
  'export const applyAuthoritativeWorkbookImport = action({',
  '/rest/v1/rpc/apply_rem_authoritative_workbook_import',
  'p_actor: String(userId)',
  'SUPABASE_SERVICE_ROLE_KEY',
]);
forbidTokens(authoritativeServer, "authoritative REM import server action", [
  "callerRole",
  "callerUser",
  "p_actor: args.",
]);

requireTokens(legacyMigration, "legacy REM import migration", [
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
forbidTokens(legacyMigration, "legacy REM import migration", [
  "grant execute on function public.apply_rem_workbook_import(text,text,text,integer,text,jsonb) to anon",
  "grant execute on function public.apply_rem_workbook_import(text,text,text,integer,text,jsonb) to authenticated",
  "delete from public.rem_analyzers",
  "truncate public.rem_analyzers",
]);

requireTokens(authoritativeMigration, "authoritative REM parity migration", [
  "create table if not exists public.rem_authoritative_import_runs",
  "security definer",
  "set search_path = public, pg_temp",
  "pg_advisory_xact_lock",
  "insert into public.audit_log",
  "'REM_AUTHORITATIVE_WORKBOOK_IMPORT'",
  "revoke all on function public.apply_rem_authoritative_workbook_import",
  "grant execute on function public.apply_rem_authoritative_workbook_import",
]);
forbidTokens(authoritativeMigration, "authoritative REM parity migration", [
  " to anon;",
  " to authenticated;",
  "delete from public.rem_",
  "truncate public.rem_",
]);

console.log("REM workbook import security invariants: PASS");
