import fs from "node:fs";

const ui = fs.readFileSync("src/pages/inventory/DhrScanner.tsx", "utf8");
const hook = fs.readFileSync("src/hooks/useServerActions.ts", "utf8");
const server = fs.readFileSync("convex/dhrInventoryActions.ts", "utf8");
const users = fs.readFileSync("convex/users.ts", "utf8");
const migration = fs.readFileSync("database/migrations/20260903_dhr_atomic_scan_transition.sql", "utf8");

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

requireTokens(ui, "DHR scanner UI", [
  "loadDhrScannerData",
  "loadDhrSessionResults",
  "applyDhrChecklistChange",
  "expectedRevision: existing?.revision ?? 0",
  "ocrDhrPage",
  'capture="environment"',
  "Confirm & apply",
  'applyQuantity(result.section_id, result.part_number, 0',
  "data.refresh()",
]);
forbidTokens(ui, "DHR scanner UI", [
  "VITE_OPENAI_KEY",
  "api.openai.com",
  "SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY",
  'sbUpdate("stock"',
  'sbInsert("audit_log"',
  'sbInsert("sap_staging"',
  'sbDelete("dhr_scan_results"',
  "qty || 1",
  "localStorage",
]);

requireTokens(hook, "DHR scanner hook", [
  "api.dhrInventoryActions.applyScanTransition",
  "api.dhrInventoryActions.createScannerSession",
  "api.dhrInventoryActions.setScannerSessionLifecycle",
  "api.aiGateway.ocrDhrPage",
  "buildDhrCorrelationId",
]);

requireTokens(users, "DHR audit identity", [
  '.withIndex("userIdAndProvider"',
  '.eq("provider", "vitros-role")',
  'providerAccountId.startsWith("employee:")',
]);
requireTokens(server, "DHR server boundary", [
  'requireCapability(ctx, "inventory.write")',
  "internal.users.getUserAuditIdentity",
  "profile.employeeId",
  "convex_employees?select=id,name,initials,active&id=eq.",
  "/rest/v1/rpc/apply_dhr_scan_transition",
  "p_expected_revision: args.expectedRevision",
  "p_actor: actor",
]);
forbidTokens(server, "DHR server boundary", [
  "args.actor",
  "args.initials",
  "callerRole",
  "callerUser",
]);

requireTokens(migration, "DHR atomic migration", [
  "create table if not exists public.dhr_scan_result_events",
  "DHR scan event history is immutable",
  "pg_advisory_xact_lock",
  "DHR revision conflict",
  "Ambiguous canonical stock part",
  "public.apply_inventory_transition",
  "revoke all on function public.apply_dhr_scan_transition",
  "grant execute on function public.apply_dhr_scan_transition",
]);
forbidTokens(migration, "DHR atomic migration", [
  "grant execute on function public.apply_dhr_scan_transition(\n  uuid, text, text, integer, integer, text, text, text, text, integer, text\n) to anon",
  "grant execute on function public.apply_dhr_scan_transition(\n  uuid, text, text, integer, integer, text, text, text, text, integer, text\n) to authenticated",
]);

console.log("DHR atomic scanner security invariants: PASS");
