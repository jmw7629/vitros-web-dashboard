import fs from "node:fs";

const source = fs.readFileSync("convex/incomingStockActions.ts", "utf8");
const failures = [];

function segment(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

const receive = segment("async function applyConfirmedReceive", "export const reviewPackingListDraft");
if (!receive) {
  failures.push("confirmed RECEIVE boundary is missing");
} else {
  const branch = receive.match(/if \(!response\.ok\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  if (!branch) failures.push("confirmed RECEIVE non-2xx boundary is missing");
  if (/response\.(?:json|text|arrayBuffer|blob|formData)\s*\(/.test(branch)) {
    failures.push("confirmed RECEIVE must never read provider-controlled error bodies");
  }
  if (!branch.includes("Receive failed (${response.status})")) {
    failures.push("confirmed RECEIVE must use the allowlisted status-only failure");
  }
  if (/\.message|\.error/.test(branch)) {
    failures.push("confirmed RECEIVE must not reflect provider error fields");
  }
}

const review = segment("export const reviewPackingListDraft", "export const commitConfirmedReceiveLine");
const commit = segment("export const commitConfirmedReceiveLine", null);
if (!review.includes('requireCapability(ctx, "inventory.write")')) {
  failures.push("packing-list review must remain inventory.write authorized");
}
if (!commit.includes('requireCapability(ctx, "inventory.write")')) {
  failures.push("confirmed RECEIVE must remain inventory.write authorized");
}
if (!review.includes('requiresHumanConfirmation: true')) {
  failures.push("packing-list review must preserve explicit human confirmation");
}
if (!review.includes('identityRule: "canonical_part_number_only"') || !review.includes('descriptionUsedForIdentity: false')) {
  failures.push("packing-list identity must remain canonical part-number only");
}
if (!receive.includes('p_mode: "RECEIVE"') || !commit.includes("applyConfirmedReceive")) {
  failures.push("confirmed line must keep using the atomic RECEIVE boundary");
}
if (!source.includes("SUPABASE_SERVICE_ROLE_KEY") || /VITE_[A-Z0-9_]*SERVICE/i.test(source)) {
  failures.push("Supabase service credential must remain server-only");
}

if (failures.length) {
  console.error("Incoming Stock provider error containment check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("INCOMING_STOCK_PROVIDER_ERROR_CONTAINMENT=PASS");
console.log("PROVIDER_ERROR_BODY_REFLECTION=NONE");
console.log("HUMAN_CONFIRMATION=REQUIRED");
console.log("CANONICAL_PART_IDENTITY=PASS");
console.log("ATOMIC_RECEIVE_BOUNDARY=PRESERVED");
