import fs from "node:fs";

const source = fs.readFileSync("convex/ViktorSpacesEmail.ts", "utf8");

const failures = [];
const requireMatch = (pattern, message) => {
  if (!pattern.test(source)) failures.push(message);
};
const forbid = (pattern, message) => {
  if (pattern.test(source)) failures.push(message);
};

requireMatch(/if \(!response\.ok\)\s*\{\s*throw providerFailure\(response\.status\);\s*\}/s,
  "non-2xx provider failures must be sanitized to status-only errors");
requireMatch(/try\s*\{\s*result = await response\.json\(\);\s*\}\s*catch\s*\{\s*throw providerFailure\(\);\s*\}/s,
  "invalid provider JSON must fail closed with a sanitized error");
requireMatch(/success\?\: unknown[\s\S]*success !== true/s,
  "provider responses must require explicit success=true");
forbid(/response\.text\s*\(/,
  "provider response bodies must never be reflected into auth errors");
forbid(/result\.error|\$\{\s*[^}]*\.error\s*\}/,
  "provider error strings must never be reflected into auth errors");
forbid(/project_secret[^\n]*throw|throw[^\n]*projectSecret/i,
  "project secret must never be included in thrown errors");

if (failures.length) {
  console.error("Viktor email error security check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("VIKTOR_EMAIL_PROVIDER_ERROR_CONTAINMENT=PASS");
console.log("PROVIDER_BODY_REFLECTION=NONE");
console.log("INVALID_PROVIDER_RESPONSE=FAIL_CLOSED");