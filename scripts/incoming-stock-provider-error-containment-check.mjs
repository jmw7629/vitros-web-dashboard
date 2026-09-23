import fs from "node:fs";

const source = fs.readFileSync("convex/incomingStockActions.ts", "utf8");
const receiptMigration = fs.readFileSync("supabase/migrations/20260923143000_incoming_receipt_attempt_recovery.sql", "utf8");
const failures = [];

function segment(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

const receive = segment("async function callReceiptRpc", "function requiredAttemptId");
if (!receive) {
  failures.push("persisted receipt RPC transport boundary is missing");
} else {
  const branch = receive.match(/if \(!response\.ok\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  if (!branch) failures.push("persisted receipt RPC non-2xx boundary is missing");
  if (/response\.(?:json|text|arrayBuffer|blob|formData)\s*\(/.test(branch)) {
    failures.push("receipt RPC must never read provider-controlled error bodies");
  }
  if (!branch.includes("new ReceiptRpcHttpError(response.status)")) {
    failures.push("receipt RPC must use the allowlisted status-only failure");
  }
  if (/\.message|\.error/.test(branch)) {
    failures.push("receipt RPC must not reflect provider error fields");
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
if (!commit.includes('"execute_incoming_receipt_attempt"') || !receiptMigration.includes("public.apply_inventory_transition(") || !receiptMigration.includes("'RECEIVE'")) {
  failures.push("confirmed line must keep using persisted attempt -> atomic RECEIVE boundary");
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
