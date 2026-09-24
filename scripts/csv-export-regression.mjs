import assert from "node:assert/strict";
import { serializeCsv } from "../src/lib/csv.mjs";

const rows = [
  {
    Material: "=SUM(1,1)",
    Description: "+cmd",
    Reference: "-formula",
    Quantity: -5,
    Name: "@name",
    PartNo: "\tpart",
    PartCode: "\rpart",
    ZeroVal: 0,
    FiveVal: 5,
    NegFiveVal: -5,
    StrNegFive: "-5",
    CommaVal: "value,with,comma",
    QuoteVal: 'he said "hello"',
    LFVal: "line1\nline2",
    UnicodeVal: "Ünïcödé",
  },
];

const csv = serializeCsv(rows);

function serializeField(val) {
  if (typeof val === "number") {
    return String(val);
  }
  if (val === null || val === undefined) {
    return "";
  }
  let str = String(val);
  const first = str.charAt(0);
  if (first === "=" || first === "+" || first === "-" || first === "@" || first === "\t" || first === "\r") {
    str = "'" + str;
  }
  if (str.includes(",") || str.includes('"') || str.includes("\r") || str.includes("\n")) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// CSV cell extractor: splits on commas not inside double-quote pairs
// Handles RFC 4180: fields with embedded commas are double-quoted, embedded quotes become ""
function extractCells(csvStr: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i < csvStr.length) {
    let cell = "";
    // Check for opening quote
    if (csvStr[i] === '"') {
      i++; // skip opening quote
      while (i < csvStr.length) {
        if (csvStr[i] === '"') {
          if (i + 1 < csvStr.length && csvStr[i + 1] === '"') {
            // Escaped double quote: consume both, add one "
            cell += '"';
            i += 2;
          } else {
            // Closing quote
            i++; // skip closing quote
            break;
          }
        } else {
          cell += csvStr[i];
          i++;
        }
      }
      // Skip the closing quote if we broke out (already incremented i past it)
      if (i < csvStr.length && csvStr[i] !== '"') {
        // we already consumed the closing quote above
      }
    } else {
      while (i < csvStr.length && csvStr[i] !== ",") {
        cell += csvStr[i];
        i++;
      }
    }
    // Skip comma separator
    if (i < csvStr.length && csvStr[i] === ",") {
      i++;
    }
    cells.push(cell);
  }
  return cells;
}

const headerLine = "Material,Description,Reference,Quantity,Name,PartNo,PartCode,ZeroVal,FiveVal,NegFiveVal,StrNegFive,CommaVal,QuoteVal,LFVal,UnicodeVal";

// 1. CSV must start with header row followed by LF
assert.strictEqual(csv.startsWith(headerLine + "\n"), true, "CSV must start with header row followed by LF");

// 2. Extract cells from data row
const dataRow = csv.slice(headerLine.length + 1);
const cells = extractCells(dataRow);
assert.strictEqual(cells.length, 15, `Must have 15 cells, got ${cells.length}`);

// 3. Key invariant: typed numeric -5 remains -5 while string -5 becomes '-5' (with apostrophe prefix)
assert.strictEqual(cells[3], "-5", "typed numeric -5 (Quantity) must remain -5, unapostrophized");
const expectedStrNegFive = serializeField("-5");
assert.strictEqual(cells[10], expectedStrNegFive, `string -5 (StrNegFive) must be "${expectedStrNegFive}" with apostrophe prefix`);

// 4. Numeric -5 must NOT have apostrophe prefix (while string -5 does)
assert.strictEqual(cells[3], "-5", "numeric -5 at index 3 must not have leading apostrophe");
assert(strictEqual(cells[10].startsWith("'"), true, "string -5 at index 10 must have leading apostrophe"));

// 5. CSV must contain RFC-quoted fields for comma, double-quote, LF, CR
// Material has comma inside → RFC-quoted
assert.strictEqual(cells[0].startsWith('"'), true, "Material must be RFC-quoted (contains comma)");
// Description "+cmd" → apostrophe prefix, no RFC quoting needed (no comma/double/CR/LF)
assert.strictEqual(cells[1].startsWith("'"), true, "Description must have apostrophe prefix (starts with +)");
// Reference "-formula" → apostrophe prefix, no RFC quoting
assert.strictEqual(cells[2].startsWith("'"), true, "Reference must have apostrophe prefix (starts with -)");
// Name "@name" → apostrophe prefix
assert.strictEqual(cells[4].startsWith("'"), true, "Name must have apostrophe prefix (starts with @)");
// PartNo "\tpart" → apostrophe prefix (TAB), no RFC quoting
assert.strictEqual(cells[5].startsWith("'"), true, "PartNo must have apostrophe prefix (starts with TAB)");
// PartCode "\rpart" → CR triggers RFC quoting → double-quoted
assert.strictEqual(cells[6].startsWith('"'), true, "PartCode must be RFC-quoted (starts with CR)");
// Comma field → RFC-quoted
assert.strictEqual(cells[11].startsWith('"'), true, "Comma field must be RFC-quoted");
// Quote field with embedded " → RFC-quoted with doubled quotes
assert.strictEqual(cells[12].startsWith('"'), true, "Quote field must be RFC-quoted");
// LF field → RFC-quoted
assert.strictEqual(cells[13].startsWith('"'), true, "LF field must be RFC-quoted");
// Unicode → no quoting needed
assert.strictEqual(cells[14], "Ünïcödé", "Unicode cell must be present unescaped");

// 5. Header must match column order (Object.keys rows[0])
const headerCells = csv.slice(0, csv.indexOf("\n")).split(",");
assert.strictEqual(headerCells.length, 15, "Header must have 15 columns");
const expectedHeader = ["Material", "Description", "Reference", "Quantity", "Name", "PartNo", "PartCode", "ZeroVal", "FiveVal", "NegFiveVal", "StrNegFive", "CommaVal", "QuoteVal", "LFVal", "UnicodeVal"];
for (let i = 0; i < expectedHeader.length; i++) {
  assert.strictEqual(headerCells[i], expectedHeader[i], `Column ${i} must match expected order: expected "${expectedHeader[i]}" got "${headerCells[i]}"`);
}

console.log("CSV_REGRESSION=PASS");