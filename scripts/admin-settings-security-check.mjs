import fs from "node:fs";

const auth = fs.readFileSync("convex/authGuard.ts", "utf8");
const action = fs.readFileSync("convex/adminSettingsActions.ts", "utf8");
const migration = fs.readFileSync("database/migrations/20260904_enterprise_admin_settings_registry.sql", "utf8");

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`${label}: missing ${needle}`);
};
const rejectText = (source, needle, label) => {
  if (source.includes(needle)) throw new Error(`${label}: forbidden ${needle}`);
};

requireText(auth, '"admin.system_settings.manage"', "granular admin capability");
const engineerBlock = auth.match(/engineer:\s*\[([\s\S]*?)\],\s*viewer:/)?.[1] ?? "";
if (engineerBlock.includes("admin.system_settings.manage")) {
  throw new Error("system settings capability must not be granted to engineer");
}

requireText(action, 'requireCapability(ctx, "admin.system_settings.manage")', "server RBAC");
requireText(action, '"rpc/apply_admin_setting_change"', "transactional settings RPC");
requireText(action, "p_actor: String(actorId)", "server-derived actor");
requireText(action, "expectedVersion", "optimistic concurrency");
requireText(action, "correlationId", "idempotency key");
rejectText(action, "VITE_", "server credential boundary");
rejectText(action, "service_role", "browser-facing action must not hard-code role credentials");
if (/args\s*:\s*\{[\s\S]*?actor\s*:/m.test(action)) {
  throw new Error("actor must not be caller supplied");
}

for (const key of [
  "sapPlantCode",
  "sapStorageLocation",
  "sapMovementIN",
  "sapMovementOUT",
  "sapMovementADJUST",
  "sapHeaderText",
]) {
  requireText(action, key, `action allowlist ${key}`);
  requireText(migration, `'${key}'`, `database allowlist ${key}`);
}

requireText(migration, "ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1", "versioned settings");
requireText(migration, "CREATE TABLE IF NOT EXISTS public.admin_setting_events", "immutable audit table");
requireText(migration, "BEFORE UPDATE OR DELETE ON public.admin_setting_events", "immutable audit trigger");
requireText(migration, "pg_advisory_xact_lock", "concurrent write serialization");
requireText(migration, "FOR UPDATE", "row lock");
requireText(migration, "correlation_id text NOT NULL UNIQUE", "database idempotency");
requireText(migration, "SECURITY DEFINER", "server RPC privilege boundary");
requireText(migration, "SET search_path = pg_catalog", "fixed search path");
requireText(migration, "FROM PUBLIC, anon, authenticated", "least privilege revocation");
requireText(migration, "TO service_role", "service-role-only execute");
rejectText(migration.toUpperCase(), "DROP TABLE", "non-destructive migration");
rejectText(migration.toUpperCase(), "TRUNCATE", "non-destructive migration");

console.log("ENTERPRISE_ADMIN_SERVER_RBAC=PASS");
console.log("ENTERPRISE_ADMIN_VALIDATION=PASS");
console.log("ENTERPRISE_ADMIN_CONCURRENCY=PASS");
console.log("ENTERPRISE_ADMIN_AUDIT=PASS");
console.log("ENTERPRISE_ADMIN_SECRET_BOUNDARY=PASS");
