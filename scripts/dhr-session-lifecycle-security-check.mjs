import fs from "node:fs";

const migration = fs.readFileSync("database/migrations/20260904_dhr_session_lifecycle_revisions.sql", "utf8");
const actions = fs.readFileSync("convex/dhrInventoryActions.ts", "utf8");

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

requireAll(migration, "migration", [
  "ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0",
  "CREATE TABLE IF NOT EXISTS public.dhr_scan_session_events",
  "correlation_id text NOT NULL UNIQUE",
  "ON DELETE RESTRICT",
  "revision_after = revision_before + 1",
  "DHR session lifecycle history is immutable",
  "CREATE OR REPLACE FUNCTION public.apply_dhr_session_lifecycle",
  "SECURITY DEFINER",
  "SET search_path = public, pg_temp",
  "pg_advisory_xact_lock",
  "FOR UPDATE",
  "DHR session revision conflict",
  "revision = v_session.revision + 1",
  "REVOKE ALL ON FUNCTION public.apply_dhr_session_lifecycle(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated",
  "GRANT EXECUTE ON FUNCTION public.apply_dhr_session_lifecycle(uuid, text, text, text, integer) TO service_role",
]);

forbidAll(migration, "migration", [
  "UPDATE public.stock",
  "INSERT INTO public.audit_log",
  "INSERT INTO public.sap_staging",
  "DELETE FROM public.dhr_scan_session_events",
]);

requireAll(actions, "DHR server actions", [
  "requireCapability(ctx, \"inventory.write\")",
  "resolveAuditActor(ctx, userId, serviceKey, url)",
  "/rest/v1/rpc/apply_dhr_session_lifecycle",
  "dhr_scan_sessions?select=id,status,revision",
  "if (currentStatus === args.status)",
  "dhr_scan_session_events?select=id,session_id,from_status,to_status,revision_before,revision_after,actor,created_at",
  "return { ...events[0], duplicate: true }",
  "dhr-lifecycle:${sessionId}:${revision}:${args.status}",
  "p_expected_revision: revision",
]);

forbidAll(actions, "DHR server actions", [
  '"PATCH",\n      {\n        status: args.status',
  "p_actor: args.",
]);

console.log("DHR_SESSION_LIFECYCLE_REVISION=PASS");
console.log("DHR_SESSION_HISTORY_IMMUTABLE=PASS");
console.log("DHR_LIFECYCLE_IDEMPOTENT=PASS");
console.log("DHR_LIFECYCLE_SERVER_ACTOR=PASS");
console.log("DHR_LIFECYCLE_MOVES_INVENTORY=NO");
