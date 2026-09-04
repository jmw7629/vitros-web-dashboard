import { execFileSync } from "node:child_process";

const target = "3b253690f68740f04f3e661a2b392dad608bd94f";
const base = "8cfa7bf3893a97c88a9ebdf054f2913394e3d5d3";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const show = (sha, path) => git("show", `${sha}:${path}`);
const requireTrue = (condition, message) => { if (!condition) throw new Error(message); };
const requireTokens = (source, label, tokens) => {
  for (const token of tokens) requireTrue(source.includes(token), `${label} missing invariant: ${token}`);
};
const forbidTokens = (source, label, tokens) => {
  for (const token of tokens) requireTrue(!source.includes(token), `${label} contains forbidden path: ${token}`);
};

requireTrue(git("rev-parse", target) === target, "exact implementation SHA is unavailable");
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
requireTrue(JSON.stringify(files) === JSON.stringify(expected), `unexpected implementation file set: ${files.join(", ")}`);

const ui = show(target, "src/pages/inventory/DhrScanner.tsx");
const hook = show(target, "src/hooks/useServerActions.ts");
const server = show(target, "convex/dhrInventoryActions.ts");
const users = show(target, "convex/users.ts");
const migration = show(base, "database/migrations/20260903_dhr_atomic_scan_transition.sql");
const ci = show(target, ".github/workflows/ci.yml");
const dedicated = show(target, "scripts/dhr-scanner-atomic-security-check.mjs");

requireTokens(ui, "DHR UI", [
  "loadDhrScannerData",
  "loadDhrSessionResults",
  "applyDhrChecklistChange",
  "expectedRevision: existing?.revision ?? 0",
  "ocrDhrPage",
  'capture="environment"',
  "Confirm & apply",
  "data.refresh()",
]);
forbidTokens(ui, "DHR UI", [
  "VITE_OPENAI_KEY",
  "api.openai.com",
  "VITE_SUPABASE_ANON_KEY",
  'sbUpdate("stock"',
  'sbInsert("audit_log"',
  'sbInsert("sap_staging"',
  'sbDelete("dhr_scan_results"',
  "qty || 1",
  "localStorage",
]);
requireTrue(/applyQuantity\(result\.section_id,\s*result\.part_number,\s*0/.test(ui), "consumed Additional Service removal is not a compensating quantity transition");

requireTokens(hook, "DHR hook", [
  "api.dhrInventoryActions.applyScanTransition",
  "buildDhrCorrelationId",
  "api.aiGateway.ocrDhrPage",
  "api.dhrInventoryActions.createScannerSession",
  "api.dhrInventoryActions.setScannerSessionLifecycle",
]);
requireTokens(users, "server identity", [
  "userIdAndProvider",
  '"vitros-role"',
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
forbidTokens(server, "DHR server boundary", ["args.actor", "args.initials", "callerRole", "callerUser"]);

requireTokens(migration, "DHR atomic database", [
  "create table if not exists public.dhr_scan_result_events",
  "DHR scan event history is immutable",
  "pg_advisory_xact_lock",
  "DHR revision conflict",
  "Ambiguous canonical stock part",
  "public.apply_inventory_transition",
  "from public, anon, authenticated",
  "to service_role",
]);
requireTrue(!migration.includes("to anon;") && !migration.includes("to authenticated;"), "atomic DHR RPC is executable by a browser role");
requireTrue(ci.includes("node scripts/dhr-scanner-atomic-security-check.mjs"), "dedicated DHR security test is not wired into CI");
requireTrue(dedicated.includes("DHR atomic scanner security invariants: PASS"), "dedicated DHR security test is missing its terminal gate");

const implementationDiff = git("diff", base, target);
requireTrue(!/grant\s+execute[\s\S]{0,160}\b(?:anon|authenticated)\b/i.test(implementationDiff), "implementation introduces browser EXECUTE grants");
requireTrue(!/VITE_(?:OPENAI|SUPABASE_SERVICE)|SUPABASE_SERVICE_ROLE_KEY\s*=/.test(implementationDiff), "implementation appears to expose a privileged secret");

console.log(`VERIFY=PASS SHA=${target}`);
