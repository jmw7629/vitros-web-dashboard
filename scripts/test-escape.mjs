const escapeField = (val) => {
  if (typeof val === "number") return String(val);
  let str = String(val ?? "");
  if (/^[=\+\@\t\r\-]/.test(str)) str = "'" + str;
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
};

const tests = [
  ["=SUM(1,1)", "formula with comma"],
  ["+cmd", "plus cmd"],
  ["-formula", "minus formula"],
  ["@name", "at name"],
  ["ordinary ID", "ordinary ID"],
  ["with,commas", "comma text"],
  ['with"quotes', "embedded quote"],
  ["embedded\nnewline", "embedded newline"],
  ["unicode €", "unicode"],
  [0, "zero"],
  [5, "positive"],
  [-5, "negative"],
];

for (const [input, desc] of tests) {
  const result = escapeField(input);
  process.stdout.write(
    "escapeField(" +
      String(input).padEnd(30) +
      ") => " +
      JSON.stringify(result) +
      "  // " +
      desc +
      "\n"
  );
}