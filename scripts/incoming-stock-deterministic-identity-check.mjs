import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const actionsPath = "convex/incomingStockActions.ts";
const source = fs.readFileSync(actionsPath, "utf8");
const sourceFile = ts.createSourceFile(actionsPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const wanted = new Set([
  "canonicalPartNumber",
  "normalizeDocumentRef",
  "normalizeSourcePage",
  "canonicalReceiptLineIdentity",
]);
const declarations = [];
for (const statement of sourceFile.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name && wanted.has(statement.name.text)) {
    declarations.push(statement.getText(sourceFile).replace(/^export\s+/, ""));
  }
}
if (declarations.length !== wanted.size) {
  throw new Error(`Expected ${wanted.size} deterministic identity functions, found ${declarations.length}`);
}

const transpiled = ts.transpileModule(declarations.join("\n\n"), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 },
}).outputText;
const context = { MAX_SOURCE_PAGE_CHARS: 50 };
vm.createContext(context);
vm.runInContext(`${transpiled}\nthis.__identity = { canonicalPartNumber, normalizeDocumentRef, normalizeSourcePage, canonicalReceiptLineIdentity };`, context);
const { canonicalPartNumber, normalizeDocumentRef, normalizeSourcePage, canonicalReceiptLineIdentity } = context.__identity;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Execute the actual production canonicalization functions extracted from the reviewed source.
equal(canonicalPartNumber("  j61239p  "), "J61239P", "canonical part-number normalization");
equal(normalizeDocumentRef("  po   123\n45  "), "PO 123 45", "document-reference normalization");
equal(normalizeSourcePage("  page   2  "), "PAGE 2", "source-page normalization");

const baseline = canonicalReceiptLineIdentity({ documentRef: "PO-123", sourcePage: "Page 2", sourceLineNo: 5 });
const normalizedRetry = canonicalReceiptLineIdentity({ documentRef: " po-123 ", sourcePage: " page  2 ", sourceLineNo: 5 });
equal(baseline, "incoming:PO-123|PAGE 2|5", "bounded receipt-line identity");
equal(normalizedRetry, baseline, "same physical line remains stable across normalized re-review");
assert(canonicalReceiptLineIdentity({ documentRef: "PO-123", sourcePage: "Page 2", sourceLineNo: 6 }) !== baseline, "distinct physical lines must not collapse");
assert(canonicalReceiptLineIdentity({ documentRef: "PO-123", sourcePage: "Page 3", sourceLineNo: 5 }) !== baseline, "distinct pages must not collapse");

// The commit boundary must fail closed rather than inventing a random business identity.
assert(source.includes('if (!args.documentRef?.trim()) throw new Error("Document reference is required for deterministic receipt identity")'), "missing document-reference fail-closed guard is absent");
assert(source.includes("const correlationId = canonicalReceiptLineIdentity({"), "commit boundary is not using deterministic identity");
assert(!source.includes('const correlationId = `incoming:${args.confirmationId.trim()}`'), "random confirmation ID still controls authoritative idempotency");

const imageUi = fs.readFileSync("src/pages/inventory/IncomingStockSecure.tsx", "utf8");
for (const token of [
  "sourceLineNo: row.sourceLineNo || index + 1",
  "page: line.sourcePage",
  "lineNo: line.sourceLineNo",
  "const boundedEffectiveRef = effectiveRef.slice(0, 200)",
  "serverReview(draft, undefined, boundedEffectiveRef)",
]) {
  assert(imageUi.includes(token), `image review provenance invariant missing: ${token}`);
}

const pdfUi = fs.readFileSync("src/pages/inventory/IncomingStockDocument.tsx", "utf8");
assert(pdfUi.includes("sourcePage: line.sourcePage ?? undefined"), "PDF commit dropped source-page provenance");
assert(pdfUi.includes("sourceLineNo: line.sourceLineNo"), "PDF commit dropped source-line provenance");

console.log("DETERMINISTIC_RECEIPT_LINE_ID=PASS");
console.log("MISSING_REFERENCE_FAILS_CLOSED=PASS");
console.log("SOURCE_PROVENANCE_PRESERVED=PASS");
console.log("CORRECTION_REREVIEW_IDENTITY=PASS");
console.log("RANDOM_CONFIRMATION_AUTHORITY=RETIRED");
