import { execFileSync } from "node:child_process";

const target = "3b253690f68740f04f3e661a2b392dad608bd94f";
const base = "8cfa7bf3893a97c88a9ebdf054f2913394e3d5d3";
function git(...args) { return execFileSync("git", args, { encoding: "utf8" }).trim(); }
function requireTrue(value, message) { if (!value) throw new Error(message); }

requireTrue(git("rev-parse", target) === target, "target head is unavailable");
const files = git("diff", "--name-only", base, target).split("\n").filter(Boolean).sort();
const expected = [
  ".github/workflows/ci.yml",
  "convex/dhrInventoryActions.ts",
  "convex/users.ts",
  "scripts/dhr-scanner-atomic-security-check.mjs",
  "src/components/vitros/SharedComponents.tsx",
  "src/hooks/useServerActions.ts",
  "src/pages/inventory/DhrScanner.tsx",
].sort();
requireTrue(JSON.stringify(files) === JSON.stringify(expected), `unexpected implementation files: ${files.join(", ")}`);

const ui = git("show", `${target}:src/pages/inventory/DhrScanner.tsx`);
const hook = git("show", `${target}:src/hooks/useServerActions.ts`);
const server = git("show", `${target}:convex/dhrInventoryActions.ts`);
const users = git("show", `${target}:convex/users.ts`);
const securityCheck = git("show", `${target}:scripts/dhr-scanner-atomic-security-check.mjs`);
const migration = git("show", `${base}:database/migrations/20260903_dhr_atomic_scan_transition.sql`);

for (const token of [
  "loadDhrScannerData",
  "loadDhrSessionResults",
  "applyDhrChecklistChange",
  "expectedRevision: existing?.revision ?? 0",
  "ocrDhrPage",
  'capture="environment"',
  "Confirm & apply",
  'applyQuantity(result.section_id, result.part_number, 0',
  "data.refresh()",
]) requireTrue(ui.includes(token), `DHR UI missing invariant: ${token}`);
for (const forbidden of [
  "VITE_OPENAI_KEY",
  "api.openai.com",
  "VITE_SUPABASE_ANON_KEY",
  'sbUpdate("stock"',
  'sbInsert("audit_log"',
  'sbInsert("sap_staging"',
  'sbDelete("dhr_scan_results"',
  "qty || 1",
  "localStorage",
]) requireTrue(!ui.includes(forbidden), `DHR UI still contains legacy/unsafe path: ${forbidden}`);

requireTrue(hook.includes("api.dhrInventoryActions.applyScanTransition"), "atomic DHR hook binding missing");
requireTrue(hook.includes("buildDhrCorrelationId"), "deterministic DHR idempotency key missing");
requireTrue(hook.includes("api.aiGateway.ocrDhrPage"), "private DHR OCR hook missing");
requireTrue(hook.includes("api.dhrInventoryActions.createScannerSession"), "server session creation hook missing");
requireTrue(hook.includes("api.dhrInventoryActions.setScannerSessionLifecycle"), "server lifecycle hook missing");

requireTrue(users.includes('.withIndex("userIdAndProvider"'), "server identity is not anchored to auth account");
requireTrue(users.includes('.eq("provider", "vitros-role")'), "VITROS auth provider boundary missing");
requireTrue(users.includes('providerAccountId.startsWith("employee:")'), "immutable employee account id binding missing");

for (const token of [
  'requireCapability(ctx, "inventory.write")',
  "internal.users.getUserAuditIdentity",
  "profile.employeeId",
  "convex_employees?select=id,name,initials,active&id=eq.",
  "/rest/v1/rpc/apply_dhr_scan_transition",
  "p_expected_revision: args.expectedRevision",
  "p_actor: actor",
]) requireTrue(server.includes(token), `DHR server boundary missing invariant: ${token}`);
for (const forbidden of ["args.actor", "args.initials", "callerRole", "callerUser"]) {
  requireTrue(!server.includes(forbidden), `caller-authoritative identity detected: ${forbidden}`);
}

for (const token of [
  "create table if not exists public.dhr_scan_result_events",
  "DHR scan event history is immutable",
  "pg_advisory_xact_lock",
  "DHR revision conflict",
  "Ambiguous canonical stock part",
  "public.apply_inventory_transition",
  "revoke all on function public.apply_dhr_scan_transition",
  "grant execute on function public.apply_dhr_scan_transition",
]) requireTrue(migration.includes(token), `atomic DHR database invariant missing: ${token}`);
requireTrue(!/to anon|to authenticated/i.test(migration.split("revoke all on function public.apply_dhr_scan_transition")[1] ?? ""), "DHR RPC appears granted to a browser role");

const diff = git("diff", base, target);
requireTrue(!/create policy|alter policy|grant .* to anon|grant .* to authenticated/i.test(diff), "PR weakens database/browser grants or RLS");
requireTrue(!/SAP.*POST|post.*SAP|sap.*endpoint/i.test(diff), "PR appears to introduce production SAP posting");
requireTrue(securityCheck.includes("DHR atomic scanner security invariants: PASS"), "dedicated DHR regression gate missing");
requireTrue(git("show", `${target}:.github/workflows/ci.yml`).includes("node scripts/dhr-scanner-atomic-security-check.mjs"), "DHR security gate is not wired into CI");

console.log(`VERIFY=PASS SHA=${target}`);
