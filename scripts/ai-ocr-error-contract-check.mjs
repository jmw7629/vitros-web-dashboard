import assert from "node:assert/strict";
import fs from "node:fs";
import { AI_ERROR_MESSAGES, aiPublicErrorCode } from "../convex/aiErrorContract.ts";

class TaggedError extends Error {
  constructor(code, message = "provider diagnostic that must never reach the browser") {
    super(message);
    this.code = code;
  }
}

assert.equal(aiPublicErrorCode(new Error("OpenCode Zen key is not configured. Add OPENCODE_ZEN_API_KEY in the server environment.")), "ZEN_NOT_CONFIGURED");
assert.equal(aiPublicErrorCode(new Error("Free-model catalog needs a refresh.")), "MODEL_CATALOG_UNAVAILABLE");
assert.equal(aiPublicErrorCode(new Error("Dashboard AI is paused by Superuser.")), "AI_PAUSED");
assert.equal(aiPublicErrorCode(new TaggedError("provider_rate_limit")), "RATE_LIMIT");
assert.equal(aiPublicErrorCode(new TaggedError("provider_auth")), "PROVIDER_ACCESS_REJECTED");
assert.equal(aiPublicErrorCode(new TaggedError("provider_restricted")), "PROVIDER_RESTRICTED");
assert.equal(aiPublicErrorCode(new TaggedError("timeout")), "TIMEOUT");
assert.equal(aiPublicErrorCode(new TaggedError("unsupported_input")), "UNSUPPORTED_INPUT");
assert.equal(aiPublicErrorCode(new TaggedError("output_limit")), "OUTPUT_LIMIT");
assert.equal(aiPublicErrorCode(new TaggedError("made_up_code", "Bearer secret-provider-body")), "PROVIDER_UNAVAILABLE");
assert(!Object.values(AI_ERROR_MESSAGES).some((message) => /Bearer|secret-provider-body|OPENCODE_ZEN_API_KEY/.test(message)));
const gateway = fs.readFileSync("convex/aiGateway.ts", "utf8");
const pdf = fs.readFileSync("convex/incomingStockPdfOcr.ts", "utf8");
const client = fs.readFileSync("src/lib/aiErrors.ts", "utf8");
const incoming = fs.readFileSync("src/pages/inventory/IncomingStockSecure.tsx", "utf8") + fs.readFileSync("src/pages/inventory/IncomingStockDocument.tsx", "utf8");
const dhr = fs.readFileSync("src/pages/inventory/DhrScanner.tsx", "utf8");
for (const source of [gateway, pdf]) {
  assert(source.includes('new ConvexError({ kind: "ai", code: aiPublicErrorCode(error) })'));
  assert(!source.includes("error.message.slice"));
}
assert(client.includes('kind !== "ai"'));
assert(incoming.includes("safeAiError(error)"));
assert(dhr.includes("safeAiError(error) ?? safeError(error)"));
console.log("AI_OCR_SAFE_ERROR_CONTRACT=PASS");
console.log("AI_OCR_PROVIDER_DIAGNOSTIC_REFLECTION=NONE");
console.log("AI_OCR_MISSING_ZEN_REPORTING=PASS");
