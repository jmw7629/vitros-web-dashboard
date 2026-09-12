// Incoming Stock deterministic identity unit tests - runnable Node harness.
// Relocated from convex/incomingStockDeterministicIdentity.test.ts which lived under
// the production Convex function directory with undefined jest globals and imports
// from removed exports in incomingStockActions. That file caused real backend
// typecheck failures (npx tsc -p convex/tsconfig.json --noEmit).
// This script transpiles and executes the EXACT exported production functions from
// convex/incomingStockDeterministicIdentity.ts via TypeScript transpilation into a
// vm sandbox, matching the established scripts/incoming-stock-acceptance.mjs approach.
// Run with: node scripts/incoming-stock-identity-unit.mjs

import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const identityPath = "convex/incomingStockDeterministicIdentity.ts";

// ---- Extract exact exported production functions/constants from TS source (acceptance approach) ----
function extractProductions(sourcePath, wantedFunctions, wantedConstants) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functionSet = new Set(wantedFunctions);
  const constantSet = new Set(wantedConstants);
  const declarations = [];
  const seenFunctions = new Set();
  const seenConstants = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && functionSet.has(statement.name.text) && !seenFunctions.has(statement.name.text)) {
      declarations.push(statement.getText(sourceFile).replace(/^export\s+/, ""));
      seenFunctions.add(statement.name.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && constantSet.has(decl.name.text) && !seenConstants.has(decl.name.text)) {
          declarations.push(statement.getText(sourceFile).replace(/^export\s+/, ""));
          seenConstants.add(decl.name.text);
          break;
        }
      }
    }
  }
  for (const fn of functionSet) {
    if (!seenFunctions.has(fn)) throw new Error(`Missing production function ${fn} in ${sourcePath}`);
  }
  for (const c of constantSet) {
    if (!seenConstants.has(c)) throw new Error(`Missing production constant ${c} in ${sourcePath}`);
  }
  return declarations.join("\n\n");
}

const identityDecls = extractProductions(
  identityPath,
  ["canonicalPartNumber", "normalizeDocumentRef", "normalizeSourcePage", "canonicalReceiptLineIdentity"],
  ["MAX_SOURCE_PAGE_CHARS", "MAX_DOCUMENT_REF_CHARS"],
);

const transpiled = ts.transpileModule(identityDecls, {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 },
}).outputText;

const context = {
  MAX_SOURCE_PAGE_CHARS: 50,
  MAX_DOCUMENT_REF_CHARS: 200,
  Map, Set, Number, String, Boolean, JSON, Array, Object, Math,
  isFinite, isNaN, parseInt, parseFloat, Infinity, NaN, undefined,
  RangeError, TypeError, Error, RegExp, Date,
};
vm.createContext(context);
vm.runInContext(
  `${transpiled}\nthis.__api = {\n` +
  "  canonicalPartNumber, normalizeDocumentRef, normalizeSourcePage, canonicalReceiptLineIdentity,\n" +
  "  MAX_SOURCE_PAGE_CHARS, MAX_DOCUMENT_REF_CHARS,\n" +
  "};",
  context,
);
const {
  canonicalPartNumber,
  normalizeDocumentRef,
  normalizeSourcePage,
  canonicalReceiptLineIdentity,
  MAX_SOURCE_PAGE_CHARS,
  MAX_DOCUMENT_REF_CHARS,
} = context.__api;

// ---- Test harness (counts actually executed) ----
let total = 0;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function test(name, fn) {
  total += 1;
  try {
    fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL: ${name}: ${e.message}`);
    console.error(e.stack);
  }
}

console.log("=== Incoming Stock Deterministic Identity Unit Tests (production identity module) ===\n");
console.log(`Source: ${identityPath}`);
console.log(`MAX_SOURCE_PAGE_CHARS=${MAX_SOURCE_PAGE_CHARS} MAX_DOCUMENT_REF_CHARS=${MAX_DOCUMENT_REF_CHARS}\n`);

// ===== Suite: Deterministic Receipt Identity Canonicalization =====
console.log("Suite: Deterministic Receipt Identity Canonicalization — canonicalPartNumber");
test("canonicalPartNumber normalizes part numbers to uppercase trimmed", () => {
  equal(canonicalPartNumber("  abc-123  "), "ABC-123", "trim+uppercase");
  equal(canonicalPartNumber("J61239"), "J61239", "already canonical");
  equal(canonicalPartNumber("j61239p"), "J61239P", "lowercase to uppercase");
});
test("canonicalPartNumber preserves meaningful internal characters", () => {
  equal(canonicalPartNumber("ABC-123/XYZ"), "ABC-123/XYZ", "slash preserved");
  equal(canonicalPartNumber("PART.NO.1"), "PART.NO.1", "dots preserved");
});

console.log("\nSuite: normalizeDocumentRef");
test("normalizeDocumentRef normalizes document references conservatively", () => {
  equal(normalizeDocumentRef("  PO-12345  "), "PO-12345", "trimmed");
  equal(normalizeDocumentRef("PACKING SLIP 001"), "PACKING SLIP 001", "preserved");
  equal(normalizeDocumentRef("receipt\n\t123"), "RECEIPT 123", "newline/tab collapsed and uppercased");
});
test("normalizeDocumentRef collapses whitespace but preserves meaningful separators", () => {
  equal(normalizeDocumentRef("PO   12345"), "PO 12345", "multiple spaces collapsed");
  equal(normalizeDocumentRef("DELIVERY\tNOTE\n42"), "DELIVERY NOTE 42", "tab/newline collapsed");
});

console.log("\nSuite: normalizeSourcePage");
test("normalizeSourcePage normalizes page identifiers", () => {
  equal(normalizeSourcePage("1"), "1", "numeric page");
  equal(normalizeSourcePage("Page 3"), "PAGE 3", "case normalized");
  equal(normalizeSourcePage("  page  5 of 8  "), "PAGE 5 OF 8", "whitespace/case collapsed");
});
test("normalizeSourcePage truncates to MAX_SOURCE_PAGE_CHARS (50)", () => {
  const longPage = "A".repeat(100);
  equal(normalizeSourcePage(longPage).length, 50, "truncated to 50");
  equal(normalizeSourcePage(longPage).length, MAX_SOURCE_PAGE_CHARS, "matches constant");
  // Ensure slice is from start
  equal(normalizeSourcePage(longPage), "A".repeat(50), "slice from start");
});

console.log("\nSuite: canonicalReceiptLineIdentity");
test("generates stable identity from documentRef + page + lineNo", () => {
  const identity1 = canonicalReceiptLineIdentity({ documentRef: "PO-12345", sourcePage: "1", sourceLineNo: 3 });
  const identity2 = canonicalReceiptLineIdentity({ documentRef: "PO-12345", sourcePage: "1", sourceLineNo: 3 });
  equal(identity1, identity2, "stable across calls");
  equal(identity1, "incoming:PO-12345|1|3", "expected format");
});
test("is stable across reload/re-OCR/re-review of same physical line", () => {
  const firstPass = canonicalReceiptLineIdentity({ documentRef: "PACKING SLIP 001", sourcePage: "Page 2", sourceLineNo: 5 });
  const reOcr = canonicalReceiptLineIdentity({ documentRef: "PACKING SLIP 001", sourcePage: "Page 2", sourceLineNo: 5 });
  const reReview = canonicalReceiptLineIdentity({ documentRef: "PACKING SLIP 001", sourcePage: "Page 2", sourceLineNo: 5 });
  equal(firstPass, reOcr, "firstPass==reOcr");
  equal(reOcr, reReview, "reOcr==reReview");
  equal(firstPass, "incoming:PACKING SLIP 001|PAGE 2|5", "normalized identity");
});
test("differs when documentRef differs", () => {
  const id1 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: 1 });
  const id2 = canonicalReceiptLineIdentity({ documentRef: "PO-2", sourcePage: "1", sourceLineNo: 1 });
  assert(id1 !== id2, "different docRef should differ");
});
test("differs when sourcePage differs", () => {
  const id1 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: 1 });
  const id2 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "2", sourceLineNo: 1 });
  assert(id1 !== id2, "different page should differ");
});
test("differs when sourceLineNo differs", () => {
  const id1 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: 1 });
  const id2 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: 2 });
  assert(id1 !== id2, "different lineNo should differ");
});
test("handles null/undefined sourcePage with PAGE_UNKNOWN fallback", () => {
  const id1 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: null, sourceLineNo: 1 });
  const id2 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: undefined, sourceLineNo: 1 });
  equal(id1, id2, "null and undefined same fallback");
  equal(id1, "incoming:PO-1|PAGE_UNKNOWN|1", "PAGE_UNKNOWN fallback");
});
test("handles invalid sourceLineNo with 0 fallback", () => {
  const id1 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: 0 });
  const id2 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: -1 });
  equal(id1, "incoming:PO-1|1|0", "0 fallback for 0");
  equal(id2, "incoming:PO-1|1|0", "0 fallback for -1");
});
test("handles non-integer sourceLineNo with 0 fallback", () => {
  const id = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: 1.5 });
  equal(id, "incoming:PO-1|1|0", "non-integer fallback");
  const idNaN = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: NaN });
  equal(idNaN, "incoming:PO-1|1|0", "NaN fallback");
});

// ===== Suite: Provenance Preservation =====
console.log("\nSuite: Provenance Preservation");
test("preserves documentRef, sourcePage, sourceLineNo through pipeline", () => {
  const docRef = "DELIVERY NOTE 42";
  const page = "3";
  const lineNo = 7;
  const identity = canonicalReceiptLineIdentity({ documentRef: docRef, sourcePage: page, sourceLineNo: lineNo });
  assert(identity.includes("DELIVERY NOTE 42"), "contains docRef");
  assert(identity.includes("3"), "contains page");
  assert(identity.includes("7"), "contains lineNo");
  // Use regex match
  assert(/^incoming:DELIVERY NOTE 42\|3\|7$/.test(identity), "matches expected pattern");
});
test("multi-page/source-line provenance is distinct", () => {
  const page1Line1 = canonicalReceiptLineIdentity({ documentRef: "PO-100", sourcePage: "1", sourceLineNo: 1 });
  const page1Line2 = canonicalReceiptLineIdentity({ documentRef: "PO-100", sourcePage: "1", sourceLineNo: 2 });
  const page2Line1 = canonicalReceiptLineIdentity({ documentRef: "PO-100", sourcePage: "2", sourceLineNo: 1 });
  assert(page1Line1 !== page1Line2, "line 1 != line 2 same page");
  assert(page1Line1 !== page2Line1, "page1 != page2");
  assert(page1Line2 !== page2Line1, "page1Line2 != page2Line1");
});

// ===== Suite: Canonical Part Number Values =====
console.log("\nSuite: Canonical Part Number Values");
test("canonical part number is stable", () => {
  const canonical = canonicalPartNumber("J61239");
  equal(canonical, "J61239", "canonical J61239");
  equal(canonicalPartNumber("J61239"), canonicalPartNumber("J61239"), "same canonical equals");
  // Description is display metadata only — not used in canonicalization
  assert(canonicalPartNumber("J61239") === "J61239", "description irrelevant to PN identity");
});
test("one-character wrong PN is treated as different part", () => {
  assert(canonicalPartNumber("J61239") !== canonicalPartNumber("J61238"), "J61239 != J61238");
  assert(canonicalPartNumber("J61239") !== canonicalPartNumber("J61239P"), "J61239 != J61239P");
  assert(canonicalPartNumber("ABC-123") !== canonicalPartNumber("ABC-124"), "ABC-123 != ABC-124");
});
test("blank part number normalizes to empty", () => {
  equal(canonicalPartNumber(""), "", "empty -> empty");
  equal(canonicalPartNumber("   "), "", "whitespace-only -> empty");
});

// ===== Suite: Correction/Re-review Stability =====
console.log("\nSuite: Correction/Re-review Stability");
test("corrected line retains same deterministic identity", () => {
  const original = canonicalReceiptLineIdentity({ documentRef: "PO-500", sourcePage: "2", sourceLineNo: 3 });
  const afterCorrection = canonicalReceiptLineIdentity({ documentRef: "PO-500", sourcePage: "2", sourceLineNo: 3 });
  equal(original, afterCorrection, "correction retains identity");
});

// ===== Summary =====
console.log("\n=== SUMMARY ===");
console.log(`TOTAL_EXECUTED=${total}`);
console.log(`PASSED=${passed}`);
console.log(`FAILED=${failed}`);

if (failed > 0) {
  console.error(`\nFAILED ${failed}/${total} tests`);
  process.exit(1);
} else {
  console.log(`\nALL ${passed}/${total} DETERMINISTIC IDENTITY TESTS PASSED`);
  console.log("DETERMINISTIC_IDENTITY_UNIT=PASS");
  console.log("PRODUCTION_IDENTITY_MODULE_EXECUTED");
}
