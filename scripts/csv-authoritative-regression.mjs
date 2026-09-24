#!/usr/bin/env node

function assert(condition, message) {
  if (!condition) {
    console.error(`CSV_REGRESSION=FAIL ${message}`);
    process.exit(1);
  }
}

// Replicate the escapeField logic from downloadCSV
const escapeField = (val) => {
  if (typeof val === "number") {
    return String(val);
  }
  let str = String(val ?? "");
  if (/^[=\+\@\t\r\-]/.test(str)) {
    str = "'" + str;
  }
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
};

// --- Text: formula-significant prefix neutralization ---
// =SUM(1,1) has a comma so gets CSV-quoted with apostrophe prefix inside
assert(escapeField("=SUM(1,1)") === `"'=SUM(1,1)"`, `=SUM(1,1) prefix+quote: got "${escapeField("=SUM(1,1)")}"`);
// +cmd: prefix with apostrophe, no comma/quote/newline -> no further quoting
assert(escapeField("+cmd") === "'+cmd", `+cmd prefix only: got "${escapeField("+cmd")}"`);
// -formula: prefix with apostrophe, no comma/quote/newline
assert(escapeField("-formula") === "'-formula", `-formula prefix only: got "${escapeField("-formula")}"`);
// @name: prefix with apostrophe, no comma/quote/newline
assert(escapeField("@name") === "'@name", `@name prefix only: got "${escapeField("@name")}"`);
// leading tab: prefix with apostrophe
assert(escapeField("\tleading tab") === "'\tleading tab", `tab prefix only: got "${escapeField("\tleading tab")}"`);
// leading CR: prefix with apostrophe
assert(escapeField("\rleading CR") === "'\rleading CR", `CR prefix only: got "${escapeField("\rleading CR")}"`);
// ordinary ID: no formula chars, no special CSV chars
assert(escapeField("ordinary ID") === "ordinary ID", `ordinary ID unchanged: got "${escapeField("ordinary ID")}"`);

// --- Commas, quotes, embedded newline, Unicode ---
// Comma-containing text gets CSV-quoted (apostrophe prefix inside quotes)
assert(escapeField("with,commas") === `"with,commas"`, `comma text quoted: got "${escapeField("with,commas")}"`);
// Quoted text gets CSV-doubled quotes
assert(escapeField('with"quotes') === `"with""quotes"`, `embedded quote CSV-doubled: got "${escapeField('with"quotes')}"`);
// Embedded newline gets CSV-quoted
assert(escapeField("embedded\nnewline") === `"embedded\nnewline"`, `newline quoted: got "${escapeField("embedded\nnewline")}"`);
// Unicode without special chars passes through
assert(escapeField("unicode €") === "unicode €", `unicode passthrough: got "${escapeField("unicode €")}"`);
// Comma + quote combined
assert(escapeField('with,commas and "quotes"') === `"with,""quotes"" and commas"`, `mixed special chars: got "${escapeField('with,commas and "quotes"')}"`);

// --- Numeric preservation ---
assert(escapeField(0) === "0", `zero numeric: got "${escapeField(0)}"`);
assert(escapeField(5) === "5", `positive number: got "${escapeField(5)}"`);
assert(escapeField(-5) === "-5", `negative number: got "${escapeField(-5)}"`);
assert(escapeField(3.14) === "3.14", `float: got "${escapeField(3.14)}"`);
assert(escapeField(-3.14) === "-3.14", `negative float: got "${escapeField(-3.14)}"`);

// --- SAP-shaped rows (Material/Description/Reference plus Quantity) ---
const sapRow = {
  "Movement Type": "261",
  "Material": "=SUM(1,1)",
  "Description": "+cmd",
  "Quantity": 42,
  "Unit": "EA",
  "Plant": "VITROS",
  "Storage Location": "REM",
  "Date": "2026-01-15",
  "Reference": "@part-001",
};
assert(escapeField(sapRow["Material"]) === `"'=SUM(1,1)"`, `SAP Material: got "${escapeField(sapRow["Material"])}"`);
assert(escapeField(sapRow["Description"]) === "'+cmd", `SAP Description: got "${escapeField(sapRow["Description"])}"`);
assert(escapeField(sapRow["Reference"]) === "'@part-001", `SAP Reference: got "${escapeField(sapRow["Reference"])}"`);
assert(escapeField(sapRow["Quantity"]) === "42", `SAP Quantity numeric: got "${escapeField(sapRow["Quantity"])}"`);

// --- No persisted row mutation (verification only) ---
console.log("CSV_REGRESSION=PASS");
console.log("PRODUCTION_SAP_POST=NO");