import assert from "node:assert/strict";
import { serializeCsv } from "../src/lib/csv.js";

const rows = [{
  "=Formula Header": "ordinary", Material: "=SUM(1,1)", Description: "+cmd",
  Reference: "-formula", Quantity: -5, At: "@name", Tab: "\tcmd", CR: "\rcmd",
  Zero: 0, Positive: 5, Negative: -5, StringNegative: "-5", Comma: "A,B",
  Quote: 'He said "hi"', Newline: "line1\nline2", Unicode: "München 🧪",
}];
const before = structuredClone(rows);
const expectedHeader = "'=Formula Header,Material,Description,Reference,Quantity,At,Tab,CR,Zero,Positive,Negative,StringNegative,Comma,Quote,Newline,Unicode";
const expectedRow = [
  "ordinary", `"'=SUM(1,1)"`, `'+cmd`, `"'-formula"`, "-5", `"'@name"`, `"'\tcmd"`,
  `"'\rcmd"`, "0", "5", "-5", `"'-5"`, `"A,B"`, `"He said ""hi""""`,
  `"line1\nline2"`, "München 🧪",
].join(",");

const actual = serializeCsv(rows);
assert.equal(actual, `${expectedHeader}\n${expectedRow}`);
assert.deepStrictEqual(rows, before, "CSV serialization must not mutate source rows");
assert.equal(serializeCsv([]), "", "empty exports remain a no-op payload");
assert.match(actual, /,0,5,-5,'-5,/, "typed negative numbers must remain numeric while string -5 is neutralized");
console.log("CSV_EXPORT_SHARED_SERIALIZER=PASS");
console.log("CSV_EXPORT_FORMULA_NEUTRALIZATION=PASS");
console.log("CSV_EXPORT_INPUT_MUTATION=NONE");
console.log("PRODUCTION_SAP_POST=NO");