// Execute the production parser. Real workbook arguments remain private and are
// never copied into the repository; output contains aggregate metadata only.
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import ts from "typescript";
import * as XLSX from "xlsx";

const source = fs.readFileSync("src/lib/remOperationalWorkbook.ts", "utf8")
  .replace(/^import \* as XLSX from "xlsx";$/m, "")
  .replace(/^export /gm, "");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.length ?? 0, 0, "parser transpilation diagnostics");
const context = vm.createContext({ XLSX, Date, console });
vm.runInContext(`${compiled.outputText}\nthis.parse = parseRemOperationalWorkbook;`, context);
const parse = (book, year = 2026) => JSON.parse(JSON.stringify(context.parse(book, year)));
const book = (sheets = {}) => {
  const result = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(result, XLSX.utils.aoa_to_sheet(rows), name);
  return result;
};
const offsetSheet = (sheet, rowOffset, colOffset) => {
  const shifted = {};
  for (const [address, cell] of Object.entries(sheet)) {
    if (!/^[A-Z]+[1-9]\d*$/.test(address)) continue;
    const position = XLSX.utils.decode_cell(address);
    shifted[XLSX.utils.encode_cell({ r: position.r + rowOffset, c: position.c + colOffset })] = { ...cell };
  }
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  shifted["!ref"] = XLSX.utils.encode_range({
    s: { r: range.s.r + rowOffset, c: range.s.c + colOffset },
    e: { r: range.e.r + rowOffset, c: range.e.c + colOffset },
  });
  return shifted;
};
const fieldHeaders = ["2026 order", "Duplicate", "Posting Date", "Batch", "YYYY-MM", "Cleanliness", "Cabinetry", "Build Quality", "Final Line", "Release", "Release FPY", "$ parts at Install", "1st 90", "Status", "Install Date", "Country", "Parts replaced during install, not part of Certified", "Parts also replaced in Certified", "FPY Goal"];
const fieldRow = [2026, 1, "2026-01-01", "56001234", "202601", null, null, null, 17, 11, "100", 0, null, null, "01/23/2026", "US", null, null, 0.95];
const certHeaders = ["Key", "Year Month", "Eqp JNo", "Parts Feedback Cd", "SO No", "SO Part Ln No", "Parts Link Lbr Line No", "Part No", "Part Dsc", "Sum of Parts Qty", "Sum of Part Cost USD", "Sum of All Cost USD", "Parts SO Line Type"];
const certRow = (line = 1) => ["J56001234-J12345", 202601, "J56001234", "OK", "SO100", line, 1, "J12345", "Synthetic part", 2, 3.25, 4.5, "C"];
const certifiedBook = () => book({ "Certified Parts": [certHeaders, certRow(), certRow(2), ["-", "Total", null, null, null, null, null, null, null, 4, 6.5, 9], [], [null, "Applied filters: synthetic"]] });
const installHeaders = ["Replaced in Service", "Key", "Year Month", "SO No", "Eqp WW Region Cd", "Eqp Country Cd", "Eqp OC Product Family", "Eqp JNo", "Problem Cd", "Parts Feedback Cd", "Part No", "Part Dsc", "Sum of Parts Qty", "Sum of Cost USD", "Sum of Part Cost USD", "Parts Complete LOC Dt Tm", "Parts Tech Cd", "Parts Tech Nm", "Parts Memo Service", "Parts Memo Resolution", "SO Feedback", "Install Feedback Notes", "OMNI Internal Comments"];
const installRow = [null, "J56001234-J12345", 202601, "SO100", "NA", "US", "VITROS", "J56001234", "OK", "OK", "J12345", "Synthetic part", "2", 3, 4, "2026-01-23 14:05:06", null, null, null, "A long note ".repeat(2000)];
const lvccBook = () => book({ "LVCC DHR Reviews": [
  ["J726663P"], ["week", "Start", "Total", "US36 1000", "<12.37", 1, 2],
  [1, "2026-12-29", 1, null, null, "001", "002"], [], [],
  ["J726664P"], ["week", "Start", "Total", null, null, 1],
  [2, "2026-01-05", null, 0, null, "003", null, null, "004"],
] });
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

test("absent operational sheets are disclosed without invented records", () => {
  const result = parse(book()); assert.equal(result.records.length, 0); assert.equal(result.warnings.length, 6);
});
test("field source counts, blanks, mixed FPY, and date provenance", () => {
  const result = parse(book({ "Field Status VITROS": [fieldHeaders, fieldRow] }));
  const data = result.records[0].data;
  assert.equal(data.finalLine, 17); assert.equal(data.release, 11); assert.equal(data.partsAtInstallUsd, 0);
  assert.equal(data.releaseFpyPct, 100); assert.equal(data.sourceReleaseFpy, "100");
  assert.equal(data.sourceNumericText.releaseFpyPct, "100"); assert.equal(data.fpyGoalPct, 95);
  assert.equal(data.installDate, "2026-01-23"); assert.equal(data.sourceInstallDate, "01/23/2026");
  assert.equal(data.status, undefined); assert.equal(data.yearMonth, "2026-01");
});
test("order references and explicit TBD dates retain source meaning", () => {
  const fixture = book({ "Field Status VITROS": [fieldHeaders, fieldRow] });
  fixture.Sheets["Field Status VITROS"].A2 = { t: "s", v: "2026-52" };
  fixture.Sheets["Field Status VITROS"].C2 = { t: "s", v: "TBD" };
  const result = parse(fixture); const data = result.records[0].data;
  assert.equal(data.orderReference, "2026-52"); assert.equal(data.sourcePostingDate, "TBD");
  assert.equal(data.postingDate, undefined); assert(result.warnings.some((message) => message.includes("date is TBD")));
});
test("renamed field sheet retains internal header recognition", () => {
  const result = parse(book({ "Field report renamed": [fieldHeaders, fieldRow] }));
  assert.equal(result.counts.field_status, 1); assert.equal(result.records[0].sourceSheet, "Field report renamed");
});
test("non-A1 field range retains its first record and absolute source coordinates", () => {
  const fixture = book({ "Field Status VITROS": [fieldHeaders, fieldRow] });
  fixture.Sheets["Field Status VITROS"] = offsetSheet(fixture.Sheets["Field Status VITROS"], 2, 2);
  const result = parse(fixture); assert.equal(result.counts.field_status, 1);
  assert.equal(result.records[0].sourceRow, 4); assert.equal(result.records[0].data.batch, "56001234");
  assert.equal(result.records[0].data.finalLine, 17); assert.equal(result.records[0].data.installDate, "2026-01-23");
  assert(result.warnings.some((message) => message.includes("Field Status VITROS!M4")));
  fixture.Sheets["Field Status VITROS"].M4 = { t: "e", v: 23, f: "SUM(#REF!)", w: "#REF!" };
  assert.throws(() => parse(fixture), /Field Status VITROS!M4.*cached Excel error/);
});
test("non-A1 LVCC range preserves section rows and listed review cell addresses", () => {
  const fixture = lvccBook(); fixture.Sheets["LVCC DHR Reviews"] = offsetSheet(fixture.Sheets["LVCC DHR Reviews"], 2, 0);
  const result = parse(fixture); assert.equal(result.counts.lvcc_reviews, 2);
  assert.equal(result.records[0].sourceRow, 5); assert.equal(result.records[0].data.reviewIds[0].sourceCell, "F5");
  assert.equal(result.records[1].sourceRow, 10); assert.equal(result.records[1].data.reviewIds[1].sourceCell, "I10");
  assert(result.warnings.some((message) => message.includes("LVCC DHR Reviews!B5")));
});
test("field signatures never reuse one worksheet for both products", () => {
  for (const name of ["Field Status VITROS", "Renamed field status"]) {
    const result = parse(book({ [name]: [[...fieldHeaders, "Comment"], [...fieldRow, "Synthetic note"]] }));
    assert.equal(result.counts.field_status, 1); assert.equal(result.records[0].data.product, "VITROS");
    assert(result.warnings.some((message) => message.startsWith("Field Status VISION: sheet absent")));
  }
  const result = parse(book({ "Field Status VISION": [[...fieldHeaders, "Comment"], [...fieldRow, "Synthetic note"]] }));
  assert.equal(result.counts.field_status, 1); assert.equal(result.records[0].data.product, "VISION");
});
test("required named sheet rejects wrong or duplicate headers", () => {
  assert.throws(() => parse(book({ "Field Status VITROS": [["Batch"], ["56001234"]] })), /headers/);
  assert.throws(() => parse(book({ "Field Status VITROS": [[...fieldHeaders, "Batch"], fieldRow] })), /ambiguous Batch/);
});
test("duplicate natural identity rejects without first-match loss", () => {
  assert.throws(() => parse(book({ "Field Status VITROS": [fieldHeaders, fieldRow, fieldRow] })), /duplicate field_status natural key/);
  const fixture = certifiedBook(); fixture.Sheets["Certified Parts"].F3.v = 1;
  assert.throws(() => parse(fixture), /duplicate certified_parts natural key/);
});
test("formula cache errors and absent formula results fail", () => {
  const fixture = book({ "Field Status VITROS": [fieldHeaders, fieldRow] });
  fixture.Sheets["Field Status VITROS"].N2 = { t: "e", f: "1/0", v: 7 };
  assert.throws(() => parse(fixture), /N2.*cached Excel error/);
  fixture.Sheets["Field Status VITROS"].N2 = { t: "z", f: "A1" };
  assert.throws(() => parse(fixture), /N2.*no cached value/);
  const reviewFixture = lvccBook(); reviewFixture.Sheets["LVCC DHR Reviews"].C5 = { t: "e", v: 7, f: "SUM(C3:C4)" };
  assert.throws(() => parse(reviewFixture), /C5.*cached Excel error/);
});
test("malformed numbers and impossible calendar dates fail", () => {
  const fixture = book({ "Field Status VITROS": [fieldHeaders, fieldRow] });
  fixture.Sheets["Field Status VITROS"].L2 = { t: "s", v: "3oops" };
  assert.throws(() => parse(fixture), /malformed numeric/);
  fixture.Sheets["Field Status VITROS"].L2 = { t: "n", v: 0 };
  fixture.Sheets["Field Status VITROS"].O2 = { t: "s", v: "02/30/2026" };
  assert.throws(() => parse(fixture), /invalid calendar date/);
});
test("LVCC source discrepancies and cells beyond numbered headers survive", () => {
  const result = parse(lvccBook()); assert.equal(result.counts.lvcc_reviews, 2);
  const a = result.records[0].data; const b = result.records[1].data;
  assert.equal(a.weekStart, "2025-12-29"); assert.equal(a.sourceWeekStart, "2026-12-29");
  assert.equal(a.recordedTotal, 1); assert.equal(a.listedCount, 2); assert.equal(a.totalDifference, 1);
  assert.equal(a.reviewIds[0].value, "001"); assert.equal(b.recordedTotal, undefined);
  assert.equal(b.listedCount, 2); assert.equal(b.reviewIds[1].sourceCell, "I8"); assert.equal(b.sourceColumnD, 0);
  assert(result.warnings.some((text) => text.includes("conflicts")));
});
test("LVCC review payload with missing week or date cannot disappear", () => {
  for (const missingCell of ["A3", "B3"]) {
    const fixture = lvccBook(); delete fixture.Sheets["LVCC DHR Reviews"][missingCell];
    assert.throws(() => parse(fixture), /requires both week and Start date/);
  }
  const fixture = lvccBook(); delete fixture.Sheets["LVCC DHR Reviews"].A3; delete fixture.Sheets["LVCC DHR Reviews"].B3;
  assert.throws(() => parse(fixture), /requires both week and Start date/);
});
test("LVCC skips only verified formula subtotals and adjacent markers", () => {
  const fixture = lvccBook(); const sheet = fixture.Sheets["LVCC DHR Reviews"];
  sheet.A4 = { t: "n", v: 15 }; sheet.C5 = { t: "n", v: 1, f: "SUM(C3:C4)" };
  assert.equal(parse(fixture).counts.lvcc_reviews, 2);
  sheet.C5 = { t: "n", v: 1 }; assert.throws(() => parse(fixture), /requires both week and Start date/);
});
test("certified lines retain repeated equipment-part keys and reconcile footer", () => {
  const result = parse(certifiedBook()); assert.equal(result.counts.certified_parts, 2);
  assert.notEqual(result.records[0].sourceKey, result.records[1].sourceKey);
  assert.equal(result.records[0].data.equipmentPartKey, result.records[1].data.equipmentPartKey);
  assert(result.warnings.some((text) => text.includes("source Total reconciled")));
  const fixture = certifiedBook(); fixture.Sheets["Certified Parts"].J4.v = 5;
  assert.throws(() => parse(fixture), /source total does not reconcile/);
});
test("certified missing month survives while missing line identity rejects", () => {
  const fixture = certifiedBook(); delete fixture.Sheets["Certified Parts"].B2;
  const result = parse(fixture); assert.equal(result.counts.certified_parts, 2);
  assert.equal(result.records[0].data.yearMonth, undefined); assert.equal(result.records[0].data.sourceYearMonth, undefined);
  assert(result.warnings.some((message) => message.includes("1 lines have no source year month")));
  delete fixture.Sheets["Certified Parts"].F2; assert.throws(() => parse(fixture), /required value missing/);
});
test("install costs remain distinct and source notes are not truncated", () => {
  const result = parse(book({ "Install Parts": [installHeaders, installRow] })); const data = result.records[0].data;
  assert.equal(data.costUsd, 3); assert.equal(data.partCostUsd, 4); assert.equal(data.quantity, 2);
  assert.equal(data.sourceNumericText.quantity, "2"); assert.equal(data.resolutionMemo, installRow[19].trim());
  assert.equal(result.records[0].sourceKey, "history:install_parts:SO100:J56001234:J12345");
});
test("part history identities survive date correction and workbook year rollover", () => {
  const fixture = book({ "Install Parts": [installHeaders, installRow] });
  const key = parse(fixture).records[0].sourceKey;
  fixture.Sheets["Install Parts"].P2 = { t: "s", v: "2026-02-04 14:05:06" };
  assert.equal(parse(fixture).records[0].sourceKey, key); assert.equal(parse(fixture, 2027).records[0].sourceKey, key);
  const duplicate = [...installRow]; duplicate[15] = "2026-02-04 14:05:06";
  assert.throws(() => parse(book({ "Install Parts": [installHeaders, installRow, duplicate] })), /duplicate install_parts natural key/);
  assert.equal(parse(certifiedBook()).records[0].sourceKey, parse(certifiedBook(), 2027).records[0].sourceKey);
});
test("Summary retains explicit targets beside differing Tracker plans", () => {
  const summary = [[null, "VITROS", "VISION", "LVCC - Electrometer", "LVCC IR Wash"], ...[1, 2, 3, 4].map((q) => [`Q${q}`, 10, 20, 30, 40]), ["Total", 40, 80, 120, 160]];
  const tracker = [[...Array.from({ length: 4 }, () => ["Product", "Quarter", "Week", "Plan"]).flat()], ...[1, 2, 3, 4].map((q) => ["VITROS", `Q${q}`, (q - 1) * 13 + 1, 10, "VISION", `Q${q}`, (q - 1) * 13 + 1, 20, "LVCC Electrometer", `Q${q}`, (q - 1) * 13 + 1, 25, "LVCC IR Wash", `Q${q}`, (q - 1) * 13 + 1, 35])];
  const fixture = book({ "2026 Summary": summary, Tracker: tracker }); const result = parse(fixture);
  assert.equal(result.counts.summary_targets, 16); const data = result.records.find((r) => r.data.product === "LVCC_ELECTROMETER").data;
  assert.equal(data.targetValue, 30); assert.equal(data.annualTargetValue, 120); assert.equal(data.trackerPlanValue, 25); assert.equal(data.planVariance, -5);
  fixture.Sheets["2026 Summary"].D6.v = 121; assert.throws(() => parse(fixture), /quarterly targets do not reconcile/);
});

for (const path of process.argv.slice(2)) {
  test("private real-source acceptance", () => {
    const bytes = fs.readFileSync(path); const sourceHash = crypto.createHash("sha256").update(bytes).digest("hex");
    const workbook = XLSX.read(bytes, { type: "buffer", cellDates: false }); const result = parse(workbook);
    assert.equal(result.importedSheets.length, 6); assert.equal(result.counts.field_status, 80);
    assert.equal(result.counts.lvcc_reviews, 58); assert.equal(result.counts.install_parts, 79);
    assert.equal(result.counts.certified_parts, 25155); assert.equal(result.counts.summary_targets, 16);
    assert.equal(result.records.filter((r) => r.dataset === "certified_parts" && r.data.yearMonth === undefined).length, 84);
    assert.equal(new Set(result.records.map((record) => record.sourceKey)).size, result.records.length);
    const discrepancy = result.records.find((r) => r.dataset === "lvcc_reviews" && r.sourceRow === 53);
    assert.equal(discrepancy?.data.recordedTotal, 9); assert.equal(discrepancy?.data.listedCount, 13);
    assert(result.warnings.some((message) => message.includes("source Total reconciled")));
    const annualTargets = Object.fromEntries(result.records.filter((r) => r.dataset === "summary_targets" && r.data.quarter === "Q1").map((r) => [r.data.product, r.data.annualTargetValue]));
    assert.deepEqual(annualTargets, { VITROS: 190, VISION: 56, LVCC_ELECTROMETER: 473, LVCC_IR_WASH: 473 });
    console.log(JSON.stringify({ sourceHash, counts: result.counts, warnings: result.warnings.length, sourceRowsPreserved: true,
      payloadBytes: Buffer.byteLength(JSON.stringify(result.records)),
      largestRecordBytes: Math.max(...result.records.map((record) => Buffer.byteLength(JSON.stringify(record)))),
    }));
  });
}
console.log(`REM operational parser acceptance: ${passed} passed.`);
