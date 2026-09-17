import type { Cell, ParsedTable } from "./enterpriseFileParser";

export type Field = {
  column: number;
  label: string;
  role: string;
  kind: "text" | "number" | "date";
  visible: boolean;
  metric: boolean;
};
export type Mapping = {
  name: string;
  destination: "inventory" | "production";
  headerRow: number;
  excludedRows: number[];
  fields: Field[];
  dateFormat?: "iso" | "mdy" | "dmy";
  numberFormat?: "plain" | "us" | "eu";
};
export const roles = [
  "extra",
  "identifier",
  "description",
  "quantity",
  "minimum",
  "maximum",
  "category",
  "product",
  "stage",
  "date",
  "plan",
  "actual",
  "unit",
  "cost",
];
export function numeric(
  cell: Cell | undefined,
  format: Mapping["numberFormat"] = "plain",
): number | null {
  if (!cell || cell.issue || cell.value === null || cell.value === "")
    return null;
  if (typeof cell.value === "number")
    return Number.isFinite(cell.value) ? cell.value : null;
  // Ambiguous separators, units and percentages must not become invented numeric quantities.
  if (typeof cell.value !== "string") return null;
  let text = cell.value.trim();
  if (format === "us" && /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text))
    text = text.replace(/,/g, "");
  else if (format === "eu") {
    if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(text)) return null;
    text = text.replace(/\./g, "").replace(",", ".");
  }
  if (!/^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
function inferRole(label: string): string {
  const key = label.trim().toLowerCase().replace(/[_-]+/g, " ");
  const patterns: [string, RegExp][] = [
    [
      "identifier",
      /^(sku|item( code| number| #)?|part( number| no| #)?|material( number)?|job( id| number)?|order( id| number)?|serial( number)?|batch( id)?)$/,
    ],
    ["description", /^(description|item description|part description|name)$/],
    [
      "quantity",
      /^(qty|quantity|qoh|on hand|stock|stock quantity|qty on hand)$/,
    ],
    ["minimum", /^(min|minimum|safety stock|reorder point|rop)$/],
    ["maximum", /^(max|maximum|max stock)$/],
    ["product", /^(product|model|product family|service)$/],
    ["category", /^(category|assembly|department|type|group)$/],
    ["stage", /^(stage|status|current stage|workflow)$/],
    ["date", /^(date|week|week start|month|due date|start date)$/],
    ["plan", /^(plan|planned|target|planned quantity)$/],
    ["actual", /^(actual|actuals|completed|actual quantity)$/],
    ["unit", /^(unit|uom|unit of measure)$/],
    ["cost", /^(cost|unit cost|price)$/],
  ];
  return patterns.find(([, re]) => re.test(key))?.[0] ?? "extra";
}
export function suggestMapping(table: ParsedTable): Mapping {
  const header = table.rows.find(r => r.row === table.headerRow);
  const used = new Set<string>();
  const fields: Field[] = Array.from(
    { length: table.columnCount },
    (_, column) => {
      const label =
        header?.cells[column]?.display.trim() || `Column ${column + 1}`;
      let role = inferRole(label);
      if (role !== "extra" && used.has(role)) role = "extra";
      used.add(role);
      const sample = table.rows
        .filter(r => r.row > table.headerRow)
        .slice(0, 40)
        .map(r => r.cells[column])
        .filter(c => c && c.value !== null && c.value !== "");
      const isNumber =
        sample.length > 0 && sample.every(c => numeric(c) !== null);
      const kind =
        role === "identifier"
          ? "text"
          : role === "date"
            ? "date"
            : isNumber
              ? "number"
              : "text";
      return {
        column,
        label: label.slice(0, 180),
        role,
        kind,
        visible: true,
        metric:
          ["quantity", "plan", "actual"].includes(role) && kind === "number",
      };
    },
  );
  return {
    name: table.name.slice(0, 180),
    destination: fields.some(f => ["stage", "plan", "actual"].includes(f.role))
      ? "production"
      : "inventory",
    headerRow: table.headerRow,
    excludedRows: [],
    fields,
  };
}
export function validateMapping(table: ParsedTable, mapping: Mapping) {
  if (!mapping.name.trim() || mapping.name.length > 180)
    throw Error("Give this dataset a name of 1–180 characters.");
  if (
    !Number.isSafeInteger(mapping.headerRow) ||
    mapping.headerRow < 0 ||
    mapping.headerRow > table.rows.reduce((max, r) => Math.max(max, r.row), 0)
  )
    throw Error("Choose a source header row, or zero for no header.");
  if (mapping.fields.length !== table.columnCount)
    throw Error(
      "Keep every source column in the mapping. Hide columns instead of dropping their data.",
    );
  const columns = new Set<number>(),
    assigned = new Set<string>();
  for (const f of mapping.fields) {
    if (
      !Number.isSafeInteger(f.column) ||
      f.column < 0 ||
      f.column >= table.columnCount ||
      columns.has(f.column) ||
      !f.label.trim() ||
      f.label.length > 180 ||
      !roles.includes(f.role)
    )
      throw Error("Check the column names and mappings.");
    columns.add(f.column);
    if (f.role !== "extra" && assigned.has(f.role))
      throw Error(
        "Map each dashboard role once; retain other columns as additional fields.",
      );
    assigned.add(f.role);
    if (f.metric && f.kind !== "number")
      throw Error("Only numeric fields can be summarized.");
  }
  const rows = new Set(table.rows.map(r => r.row));
  if (mapping.excludedRows.some(r => !Number.isSafeInteger(r) || !rows.has(r)))
    throw Error("Excluded rows must exist in the source table.");
}
export function selectedRows(table: ParsedTable, mapping: Mapping) {
  const excluded = new Set(mapping.excludedRows);
  return table.rows.filter(
    r => r.row > mapping.headerRow && !excluded.has(r.row),
  );
}
export function metrics(
  table: ParsedTable,
  mapping: Mapping,
  rows = selectedRows(table, mapping),
) {
  const unit = mapping.fields.find(f => f.role === "unit");
  return mapping.fields
    .filter(f => f.metric)
    .flatMap(f => {
      const groups = new Map<string, typeof rows>();
      for (const row of rows) {
        const key = unit
          ? row.cells[unit.column]?.display || "Unit unspecified"
          : "";
        const list = groups.get(key) ?? [];
        list.push(row);
        groups.set(key, list);
      }
      if (!groups.size) groups.set("", []);
      return [...groups].map(([label, group]) => {
        const numbers = group
          .map(r => numeric(r.cells[f.column], mapping.numberFormat))
          .filter((n): n is number => n !== null);
        const sum = numbers.reduce((a, b) => a + b, 0);
        return {
          column: f.column,
          label: f.label + (label ? ` • ${label}` : ""),
          sum: Number.isFinite(sum) ? sum : null,
          reported: numbers.length,
          unreported: group.length - numbers.length,
        };
      });
    });
}
export function dateValue(
  cell: Cell | undefined,
  format: Mapping["dateFormat"],
): number | null {
  if (!cell || cell.issue || typeof cell.value !== "string") return null;
  const text = cell.value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (iso) {
    const calendar = new Date(
      Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])),
    );
    if (
      calendar.getUTCFullYear() !== Number(iso[1]) ||
      calendar.getUTCMonth() !== Number(iso[2]) - 1 ||
      calendar.getUTCDate() !== Number(iso[3])
    )
      return null;
    const n = Date.parse(text);
    return Number.isFinite(n) ? n : null;
  }
  if (format !== "mdy" && format !== "dmy") return null;
  const m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const month = Number(m[format === "mdy" ? 1 : 2]),
    day = Number(m[format === "mdy" ? 2 : 1]),
    year = Number(m[3]),
    date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.getTime()
    : null;
}
export function acceptAISuggestions(
  table: ParsedTable,
  proposal: any,
): Mapping {
  const base = suggestMapping(table);
  if (!proposal || !Array.isArray(proposal.fields)) return base;
  const used = new Set<string>();
  base.fields = base.fields.map(f => {
    const p = proposal.fields.find((x: any) => x.column === f.column);
    const role = p && roles.includes(p.role) ? p.role : f.role;
    const safeRole = role !== "extra" && used.has(role) ? "extra" : role;
    used.add(safeRole);
    // AI maps existing columns; it may not alter values, discard columns or invent labels/data.
    const kind =
      safeRole === "identifier"
        ? "text"
        : safeRole === "date"
          ? "date"
          : f.kind;
    return {
      ...f,
      role: safeRole,
      kind,
      metric:
        kind === "number" && ["quantity", "plan", "actual"].includes(safeRole),
    };
  });
  if (
    proposal.destination === "inventory" ||
    proposal.destination === "production"
  )
    base.destination = proposal.destination;
  return base;
}
