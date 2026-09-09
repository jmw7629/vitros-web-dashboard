import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const identityPath = "convex/incomingStockDeterministicIdentity.ts";
const actionsPath = "convex/incomingStockActions.ts";
const identitySource = fs.readFileSync(identityPath, "utf8");
const actionsSource = fs.readFileSync(actionsPath, "utf8");
const identitySourceFile = ts.createSourceFile(identityPath, identitySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const wanted = new Set([
  "canonicalPartNumber",
  "normalizeDocumentRef",
  "normalizeSourcePage",
  "canonicalReceiptLineIdentity",
  "MAX_SOURCE_PAGE_CHARS",
  "MAX_DOCUMENT_REF_CHARS",
]);
const declarations = [];
for (const statement of identitySourceFile.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name && wanted.has(statement.name.text)) {
    declarations.push(statement.getText(identitySourceFile).replace(/^export\s+/, ""));
  }
  if (ts.isVariableStatement(statement)) {
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && wanted.has(decl.name.text)) {
        declarations.push(statement.getText(identitySourceFile).replace(/^export\s+/, ""));
        break;
      }
    }
  }
}
if (declarations.length < 4) {
  throw new Error(`Expected at least 4 deterministic identity exports, found ${declarations.length}`);
}

const transpiled = ts.transpileModule(declarations.join("\n\n"), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 },
}).outputText;
const context = { MAX_SOURCE_PAGE_CHARS: 50 };
vm.createContext(context);
vm.runInContext(`${transpiled}\nthis.__identity = { canonicalPartNumber, normalizeDocumentRef, normalizeSourcePage, canonicalReceiptLineIdentity, MAX_SOURCE_PAGE_CHARS, MAX_DOCUMENT_REF_CHARS };`, context);
const { canonicalPartNumber, normalizeDocumentRef, normalizeSourcePage, canonicalReceiptLineIdentity, MAX_SOURCE_PAGE_CHARS, MAX_DOCUMENT_REF_CHARS } = context.__identity;

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
assert(
  actionsSource.includes('"Document reference is required for deterministic receipt identity"') &&
    actionsSource.includes("if (!args.documentRef?.trim())") &&
    actionsSource.includes("throw new Error"),
  "missing document-reference fail-closed guard is absent",
);
assert(actionsSource.includes("const correlationId = canonicalReceiptLineIdentity({"), "commit boundary is not using deterministic identity");
assert(!actionsSource.includes('const correlationId = `incoming:${args.confirmationId.trim()}`'), "random confirmation ID still controls authoritative idempotency");

// The authoritative material request batch reference must be the SAME normalized
// document reference used by the correlation identity, so semantically equivalent
// retries are idempotent while genuinely changed batch references still conflict.
const batchRef1 = normalizeDocumentRef("  po-123 ");
const batchRef2 = normalizeDocumentRef("PO-123");
equal(batchRef1, batchRef2, "whitespace/case-equivalent document refs normalize to identical batch reference");
equal(canonicalReceiptLineIdentity({ documentRef: batchRef1, sourcePage: "1", sourceLineNo: 1 }), canonicalReceiptLineIdentity({ documentRef: batchRef2, sourcePage: "1", sourceLineNo: 1 }), "equivalent refs share the same correlation identity");
assert(normalizeDocumentRef("PO-999") !== batchRef1, "genuinely changed batch reference differs (RPC IS DISTINCT FROM conflict)");
assert(actionsSource.includes("const normalizedBatchRef = normalizeDocumentRef(args.documentRef);"), "commit boundary is not deriving the authoritative batch reference from normalizeDocumentRef");
assert(actionsSource.includes("batchId: normalizedBatchRef,"), "authoritative p_batch_id material request is not the normalized document reference");

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
console.log("MATERIAL_REQUEST_BATCH_NORMALIZED=PASS");