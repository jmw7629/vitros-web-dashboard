import fs from "node:fs";

const source = fs.readFileSync("convex/supabaseGateway.ts", "utf8");
const failures = [];

function segment(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

function verifyNon2xxBoundary(name, section, expectedMessage) {
  if (!section) {
    failures.push(`${name} boundary is missing`);
    return;
  }
  const branch = section.match(/if \(!res\.ok\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  if (!branch) {
    failures.push(`${name} non-2xx branch is missing`);
    return;
  }
  if (/res\.(?:json|text|arrayBuffer|blob|formData)\s*\(/.test(branch)) {
    failures.push(`${name} must never read provider-controlled error bodies`);
  }
  if (!branch.includes(expectedMessage)) {
    failures.push(`${name} must return only the allowlisted status-only failure`);
  }
  if (/body|message\?\:|\.message|\.error/.test(branch.replace(expectedMessage, ""))) {
    failures.push(`${name} must not reflect provider-controlled error fields`);
  }
}

verifyNon2xxBoundary(
  "PostgREST",
  segment("async function sbFetch", "function idPath"),
  "Supabase request failed (${res.status})",
);
verifyNon2xxBoundary(
  "Storage upload",
  segment("export const uploadToStorage", "export const deleteFromStorage"),
  "Storage upload failed (${res.status})",
);
verifyNon2xxBoundary(
  "Storage delete",
  segment("export const deleteFromStorage", null),
  "Storage delete failed (${res.status})",
);

if (/const body = await res\.(?:json|text)\(/.test(source)) {
  failures.push("Supabase gateway must not parse provider error bodies anywhere");
}

if (failures.length) {
  console.error("Supabase provider error containment check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("SUPABASE_PROVIDER_ERROR_CONTAINMENT=PASS");
console.log("POSTGREST_ERROR_BODY_REFLECTION=NONE");
console.log("STORAGE_ERROR_BODY_REFLECTION=NONE");
