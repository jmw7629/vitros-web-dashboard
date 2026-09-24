export function serializeField(val) {
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

export function serializeCsv(rows) {
  if (rows.length === 0) {
    return "";
  }
  const headers = Object.keys(rows[0]);
  const headerRow = headers.map(serializeField).join(",");
  const dataRows = rows.map((row) => headers.map((h) => serializeField(row[h])).join(","));
  return [headerRow, ...dataRows].join("\n");
}