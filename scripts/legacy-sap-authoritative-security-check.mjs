import fs from "node:fs";

const source = fs.readFileSync("convex/inventoryActions.ts", "utf8");

function requireMatch(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function rejectMatch(pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

requireMatch(/rpc\/apply_sap_staging_status_transition/, "legacy SAP actions must use authoritative status RPC");
requireMatch(/requireCapability\(ctx,\s*"inventory\.write"\)/, "SAP status actions must enforce server-side inventory.write");
requireMatch(/p_actor:\s*actorId/, "authoritative SAP RPC actor must be server-derived");
requireMatch(/p_target_status:\s*targetStatus/, "authoritative SAP RPC target status is missing");
requireMatch(/p_correlation_id:\s*correlationId/, "authoritative SAP RPC correlation is missing");
requireMatch(/crypto\.subtle\.digest\("SHA-256"/, "legacy SAP correlation must be deterministic SHA-256 intent hash");
requireMatch(/normalized\.length === 0 \|\| normalized\.length > 250/, "SAP batch bounds are missing");
requireMatch(/new Set\(normalized\)\.size !== normalized\.length/, "duplicate SAP row rejection is missing");
requireMatch(/UUID_RE\.test\(id\)/, "SAP row UUID validation is missing");
requireMatch(/status === "posted" \? "exported" : "ready"/, "legacy posted status must map to authoritative exported");
requireMatch(/status !== "ready" && status !== "posted"/, "legacy pending/error changes must fail closed");

rejectMatch(/sap_staging\?id=eq\./, "legacy SAP actions must never direct-PATCH sap_staging rows");
rejectMatch(/Promise\.all\(ids\.map[\s\S]*sap_staging/, "legacy SAP batch path must be one atomic RPC, not per-row PATCH calls");

const failureBlock = source.match(/if \(!res\.ok\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
if (!failureBlock) throw new Error("Supabase failure boundary not found");
if (/res\.(json|text)\(/.test(failureBlock)) {
  throw new Error("provider-controlled Supabase error bodies must not be reflected");
}

console.log("LEGACY_SAP_AUTHORITATIVE_RPC=PASS");
console.log("LEGACY_SAP_DIRECT_PATCH=BLOCKED");
console.log("SAP_SERVER_ACTOR=PASS");
console.log("SAP_BATCH_ATOMICITY=PASS");
console.log("SAP_RETRY_CORRELATION=PASS");
console.log("SAP_PROVIDER_ERROR_CONTAINMENT=PASS");
console.log("PRODUCTION_SAP_POST=NO");
