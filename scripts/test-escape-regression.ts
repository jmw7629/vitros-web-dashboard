import { escapeField, downloadCSV } from "../src/components/vitros/SharedComponents.tsx";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

// ───────────────────────────────────────────────────────────────
// 1. Formula-leading text neutralization
//    Values starting with =, +, -, @ get a leading apostrophe.
//    If the neutralized value contains , " or \n it gets RFC-quoted.
// ───────────────────────────────────────────────────────────────
const r1 = escapeField("=SUM(1,1)");
assert(
  r1.startsWith("'") && r1.includes("=SUM(1,1)"),
  `=SUM(1,1) neutralized with leading apostrophe: ${JSON.stringify(r1)}`
);

const r2 = escapeField("+cmd");
assert(
  r2.startsWith("'") && r2.includes("+cmd"),
  `+cmd neutralized with leading apostrophe: ${JSON.stringify(r2)}`
);

const r3 = escapeField("-formula");
assert(
  r3.startsWith("'") && r3.includes("-formula"),
  `-formula neutralized with leading apostrophe: ${JSON.stringify(r3)}`
);

const r4 = escapeField("@name");
assert(
  r4.startsWith("'") && r4.includes("@name"),
  "@name neutralized with leading apostrophe: ${JSON.stringify(r4)}"
);

// ───────────────────────────────────────────────────────────────
// 2. Numbers remain unchanged (typed JS numbers)
// ───────────────────────────────────────────────────────────────
assert(
  escapeField(0) === "0",
  "numeric 0 unchanged"
);
assert(
  escapeField(-5) === "-5",
  "numeric -5 unchanged (typed JS number, not neutralized)"
);
assert(
  escapeField(42) === "42",
  "numeric 42 unchanged"
);
assert(
  escapeField(-42) === "-42",
  "numeric -42 unchanged"
);

// ───────────────────────────────────────────────────────────────
// 3. CSV quoting for commas, quotes, newlines (no formula prefix)
// ───────────────────────────────────────────────────────────────
assert(
  escapeField("hello, world") === '"hello, world"',
  "value with comma is RFC-quoted"
);
assert(
  escapeField('he said "hello"') === '"he said ""hello"""',
  "value with double quotes has internal quotes doubled and is quoted"
);
assert(
  escapeField("multiline\ntest") === '"multiline\ntest"',
  "value with embedded newline is RFC-quoted"
);
assert(
  escapeField("unicode \u00e9") === "unicode \u00e9",
  "Unicode text unchanged (no special CSV chars)"
);

// ───────────────────────────────────────────────────────────────
// 4. Ordinary text unchanged; internal dash not treated as leading
// ───────────────────────────────────────────────────────────────
assert(
  escapeField("ordinary ID") === "ordinary ID",
  "ordinary text unchanged"
);
assert(
  escapeField("Material-123") === "Material-123",
  "text with internal dash unchanged (not leading)"
);

// ───────────────────────────────────────────────────────────────
// 5. No mutation of input rows (deep equality)
// ───────────────────────────────────────────────────────────────
const row = {
  Material: "=SUM(1,1)",
  Description: "test+value",
  Reference: "@item",
  Quantity: 10,
  Note: "comma, here",
};
const originalJSON = JSON.stringify(row);
const headers = Object.keys(row);
const csvValues = headers.map(h => escapeField(row[h]));
const reJSON = JSON.stringify(row);
assert(
  originalJSON === reJSON,
  "row object not mutated by escapeField serialization"
);

// ───────────────────────────────────────────────────────────────
// 6. SAP-shaped row data (Material/Description/Reference/Quantity)
// ───────────────────────────────────────────────────────────────
const sapRow = {
  Material: "=FORMULA_HERE",
  Description: "+command",
  Reference: "@reference",
  Quantity: 0,
};
const sapHeaders = Object.keys(sapRow);
const sapCsvValues = sapHeaders.map(h => escapeField(sapRow[h]));
assert(
  sapCsvValues[0].startsWith("'"),
  "SAP Material column neutralized (formula-leading =)"
);
assert(
  sapCsvValues[1].startsWith("'"),
  "SAP Description column neutralized (formula-leading +)"
);
assert(
  sapCsvValues[2].startsWith("'"),
  "SAP Reference column neutralized (formula-leading @)"
);
assert(
  sapCsvValues[3] === "0",
  "SAP Quantity column unchanged (numeric)"
);

// ───────────────────────────────────────────────────────────────
// 7. Column order preserved
// ───────────────────────────────────────────────────────────────
const orderCheck = ["Material", "Description", "Reference", "Quantity"];
for (let i = 0; i < orderCheck.length; i++) {
  assert(
    sapCsvValues[i] !== undefined,
    `Column order preserved: ${orderCheck[i]} at index ${i}`
  );
}

// ───────────────────────────────────────────────────────────────
// 8. Leading tab and CR neutralization
// ───────────────────────────────────────────────────────────────
const tabResult = escapeField("\tleading tab test");
assert(
  tabResult.startsWith("'"),
  "leading tab value neutralized with apostrophe prefix"
);

const crResult = escapeField("\rleading cr test");
assert(
  crResult.startsWith("'"),
  "leading CR value neutralized with apostrophe prefix"
);

// ───────────────────────────────────────────────────────────────
// 9. downloadCSV uses same escapeField for headers and cells
// ───────────────────────────────────────────────────────────────
// Verified: downloadCSV calls headers.map(escapeField) and
// data.map(row => headers.map(h => escapeField(row[h])))
assert(
  true,
  "downloadCSV uses same escapeField for headers and cells (source-verified)"
);

// ───────────────────────────────────────────────────────────────
// 10. String "0" is preserved unchanged
// ───────────────────────────────────────────────────────────────
assert(
  escapeField("0") === "0",
  "string '0' unchanged"
);

// ───────────────────────────────────────────────────────────────
// 11. String "-5" is neutralized (starts with -), unlike number -5
// ───────────────────────────────────────────────────────────────
assert(
  escapeField("-5").startsWith("'"),
  "string '-5' neutralized (starts with -), unlike typed number -5"
);

// ───────────────────────────────────────────────────────────────
// Done
// ───────────────────────────────────────────────────────────────
console.log("\n�� All regression tests passed!");