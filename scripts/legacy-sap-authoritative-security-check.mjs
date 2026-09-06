import fs from "node:fs";

const source = fs.readFileSync("convex/inventoryActions.ts", "utf8");
const gateway = fs.readFileSync("convex/supabaseGateway.ts", "utf8");

function requireMatch(input, pattern, message) {
  if (!pattern.test(input)) throw new Error(message);
}

function rejectMatch(input, pattern, message) {
  if (pattern.test(input)) throw new Error(message);
}

function requireText(input, text, message) {
  if (!input.includes(text)) throw new Error(message);
}

requireMatch(source, /rpc\/apply_sap_staging_status_transition/, "legacy SAP actions must use authoritative status RPC");
requireMatch(source, /requireCapability\(ctx,\s*"inventory\.write"\)/, "SAP status actions must enforce server-side inventory.write");
requireMatch(source, /p_actor:\s*actorId/, "authoritative SAP RPC actor must be server-derived");
requireMatch(source, /p_target_status:\s*targetStatus/, "authoritative SAP RPC target status is missing");
requireMatch(source, /p_correlation_id:\s*correlationId/, "authoritative SAP RPC correlation is missing");
requireMatch(source, /crypto\.subtle\.digest\("SHA-256"/, "legacy SAP correlation must be deterministic SHA-256 intent hash");
requireMatch(source, /normalized\.length === 0 \|\| normalized\.length > 250/, "SAP batch bounds are missing");
requireMatch(source, /new Set\(normalized\)\.size !== normalized\.length/, "duplicate SAP row rejection is missing");
requireMatch(source, /UUID_RE\.test\(id\)/, "SAP row UUID validation is missing");
requireMatch(source, /status === "posted" \? "exported" : "ready"/, "legacy posted status must map to authoritative exported");
requireMatch(source, /status !== "ready" && status !== "posted"/, "legacy pending/error changes must fail closed");

rejectMatch(source, /sap_staging\?id=eq\./, "legacy SAP actions must never direct-PATCH sap_staging rows");
rejectMatch(source, /Promise\.all\(ids\.map[\s\S]*sap_staging/, "legacy SAP batch path must be one atomic RPC, not per-row PATCH calls");

const failureBlock = source.match(/if \(!res\.ok\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
if (!failureBlock) throw new Error("Supabase failure boundary not found");
if (/res\.(json|text)\(/.test(failureBlock)) {
  throw new Error("provider-controlled Supabase error bodies must not be reflected");
}

requireText(
  gateway,
  'if (method !== "GET" && /^sap_staging(?:\\?|$)/.test(path)) {',
  "Supabase gateway must fail closed on every direct non-GET sap_staging request",
);
requireText(
  gateway,
  "Legacy direct SAP staging mutation is retired; use the authoritative SAP staging workflow",
  "Supabase gateway retirement boundary must direct callers to the authoritative workflow",
);
requireMatch(gateway, /export const insertSapStaging = action\(/, "legacy insertSapStaging wire name must remain fail-closed compatible");
requireMatch(gateway, /export const updateSapStaging = action\(/, "legacy updateSapStaging wire name must remain fail-closed compatible");
requireText(
  gateway,
  'return sbFetch<any[]>(serviceKey, url, "sap_staging?select=*&order=created_at.desc");',
  "authorized SAP staging read compatibility must remain intact",
);
rejectMatch(gateway, /fetch\(`\$\{url\}\/rest\/v1\/sap_staging/, "SAP staging mutations must not bypass the guarded Supabase gateway");

console.log("LEGACY_SAP_AUTHORITATIVE_RPC=PASS");
console.log("LEGACY_SAP_DIRECT_PATCH=BLOCKED");
console.log("LEGACY_SUPABASE_SAP_INSERT=BLOCKED");
console.log("LEGACY_SUPABASE_SAP_UPDATE=BLOCKED");
console.log("SAP_SERVER_ACTOR=PASS");
console.log("SAP_BATCH_ATOMICITY=PASS");
console.log("SAP_RETRY_CORRELATION=PASS");
console.log("SAP_PROVIDER_ERROR_CONTAINMENT=PASS");
console.log("PRODUCTION_SAP_POST=NO");
