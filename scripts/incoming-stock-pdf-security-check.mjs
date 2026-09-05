import fs from "node:fs";

const server = fs.readFileSync("convex/incomingStockPdfOcr.ts", "utf8");
const review = fs.readFileSync("convex/incomingStockActions.ts", "utf8");
const ui = fs.readFileSync("src/pages/inventory/IncomingStockDocument.tsx", "utf8");
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
  'process.env.OPENAI_API_KEY',
  'https://api.openai.com/v1/responses',
  'type: "input_file"',
  'data:application/pdf;base64,${pdfBase64}',
  'MAX_PDF_SIZE_BYTES',
  'MAX_PROMPT_LENGTH',
  'MAX_REFERENCE_PARTS',
  'safePdfFilename',
  'Receiving quantity is SHIP QTY / SHIPPED QTY',
  'Do not collapse repeated part lines',
  'Description is informational and must never be used to invent or fuzzy-match',
  'Read every page of the PDF',
  'Do not treat line numbers, page numbers',
  'sanitizeError',
]);
forbidTokens(server, "Incoming Stock PDF server OCR", [
  'VITE_OPENAI_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  '/rest/v1/stock',
  'apply_inventory_transition',
]);

requireTokens(review, "Incoming Stock reviewed receive boundary", [
  'requireCapability(ctx, "inventory.write")',
  'canonical_part_number_only',
  'descriptionUsedForIdentity: false',
  'obj.shippedQuantity',
  'apply_inventory_transition',
  'p_mode: "RECEIVE"',
  'const correlationId = `incoming:${args.confirmationId.trim()}`',
  'actor: String(actorId)',
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

requireTokens(app, "Incoming Stock route", [
  'import { IncomingStockDocument } from "./pages/inventory/IncomingStockDocument"',
  '<Route path="/incoming-stock" element={<IncomingStockDocument />} />',
]);

console.log("Incoming Stock PDF security invariants: PASS");
