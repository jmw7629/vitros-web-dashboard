import fs from "node:fs";

const source = fs.readFileSync("convex/aiGateway.ts", "utf8");
const failures = [];

const requireMatch = (pattern, message) => {
  if (!pattern.test(source)) failures.push(message);
};
const forbid = (pattern, message) => {
  if (pattern.test(source)) failures.push(message);
};

const non2xx = source.match(/if \(!res\.ok\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
if (!non2xx) failures.push("OpenAI non-2xx branch must exist");
if (/res\.(?:json|text|arrayBuffer|blob)\s*\(/.test(non2xx)) {
  failures.push("OpenAI non-2xx branch must never read provider response bodies");
}

requireMatch(/throw new Error\(`OpenAI request failed with status \$\{res\.status\}`\)/,
  "OpenAI non-2xx failures must be status-only");
requireMatch(/function safeOpenAIError\([\s\S]*OpenAI request failed[\s\S]*OpenAI request timed out[\s\S]*OpenAI returned an invalid response/s,
  "browser-visible OCR errors must use an allowlisted sanitizer");
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