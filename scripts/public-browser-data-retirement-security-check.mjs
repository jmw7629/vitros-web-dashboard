import { readFileSync } from "node:fs";

const helper = readFileSync("src/lib/browserSafeRead.ts", "utf8");
const edge = readFileSync("supabase/functions/browser-safe-read/index.ts", "utf8");
const config = readFileSync("supabase/config.toml", "utf8");

if (/\bfetch\s*\(/.test(helper) || /VITE_SUPABASE_(URL|ANON_KEY)/.test(helper)) {
  throw new Error("browser helper must not make unauthenticated Supabase requests");
}
if (!/throw new Error\("Authenticated server data is unavailable"\)/.test(helper)) {
  throw new Error("browser helper must fail closed when authenticated server reads are unavailable");
}

const forbiddenEdgePatterns = [
  /Deno\.env\.get/,
  /SUPABASE_(SERVICE_ROLE_KEY|SECRET_KEYS)/,
  /\/rest\/v1\//,
  /postgrest\s*\(/,
  /SAFE_DATASETS/,
  /stock\?select=/,
  /audit_log\?select=/,
  /sap_staging\?select=/,
  /rem_analyzers\?select=/,
];
for (const pattern of forbiddenEdgePatterns) {
  if (pattern.test(edge)) throw new Error(`retired Edge function still contains data-proxy behavior: ${pattern}`);
}
if (!/status:\s*410/.test(edge) || !/authenticated_server_boundary_required/.test(edge)) {
  throw new Error("retired Edge function must return a deterministic fail-closed tombstone");
}
if (!/\[functions\.browser-safe-read\][\s\S]*verify_jwt\s*=\s*true/m.test(config)) {
  throw new Error("retired Edge function must keep JWT verification enabled");
}

console.log("PUBLIC_BROWSER_DATA_PROXY=RETIRED");
console.log("BROWSER_FALLBACK=FAIL_CLOSED");
console.log("EDGE_SERVER_CREDENTIAL_ACCESS=ABSENT");
console.log("EDGE_JWT_VERIFICATION=ENABLED");
