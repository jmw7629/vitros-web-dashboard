import * as XLSX from "xlsx";
export type Cell = {
  value: string | number | boolean | null;
  display: string;
  formula?: string;
  issue?: string;
};
export type ParsedRow = { row: number; cells: Cell[]; hidden?: boolean };
export type ParsedTable = {
  key: string;
  name: string;
  hidden: boolean;
  rows: ParsedRow[];
  columnCount: number;
  headerRow: number;
  warnings: string[];
};
export type ParsedUpload = {
  tables: ParsedTable[];
  warnings: string[];
  status: "review" | "needs_attention";
  parser: string;
};
const MAX_BYTES = 32 * 1024 * 1024,
  MAX_CELLS = 500_000,
  MAX_ROWS = 50_000,
  MAX_SHEETS = 256,
  MAX_TEXT = 32_768;
function attention(message: string): ParsedUpload {
  return {
    tables: [],
    warnings: [message + " The original file is retained for recovery."],
    status: "needs_attention",
    parser: "retained",
  };
}
function boundedText(text: string) {
  if (text.length > MAX_TEXT)
    throw Error("A source cell exceeds the automatic cell-size limit");
  return text;
}
function plain(value: unknown): Cell {
  if (value === null || value === undefined)
    return { value: null, display: "" };
  if (typeof value === "string")
    return { value: boundedText(value), display: value };
  if (typeof value === "boolean" || typeof value === "number")
    return { value, display: String(value) };
  const text = boundedText(JSON.stringify(value));
  return { value: text, display: text };
}
function convert(raw: XLSX.CellObject | undefined): Cell {
  if (!raw) return plain(null);
  const cell = plain(raw.v instanceof Date ? raw.v.toISOString() : raw.v);
  if (raw.w !== undefined) cell.display = boundedText(String(raw.w));
  if (raw.f) {
    cell.formula = boundedText(raw.f);
    // SheetJS can synthesize v=0 for uncached z-typed formulas. Such cells are
    // not real zeros and must stay flagged for review, never counted in totals.
    if (raw.t === "z" || raw.v === undefined || raw.v === null) {
      cell.issue = "Formula has no cached result";
      cell.value = null;
    }
  }
  if (raw.t === "e") {
    cell.issue = "Source formula/error value: " + cell.display;
    cell.value = null;
  }
  return cell;
}
function checkSize(rows: number, columns: number) {
  if (rows > MAX_ROWS || rows * columns > MAX_CELLS || columns > 2048)
    throw Error(
      "Table exceeds automatic analysis capacity (50,000 populated rows, 500,000 cells, or 2,048 columns). Split a converted copy into sections",
    );
}
function headerSuggestion(rows: ParsedRow[]): number {
  const candidates = rows
    .slice(0, 20)
    .map(r => ({
      row: r.row,
      score:
        r.cells.filter(c => typeof c.value === "string" && c.display.trim())
          .length *
          2 +
        r.cells.filter(c => c.display.trim()).length,
    }));
  return (
    candidates.sort((a, b) => b.score - a.score || a.row - b.row)[0]?.row ?? 0
  );
}
function fromSheet(
  name: string,
  ws: XLSX.WorkSheet,
  hidden: number,
  index: number,
): ParsedTable {
  const source = new Map<number, Map<number, Cell>>();
  let maxColumn = -1,
    actualCells = 0,
    formulas = 0,
    issues = 0;
  for (const address of Object.keys(ws)) {
    if (!/^[A-Z]+[1-9]\d*$/.test(address)) continue;
    const pos = XLSX.utils.decode_cell(address),
      cell = convert(ws[address]);
    if (cell.value === null && !cell.formula && !cell.issue) continue;
    actualCells++;
    if (actualCells > MAX_CELLS)
      throw Error(`Sheet ${name} exceeds the populated-cell capacity`);
    const row = source.get(pos.r + 1) ?? new Map<number, Cell>();
    row.set(pos.c, cell);
    source.set(pos.r + 1, row);
    maxColumn = Math.max(maxColumn, pos.c);
    if (cell.formula) formulas++;
    if (cell.issue) issues++;
  }
  checkSize(source.size, maxColumn + 1);
  const warnings: string[] = [];
  if (hidden)
    warnings.push(
      hidden === 2
        ? "Very-hidden worksheet included"
        : "Hidden worksheet included",
    );
  const hiddenColumns = (ws["!cols"] ?? []).flatMap((c, i) =>
    c?.hidden ? [XLSX.utils.encode_col(i)] : [],
  );
  if (hiddenColumns.length)
    warnings.push("Hidden columns included: " + hiddenColumns.join(", "));
  if (ws["!merges"]?.length)
    warnings.push(
      `${ws["!merges"].length} merged regions retained without inventing repeated cell values.`,
    );
  if (formulas)
    warnings.push(
      `${formulas} formulas retained with their source cached values. Formulas, external links and macros are not executed or recalculated.`,
    );
  if (issues)
    warnings.push(
      `${issues} error or uncached-formula cells require review. They are not treated as zero.`,
    );
  const rows = [...source.keys()]
    .sort((a, b) => a - b)
    .map(row => ({
      row,
      cells: Array.from(
        { length: maxColumn + 1 },
        (_, column) => source.get(row)!.get(column) ?? plain(null),
      ),
      hidden: Boolean(ws["!rows"]?.[row - 1]?.hidden),
    }));
  const headerRow = headerSuggestion(rows),
    headers =
      rows.find(r => r.row === headerRow)?.cells.map(c => c.display.trim()) ??
      [];
  if (headers.some(x => !x))
    warnings.push("Blank headers retained as separate columns.");
  if (new Set(headers.filter(Boolean)).size < headers.filter(Boolean).length)
    warnings.push("Duplicate headers retained as separate columns.");
  return {
    key: `sheet_${index}`,
    name,
    hidden: hidden !== 0,
    rows,
    columnCount: maxColumn + 1,
    headerRow,
    warnings,
  };
}
function fromWorkbook(wb: XLSX.WorkBook, parser: string): ParsedUpload {
  if (wb.SheetNames.length > MAX_SHEETS)
    throw Error(
      "Workbook exceeds 256 worksheets; split a converted copy into sections",
    );
  const tables = wb.SheetNames.map((name, index) => {
    if (!wb.Sheets[name])
      throw Error(`Worksheet ${name} could not be read completely`);
    return fromSheet(
      name,
      wb.Sheets[name],
      wb.Workbook?.Sheets?.[index]?.Hidden ?? 0,
      index,
    );
  });
  const cells = tables.reduce((n, t) => n + t.rows.length * t.columnCount, 0);
  if (cells > MAX_CELLS * 2)
    throw Error(
      "Workbook exceeds the complete-analysis cell capacity; split a converted copy into sections",
    );
  return {
    tables,
    warnings: [],
    status: tables.some(t => t.rows.length) ? "review" : "needs_attention",
    parser,
  };
}
function readWorkbook(bytes: Uint8Array): ParsedUpload {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) checkArchive(bytes);
  return fromWorkbook(
    XLSX.read(bytes, {
      type: "array",
      raw: true,
      cellFormula: true,
      cellText: true,
      cellDates: true,
      cellStyles: true,
      cellNF: true,
      sheetStubs: true,
      dense: false,
      nodim: true,
    }),
    "sheetjs",
  );
}
// Inspect archive metadata before SheetJS inflates workbook XML. The original is always retained.
function checkArchive(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw Error("Archive directory is incomplete");
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true),
    start = view.getUint32(end + 16, true);
  if (
    count === 65535 ||
    size === 0xffffffff ||
    start === 0xffffffff ||
    count > 10000 ||
    start + size > end
  )
    throw Error("Archive needs a smaller converted copy");
  let p = start,
    total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > end || view.getUint32(p, true) !== 0x02014b50)
      throw Error("Archive directory is damaged");
    if (view.getUint16(p + 8, true) & 1)
      throw Error("Unlock this archive and upload a converted copy");
    const expanded = view.getUint32(p + 24, true);
    total += expanded;
    if (expanded > 64 * 1024 * 1024 || total > 128 * 1024 * 1024)
      throw Error("Expanded workbook exceeds automatic analysis capacity");
    p +=
      46 +
      view.getUint16(p + 28, true) +
      view.getUint16(p + 30, true) +
      view.getUint16(p + 32, true);
  }
  if (p > start + size) throw Error("Archive directory is damaged");
}
function matrix(
  values: unknown[][],
  headers: string[],
  name: string,
  index: number,
): ParsedTable {
  checkSize(values.length + 1, headers.length);
  return {
    key: `json_${index}`,
    name,
    hidden: false,
    columnCount: headers.length,
    headerRow: 0,
    rows: [
      { row: 0, cells: headers.map(plain) },
      ...values.map((r, i) => ({
        row: i + 1,
        cells: headers.map((_, c) => plain(r[c])),
      })),
    ],
    warnings: [
      "Row 0 contains generated field names. Data row numbers refer to source array positions; every record is retained.",
    ],
  };
}
function jsonTable(data: unknown, name: string, index: number): ParsedTable {
  const records = Array.isArray(data) ? data : [data];
  if (records.every(r => Array.isArray(r))) {
    const width = records.reduce(
      (n, r) => Math.max(n, (r as unknown[]).length),
      0,
    );
    return matrix(
      records as unknown[][],
      Array.from({ length: width }, (_, i) => `Column ${i + 1}`),
      name,
      index,
    );
  }
  if (
    records.every(r => r !== null && typeof r === "object" && !Array.isArray(r))
  ) {
    const headers = [
      ...new Set(records.flatMap(r => Object.keys(r as object))),
    ];
    return matrix(
      records.map(r => headers.map(h => (r as Record<string, unknown>)[h])),
      headers,
      name,
      index,
    );
  }
  return matrix(
    records.map(r => [r]),
    ["Content"],
    name,
    index,
  );
}
function parseJSON(data: unknown, name: string): ParsedUpload {
  const tables: ParsedTable[] = [];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const other: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value))
        tables.push(jsonTable(value, key, tables.length));
      else other[key] = value;
    }
    if (Object.keys(other).length)
      tables.push(jsonTable(other, name + " — metadata", tables.length));
    if (!tables.length) tables.push(jsonTable(data, name, 0));
  } else tables.push(jsonTable(data, name, 0));
  if (
    tables.length > MAX_SHEETS ||
    tables.reduce((n, t) => n + t.rows.length * t.columnCount, 0) >
      MAX_CELLS * 2
  )
    throw Error("JSON exceeds the automatic table/cell capacity");
  const dataRows = tables.reduce(
    (n, t) => n + Math.max(0, t.rows.length - 1),
    0,
  );
  const warnings = [
    "Nested objects and arrays inside records are preserved as JSON text; unknown fields are retained.",
  ];
  if (!dataRows)
    warnings.push(
      "JSON dataset contains no data records. Review the source before publishing.",
    );
  return {
    tables,
    warnings,
    status: dataRows ? "review" : "needs_attention",
    parser: "json",
  };
}
function delimiterFor(text: string): string | undefined {
  const candidates = ["\t", ",", ";", "|"],
    scores = new Map<string, number>();
  for (const delimiter of candidates) {
    let quote = false,
      n = 0;
    const lines: number[] = [];
    for (let i = 0; i < text.length && lines.length < 20; i++) {
      const c = text[i];
      if (c === '"') {
        if (quote && text[i + 1] === '"') {
          i++;
          continue;
        }
        quote = !quote;
      } else if (!quote && c === delimiter) n++;
      else if (!quote && c === "\n") {
        lines.push(n);
        n = 0;
      }
    }
    lines.push(n);
    const positive = lines.filter(x => x > 0);
    scores.set(
      delimiter,
      positive.length ? positive.length * 100 + Math.min(...positive) : 0,
    );
  }
  const winner = candidates.sort(
    (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0),
  )[0];
  return scores.get(winner) ? winner : undefined;
}
export function parseExtractedText(text: string, name: string): ParsedUpload {
  try {
    if (!text.trim()) return attention("No readable text was found.");
    const delimiter = delimiterFor(text);
    if (!delimiter) {
      const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
      const table = matrix(
        lines.map(line => [line]),
        ["Content"],
        name,
        0,
      );
      table.warnings = [
        "Unstructured text retained line by line. Review it before assigning numeric dashboard roles.",
      ];
      return {
        tables: [table],
        warnings: [],
        status: "review",
        parser: "text",
      };
    }
    const wb = XLSX.read(text, {
      type: "string",
      raw: true,
      FS: delimiter,
      cellText: true,
      dense: false,
    });
    const result = fromWorkbook(wb, "delimited-text");
    result.tables.forEach(t => (t.name = name));
    return result;
  } catch (error) {
    return attention(
      error instanceof Error
        ? error.message
        : "Text needs another recovery method.",
    );
  }
}
export function parseEnterpriseFile(
  bytes: Uint8Array,
  name: string,
  mime: string,
): ParsedUpload {
  try {
    if (!bytes.length) return attention("This file is empty.");
    if (bytes.length > MAX_BYTES)
      return attention(
        "Original exceeds the 32 MB automatic-analysis capacity.",
      );
    const ascii = new TextDecoder().decode(bytes.subarray(0, 12));
    if (
      ascii.startsWith("%PDF-") ||
      mime.startsWith("image/") ||
      (bytes[0] === 0x89 && bytes[1] === 0x50) ||
      (bytes[0] === 0xff && bytes[1] === 0xd8) ||
      ascii.startsWith("GIF8")
    )
      return attention(
        "Use PDF/image text recovery, or upload a converted spreadsheet/text copy.",
      );
    if (
      (bytes[0] === 0x50 && bytes[1] === 0x4b) ||
      (bytes[0] === 0xd0 && bytes[1] === 0xcf)
    )
      return readWorkbook(bytes);
    let text: string;
    if (bytes[0] === 0xff && bytes[1] === 0xfe)
      text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff)
      text = new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
    else text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    text = text.replace(/^\uFEFF/, "");
    if (/[\x00-\x08\x0b\x0e-\x1f]/.test(text))
      return attention(
        "This binary format requires a converted copy or text recovery.",
      );
    if (
      /^[\s]*[[{]/.test(text) ||
      /\.json$/i.test(name) ||
      mime.includes("json")
    )
      return parseJSON(JSON.parse(text), name);
    if (/^\s*</.test(text)) {
      const htmlTables = text.match(/<table\b[\s\S]*?<\/table\s*>/gi);
      if (htmlTables?.length) {
        if (htmlTables.length > MAX_SHEETS)
          throw Error("HTML exceeds automatic table capacity");
        const tables = htmlTables.flatMap((html, i) =>
          fromWorkbook(
            XLSX.read(html, { type: "string", raw: true, cellDates: true }),
            "html",
          ).tables.map(t => ({
            ...t,
            key: `html_${i}_${t.key}`,
            name: `${name} — table ${i + 1}`,
          })),
        );
        return {
          tables,
          warnings: [
            "HTML tables extracted. Non-table markup remains in the retained original.",
          ],
          status: "review",
          parser: "html",
        };
      }
      try {
        return fromWorkbook(
          XLSX.read(text, {
            type: "string",
            raw: true,
            cellDates: true,
            cellStyles: true,
          }),
          "xml",
        );
      } catch {
        return parseExtractedText(text, name);
      }
    }
    return parseExtractedText(text, name);
  } catch (error) {
    return attention(
      error instanceof Error
        ? error.message
        : "This format needs another recovery method.",
    );
  }
}
