import fs from "node:fs";

const server = fs.readFileSync("convex/incomingStockPdfOcr.ts", "utf8");
const review = fs.readFileSync("convex/incomingStockActions.ts", "utf8");
const reviewModule = fs.readFileSync("convex/incomingStockReview.ts", "utf8");
const ui = fs.readFileSync("src/pages/inventory/IncomingStockDocument.tsx", "utf8");
const imageUi = fs.readFileSync("src/pages/inventory/IncomingStockSecure.tsx", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");

function requireTokens(source, label, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`${label} missing invariant: ${token}`);
  }
}
function forbidTokens(source, label, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) throw new Error(`${label} contains forbidden token: ${token}`);
  }
}

requireTokens(server, "Incoming Stock PDF server OCR", [
  'requireCapability(ctx, "ai.ocr")',
  'MAX_PDF_SIZE_BYTES',
  'MAX_PROMPT_LENGTH',
  'MAX_REFERENCE_PARTS',
  'safePdfFilename',
  'runZen(ctx,',
  'purpose:"pdf"',
  'Receiving quantity is SHIP QTY / SHIPPED QTY',
  'Do not collapse repeated part lines',
  'Description is informational and must never be used to invent or fuzzy-match',
  'Read every page of the PDF',
  'Do not treat line numbers, page numbers',
]);
forbidTokens(server, "Incoming Stock PDF server OCR", [
  'VITE_OPENAI_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  '/rest/v1/stock',
  'apply_inventory_transition',
]);

const runtime = fs.readFileSync("convex/zenRuntime.ts", "utf8");
requireTokens(runtime, "Zen PDF transport", ['process.env.OPENCODE_ZEN_API_KEY', 'https://opencode.ai/zen/v1', 'type:"input_file"', 'data:application/pdf;base64,', 'ZenError']);
forbidTokens(runtime, "Zen provider boundary", ['api.openai.com', 'process.env.OPENAI_API_KEY', 'process.env.OPENCODE_GO_API_KEY']);
requireTokens(review, "Incoming Stock reviewed receive boundary", [
  'requireCapability(ctx, "inventory.write")',
  'canonical_part_number_only',
  'descriptionUsedForIdentity: false',
  'apply_inventory_transition',
  'p_mode: "RECEIVE"',
  'canonicalReceiptLineIdentity',
  'actor: String(actorId)',
]);

requireTokens(reviewModule, "Incoming Stock packing-list review", [
  'obj.shippedQuantity',
  'obj.shipped_quantity',
  'indexStockByCanonical',
  'reviewOcrLines',
  'computeAggregateSummary',
  'canonicalReceiptLineIdentity',
]);

requireTokens(ui, "Incoming Stock PDF UI", [
  'accept="application/pdf,.pdf"',
  'reviewPackingListDraft',
  'commitConfirmedReceiveLine',
  'review.requiresHumanConfirmation',
  'review.identityRule !== "canonical_part_number_only"',
  'line.matchStatus === "matched"',
  'Confirm & Receive PDF',
  'Nothing changes inventory until you confirm',
  'Ordered {line.orderedQty}, shipped {line.qtyOcr}. RECEIVE uses shipped quantity.',
]);
forbidTokens(ui, "Incoming Stock PDF UI", [
  'api.openai.com',
  'OPENAI_API_KEY',
  'VITE_OPENAI_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'sbUpdate("stock"',
  'sbInsert("stock"',
  'fetch("/rest/v1',
]);

requireTokens(imageUi, "Incoming Stock image provenance", [
  'sourceLineNo: row.sourceLineNo || index + 1',
  'page: line.sourcePage',
  'lineNo: line.sourceLineNo',
  'documentRefOverride?: string',
  'const boundedEffectiveRef = effectiveRef.slice(0, 200)',
  'serverReview(draft, undefined, boundedEffectiveRef)',
]);

requireTokens(app, "Incoming Stock route", [
  'import { IncomingStockDocument } from "./pages/inventory/IncomingStockDocument"',
]);

if (!/<Route\s+path="\/incoming-stock"\s+element=\{\s*<RoleGuard\s+route="\/incoming-stock"[^>]*>\s*<IncomingStockDocument\s*\/>\s*<\/RoleGuard>\s*\}\s*\/>/.test(app)) {
  throw new Error("Incoming Stock must mount the reviewed document component inside its role guard");
}
console.log("Incoming Stock PDF security invariants: PASS");
