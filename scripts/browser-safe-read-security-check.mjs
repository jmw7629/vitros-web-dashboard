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

// The compatibility helper may remain referenced by the data hook while older
// callers are phased out, but it must never perform a browser network read.
requireTokens(client, "browser client", [
  '"stock"',
  '"audit"',
  '"sap"',
  '"settings"',
  '"rem_summary"',
  'throw new Error("Authenticated server data is unavailable")',
]);
forbidTokens(client, "browser client", [
  "fetch(",
  "/functions/v1/browser-safe-read",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "Authorization",
  "/rest/v1/",
]);

// Bind the application hook to the fail-closed helper and prevent direct
// PostgREST/browser credentials from being reintroduced.
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
  "/rest/v1/rem_analyzers",
  "/rest/v1/rem_lvcc",
  'browserSafeRead<any>("users")',
]);
if (/browserSafeRead<any>\("stock"\)\.catch\s*\(/.test(hook)) {
  throw new Error("critical stock read must fail closed rather than downgrade to empty data");
}

// The deployed compatibility endpoint is now a tombstone: no server secrets,
// no database request construction, and no operational datasets may remain.
requireTokens(edge, "edge tombstone", [
  '"Access-Control-Allow-Methods": "GET, OPTIONS"',
  '"Cache-Control": "no-store, max-age=0"',
  "status: 410",
  "authenticated_server_boundary_required",
]);
forbidTokens(edge, "edge tombstone", [
  "Deno.env.get",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEYS",
  "/rest/v1/",
  "postgrest(",
  "SAFE_DATASETS",
  "stock?select=",
  "audit_log?select=",
  "sap_staging?select=",
  "rem_analyzers?select=",
  "rem_lvcc?select=",
]);

requireTokens(config, "supabase function config", [
  "[functions.browser-safe-read]",
  "verify_jwt = true",
]);

console.log("browser-safe-read retired security invariants: PASS");
