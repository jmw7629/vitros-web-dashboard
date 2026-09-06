import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../database/migrations/20260906_dhr_session_event_trigger_least_privilege.sql", import.meta.url),
  "utf8",
);

const required = [
  /revoke\s+all\s+on\s+function\s+public\.reject_dhr_scan_session_event_mutation\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i,
  /grant\s+execute\s+on\s+function\s+public\.reject_dhr_scan_session_event_mutation\(\)\s+to\s+service_role\s*;/i,
];

for (const pattern of required) {
  if (!pattern.test(migration)) throw new Error(`Missing least-privilege invariant: ${pattern}`);
}

if (/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|drop\s+table|alter\s+table)\b/i.test(migration)) {
  throw new Error("Privilege migration must not mutate or rewrite business data/schema tables");
}

const executeGrantees = [
  ...migration.matchAll(/\bgrant\s+execute\s+on\s+function\s+public\.[a-z0-9_]+\([^;]*?\)\s+to\s+([^;]+);/gi),
].flatMap((match) => match[1].split(",").map((value) => value.trim().toLowerCase()));

if (executeGrantees.some((grantee) => ["public", "anon", "authenticated"].includes(grantee))) {
  throw new Error("Browser roles must not receive EXECUTE on the SECURITY DEFINER trigger helper");
}

console.log("DHR_TRIGGER_BROWSER_EXECUTE=REVOKED");
console.log("DHR_TRIGGER_SERVICE_ROLE_EXECUTE=PRESERVED");
console.log("DHR_TRIGGER_BUSINESS_DATA_MUTATION=NONE");
