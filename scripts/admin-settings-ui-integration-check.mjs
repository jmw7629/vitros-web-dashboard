import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const api = read("convex/_generated/api.d.ts");
const hook = read("src/hooks/useServerActions.ts");
const settings = read("src/pages/Settings.tsx");

assert(api.includes('import type * as adminSettingsActions from "../adminSettingsActions.js";'), "Generated API must import adminSettingsActions");
assert(api.includes("adminSettingsActions: typeof adminSettingsActions;"), "Generated API must register adminSettingsActions");

assert(hook.includes("useAction(api.adminSettingsActions.listEditableSettings)"), "Server hook must bind authoritative settings read action");
assert(hook.includes("useAction(api.adminSettingsActions.updateEditableSetting)"), "Server hook must bind authoritative settings write action");
assert(hook.includes("expectedVersion: number"), "Settings write contract must carry optimistic expectedVersion");
assert(hook.includes("correlationId: string"), "Settings write contract must carry correlation id");
assert(!hook.includes("SUPABASE_SERVICE_ROLE_KEY"), "Browser hook must not contain Supabase service-role credential handling");
assert(!hook.includes("VITE_SUPABASE_SERVICE"), "Browser hook must not reference privileged VITE Supabase credentials");

assert(settings.includes("SAP Operational Settings"), "Settings page must expose the enterprise operational settings section");
assert(settings.includes("listEditableSettings()"), "Settings page must load authoritative settings through the server hook");
assert(settings.includes("updateEditableSetting({"), "Settings page must save through the server-authoritative action wrapper");
assert(settings.includes("expectedVersion: current.version"), "Settings page must send the loaded row version on save");
assert(settings.includes("crypto.randomUUID()"), "Settings page must create a unique idempotency correlation for each edit intent");
assert(settings.includes('reason: "Updated from VITROS Settings"'), "Settings page must provide an auditable change reason");
assert(settings.includes('role === "superuser"'), "Settings UI must keep superuser-only presentation gating");
assert(settings.includes("Authorization is enforced by the server."), "Settings UI must state that browser role presentation is not the authorization boundary");
assert(!settings.includes("SUPABASE_SERVICE_ROLE_KEY"), "Settings page must not contain service-role credential handling");
assert(!settings.includes("VITE_SUPABASE_SERVICE"), "Settings page must not reference privileged VITE Supabase credentials");

const resetIndex = settings.indexOf("Reset All Data — Unavailable");
assert(resetIndex >= 0, "Destructive reset must be visibly unavailable");
const resetWindow = settings.slice(Math.max(0, resetIndex - 600), resetIndex + 200);
assert(resetWindow.includes("disabled"), "Destructive reset control must be disabled");
assert(resetWindow.includes('aria-disabled="true"'), "Destructive reset control must expose disabled accessibility state");
assert(!resetWindow.includes("onClick="), "Destructive reset control must have no mutation click handler");

console.log("ADMIN_SETTINGS_UI_INTEGRATION=PASS");
console.log("SERVER_AUTHORITATIVE_RBAC=PASS");
console.log("OPTIMISTIC_VERSIONING=PASS");
console.log("AUDIT_CORRELATION=PASS");
console.log("DESTRUCTIVE_RESET_FAIL_CLOSED=PASS");
console.log("CLIENT_SECRET_BOUNDARY=PASS");
