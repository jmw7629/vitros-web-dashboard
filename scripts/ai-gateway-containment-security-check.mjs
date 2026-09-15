import fs from "node:fs";

const source = fs.readFileSync("convex/aiGateway.ts", "utf8");
const failures = [];

const requireMatch = (pattern, message) => {
  if (!pattern.test(source)) failures.push(message);
};
const forbid = (pattern, message) => {
  if (pattern.test(source)) failures.push(message);
};

const runtime = fs.readFileSync("convex/zenRuntime.ts", "utf8");
if (!runtime.includes('if(!response.ok)') || !runtime.includes('e instanceof ZenError?e:new ZenError')) failures.push("Zen provider failures must use the safe error boundary");
if (!runtime.includes('process.env.OPENCODE_ZEN_API_KEY') || /api\\.openai\\.com|process\\.env\\.(OPENAI|OPENCODE_GO)/.test(runtime)) failures.push("Only the dedicated server Zen credential and endpoint may be used");
if (!source.includes('runZen(ctx,') || source.includes('fetch(')) failures.push("OCR must delegate to the controlled gateway");
requireMatch(/const MAX_REFERENCE_PARTS = \d+;/,
  "reference part count must be bounded");
requireMatch(/const MAX_PART_NUMBER_LENGTH = \d+;/,
  "reference part length must be bounded");
requireMatch(/const MAX_REFERENCE_PART_CHARS = \d+;/,
  "aggregate reference part payload must be bounded");
requireMatch(/function normalizeReferenceParts\([\s\S]*partList\.length > MAX_REFERENCE_PARTS[\s\S]*normalized\.length > MAX_PART_NUMBER_LENGTH[\s\S]*totalChars > MAX_REFERENCE_PART_CHARS/s,
  "reference part validation must enforce count, item length, and aggregate bounds");

const capabilityChecks = source.match(/await requireCapability\(ctx, "ai\.ocr"\);/g) ?? [];
if (capabilityChecks.length !== 2) failures.push("both OCR actions must retain server-authoritative ai.ocr authorization");
const normalizedUses = source.match(/normalizeReferenceParts\(partList\)/g) ?? [];
if (normalizedUses.length !== 2) failures.push("both OCR actions must normalize and bound reference parts before outbound use");

forbid(/errBody|\.error\?\.message|sanitizeError/,
  "provider-controlled error bodies/messages must never be reflected");
forbid(/VITE_[A-Z0-9_]*(?:OPENAI|API_KEY)|OPENAI_API_KEY[^\n]*(?:return|args:)/,
  "OpenAI credentials must remain server-only");

if (failures.length) {
  console.error("AI gateway containment security check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("AI_GATEWAY_ERROR_CONTAINMENT=PASS");
console.log("PROVIDER_BODY_REFLECTION=NONE");
console.log("REFERENCE_PART_INPUT_BOUNDS=PASS");
console.log("AI_OCR_CAPABILITY_GATE=PASS");