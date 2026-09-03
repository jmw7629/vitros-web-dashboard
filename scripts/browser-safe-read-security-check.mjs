import fs from "node:fs";

const target = "src/lib/browserSafeRead.ts";
const source = fs.readFileSync(target, "utf8");

const required = [
  '"stock"',
  '"audit"',
  '"sap"',
  '"settings"',
  "/functions/v1/browser-safe-read",
  'method: "GET"',
  'cache: "no-store"',
];

for (const token of required) {
  if (!source.includes(token)) {
    throw new Error(`browser-safe-read invariant missing: ${token}`);
  }
}

const forbidden = [
  "service_role",
  "SUPABASE_SERVICE_ROLE",
  "VITE_SUPABASE_ANON_KEY",
  "Authorization",
  "/rest/v1/stock",
  "/rest/v1/audit_log",
  "/rest/v1/sap_staging",
  "/rest/v1/settings",
  "/rest/v1/users",
  "select=*",
  'method: "POST"',
  'method: "PUT"',
  'method: "PATCH"',
  'method: "DELETE"',
];

for (const token of forbidden) {
  if (source.includes(token)) {
    throw new Error(`browser-safe-read forbidden token found: ${token}`);
  }
}

if (!/throw new Error\(/.test(source)) {
  throw new Error("browser-safe-read must fail closed with explicit errors");
}

console.log("browser-safe-read security invariants: PASS");
