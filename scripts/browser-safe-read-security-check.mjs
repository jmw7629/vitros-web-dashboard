import fs from "node:fs";

const clientPath = "src/lib/browserSafeRead.ts";
const hookPath = "src/hooks/useConvexData.tsx";
const edgePath = "supabase/functions/browser-safe-read/index.ts";
const configPath = "supabase/config.toml";

const client = fs.readFileSync(clientPath, "utf8");
const hook = fs.readFileSync(hookPath, "utf8");
const edge = fs.readFileSync(edgePath, "utf8");
const config = fs.readFileSync(configPath, "utf8");

function requireTokens(source, label, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      throw new Error(`${label} invariant missing: ${token}`);
    }
  }
}

function forbidTokens(source, label, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) {
      throw new Error(`${label} forbidden token found: ${token}`);
    }
  }
}

requireTokens(client, "browser client", [
  '"stock"',
  '"audit"',
  '"sap"',
  '"settings"',
  "/functions/v1/browser-safe-read",
  'method: "GET"',
  'cache: "no-store"',
]);

forbidTokens(client, "browser client", [
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
]);

if (!/throw new Error\(/.test(client)) {
  throw new Error("browser client must fail closed with explicit errors");
}

requireTokens(hook, "browser data hook", [
  'import { browserSafeRead } from "../lib/browserSafeRead"',
  'browserSafeRead<any>("stock")',
  'browserSafeRead<any>("audit").catch(() => [] as any[])',
  'browserSafeRead<any>("sap").catch(() => [] as any[])',
  'browserSafeRead<any>("settings").catch(() => [] as any[])',
  "setError(e instanceof Error ? e.message : \"Failed to load data\")",
  "userRows = [];",
]);

forbidTokens(hook, "browser data hook", [
  "VITE_SUPABASE_ANON_KEY",
  "sbAnonQuery",
  "/rest/v1/stock",
  "/rest/v1/audit_log",
  "/rest/v1/sap_staging",
  "/rest/v1/settings",
  "/rest/v1/users",
  "select=*",
  'browserSafeRead<any>("users")',
]);

const stockSafeRead = 'browserSafeRead<any>("stock")';
const stockIndex = hook.indexOf(stockSafeRead);
if (stockIndex < 0) {
  throw new Error("browser data hook must use the safe stock read");
}
const stockWindow = hook.slice(stockIndex, stockIndex + 120);
if (/\.catch\s*\(/.test(stockWindow)) {
  throw new Error("critical stock safe-read must not be downgraded to an empty fallback");
}

requireTokens(edge, "edge boundary", [
  'new Set(["stock", "audit", "sap", "settings"])',
  '"Access-Control-Allow-Methods": "GET, OPTIONS"',
  '"Cache-Control": "no-store, max-age=0"',
  'if (request.method !== "GET")',
  '"stock?select=id,part_number,description,type,qty_on_hand,min_qty,max_qty,on_plan,bin_location,module,unit_cost,last_activity,status,updated_at&order=part_number.asc"',
  '"audit_log?select=id,action,part_number,user_name,created_at,new_value&order=created_at.desc&limit=500"',
  '"sap_staging?select=id,created_at,mode,part_number,description,qty_on_hand,qty_before,qty_after,movement_type,plant_code,storage_location,export_status&order=created_at.desc"',
  'const allowed = "sapHeaderText,sapMovementADJUST,sapMovementIN,sapMovementOUT,sapPlantCode,sapStorageLocation"',
  'Deno.env.get("SUPABASE_SECRET_KEYS")',
  'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
  'headers.Authorization = `Bearer ${serverKey.value}`',
]);

forbidTokens(edge, "edge boundary", [
  "select=*",
  "ip_address",
  'method: "POST"',
  'method: "PUT"',
  'method: "PATCH"',
  'method: "DELETE"',
]);

if (!/serverKey\.kind === "legacy_service_role"/.test(edge)) {
  throw new Error("edge boundary must gate Bearer authorization to legacy service-role keys only");
}

requireTokens(config, "supabase function config", [
  "[functions.browser-safe-read]",
  "verify_jwt = false",
]);

console.log("browser-safe-read security invariants: PASS");
