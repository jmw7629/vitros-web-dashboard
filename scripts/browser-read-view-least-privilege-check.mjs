import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260905190000_browser_read_views_least_privilege.sql";
const sql = readFileSync(migrationPath, "utf8").toLowerCase();

const views = [
  "browser_stock",
  "browser_sap_staging",
  "browser_settings",
  "browser_audit_log",
  "stock_summary",
];

for (const view of views) {
  if (!sql.includes(`alter view public.${view} set (security_invoker = true)`)) {
    throw new Error(`${view} must remain security_invoker`);
  }
  if (!sql.includes(`public.${view}`)) {
    throw new Error(`${view} is missing from the privilege migration`);
  }
}

if (!/revoke\s+insert,\s*update,\s*delete,\s*truncate,\s*references,\s*trigger[\s\S]*from\s+anon,\s*authenticated\s*;/m.test(sql)) {
  throw new Error("browser read views must revoke all DML-style privileges from anon and authenticated");
}

if (!/grant\s+select[\s\S]*to\s+anon,\s*authenticated\s*;/m.test(sql)) {
  throw new Error("browser read views must retain SELECT for anon and authenticated compatibility");
}

if (/grant\s+(all|insert|update|delete|truncate|references|trigger)[\s\S]*to\s+(anon|authenticated)/m.test(sql)) {
  throw new Error("browser read views must never grant write-style privileges to browser roles");
}

console.log("BROWSER_READ_VIEWS_SECURITY_INVOKER=PASS");
console.log("BROWSER_READ_VIEWS_DML_REVOKED=PASS");
console.log("BROWSER_READ_VIEWS_SELECT_PRESERVED=PASS");
