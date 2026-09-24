function serializeField(value) {
  if (typeof value === "number") return String(value);

  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  if (/[\",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function serializeCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map((header) => serializeField(header)).join(","),
    ...rows.map((row) => headers.map((header) => serializeField(row[header])).join(",")),
  ];
  return lines.join("\n");
}