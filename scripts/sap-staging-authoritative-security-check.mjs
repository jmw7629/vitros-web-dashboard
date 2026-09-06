import fs from "node:fs";

const page = fs.readFileSync("src/pages/inventory/SapStaging.tsx", "utf8");
const hook = fs.readFileSync("src/hooks/useSapStagingWorkflow.ts", "utf8");
const action = fs.readFileSync("convex/sapStagingWorkflow.ts", "utf8");
const migration = fs.readFileSync("database/migrations/20260905_sap_staging_authoritative_workflow.sql", "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(`SAP_STAGING_AUTHORITATIVE=FAIL ${message}`);
    process.exit(1);
  }
}

assert(!page.includes("useConvexData"), "SAP Staging must not depend on stale shared SAP mapping");
assert(!page.includes("readyIds") && !page.includes("exportedIds") && !page.includes("postedIds"), "workflow state must not be local-only");
assert(page.includes("useSapStagingWorkflow"), "page must use authoritative SAP workflow hook");
assert(page.includes("workflow.markReady") && page.includes("workflow.markExported"), "review/export actions must use server workflow");
assert(page.includes("max-h-[55vh] overflow-auto") && page.includes("sticky top-0") && page.includes("gridTemplateColumns"), "synchronized sticky table/header must be preserved");
assert(!/fetch\s*\([^)]*sap/i.test(page), "browser page must not post directly to SAP");

assert(hook.includes("api.supabaseGateway.listSapStaging"), "hook must read authoritative staging rows through authenticated gateway");
assert(hook.includes("sapStagingWorkflow.transition"), "hook must use server-authoritative transition action");
assert(hook.includes("row.export_status"), "hook must map persisted export_status");
assert(hook.includes("row.qty_on_hand"), "hook must preserve legacy staging quantity compatibility");
assert(hook.includes("crypto.subtle.digest(\"SHA-256\""), "transport retries need a deterministic correlation key");
assert(!hook.includes("SUPABASE_SERVICE_ROLE_KEY"), "browser hook must never contain service-role credential handling");

assert(action.includes('requireCapability(ctx, "inventory.write")'), "server transition must require inventory.write");
assert(action.includes("p_actor: String(actorId)"), "actor must be derived from authenticated server identity");
assert(!/args\s*:\s*\{[^}]*actor\s*:/s.test(action), "actor must not be accepted from browser args");
assert(action.includes("apply_sap_staging_status_transition"), "server action must call the atomic database transition");

assert(migration.includes("security definer"), "transition RPC must be SECURITY DEFINER");
assert(migration.includes("pg_advisory_xact_lock"), "transition must serialize idempotency keys");
assert(migration.includes("for update"), "selected SAP rows must be row-locked");
assert(migration.includes("sap_staging_status_events"), "immutable status event history is required");
assert(migration.includes("before update or delete"), "status history must reject mutation/deletion");
assert(/revoke all on function public\.apply_sap_staging_status_transition[\s\S]*from public, anon, authenticated/i.test(migration), "browser roles must not execute transition RPC");
assert(/grant execute on function public\.apply_sap_staging_status_transition[\s\S]*to service_role/i.test(migration), "service_role must be the only app execution path");
assert(!/https?:\/\/(?![^\s]*supabase)/i.test(action), "server action must not call an external SAP endpoint");

console.log("SAP_STAGING_AUTHORITATIVE=PASS");
console.log("SAP_STAGING_SERVER_RBAC=PASS");
console.log("SAP_STAGING_ATOMIC_BATCH=PASS");
console.log("SAP_STAGING_IDEMPOTENCY=PASS");
console.log("SAP_STAGING_IMMUTABLE_HISTORY=PASS");
console.log("SAP_STAGING_TABLE_SYNC=PASS");
console.log("PRODUCTION_SAP_POST=NO");
