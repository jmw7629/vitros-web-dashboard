import * as XLSX from "xlsx";

export type RemOperationalDataset = "field_status" | "lvcc_reviews" | "install_parts" | "certified_parts" | "summary_targets";
export type RemProduct = "VITROS" | "VISION" | "LVCC_ELECTROMETER" | "LVCC_IR_WASH";
type NumericProvenance = { sourceNumericText?: Record<string, string> };
export type FieldStatusData = NumericProvenance & {
  product: "VITROS" | "VISION"; batch: string; orderReference?: string; duplicateCount?: number;
  postingDate?: string; sourcePostingDate?: string; yearMonth?: string;
  cleanliness?: string; cabinetry?: string; buildQuality?: string; finalLine?: number; release?: number;
  releaseFpyPct?: number; sourceReleaseFpy?: string | number; partsAtInstallUsd?: number; first90?: string;
  status?: string; installDate?: string; sourceInstallDate?: string; country?: string;
  partsNotCertified?: string; partsAlsoCertified?: string; comment?: string; fpyGoalPct?: number; sourceFpyGoal?: string | number;
};
export type LvccReviewData = NumericProvenance & {
  partNumber: string; weekNumber: number; weekStart: string; sourceWeekStart: string;
  recordedTotal?: number; sourceColumnD?: number; sourceColumnDLabel?: string;
  sourceColumnE?: number; sourceColumnELabel?: string;
  reviewIds: { slot: number; value: string; sourceCell: string }[];
  listedCount: number; totalDifference?: number;
};
export type InstallPartData = NumericProvenance & {
  serviceOrder: string; equipmentNumber: string; partNumber: string; completedAt: string;
  equipmentPartKey: string; yearMonth: string; quantity: number; costUsd: number; partCostUsd: number;
  sourceCompletedAt?: string; sourceYearMonth?: string; replacedInServiceKey?: string;
  region?: string; country?: string; productFamily?: string; problemCode?: string; feedbackCode?: string;
  description?: string; technicianCode?: string; technicianName?: string; serviceMemo?: string;
  resolutionMemo?: string; serviceOrderFeedback?: string; installFeedbackNotes?: string; internalComments?: string;
};
export type CertifiedPartData = NumericProvenance & {
  serviceOrder: string; partLineNumber: string; laborLineNumber: string; partNumber: string; lineType: string;
  equipmentNumber: string; equipmentPartKey: string; yearMonth?: string;
  quantity: number; partCostUsd: number; allCostUsd: number;
  sourceYearMonth?: string; feedbackCode?: string; description?: string;
};
export type SummaryTargetData = NumericProvenance & {
  product: RemProduct; quarter: "Q1" | "Q2" | "Q3" | "Q4";
  targetValue: number; annualTargetValue: number; trackerPlanValue?: number; planVariance?: number;
};
export type RemOperationalData = FieldStatusData | LvccReviewData | InstallPartData | CertifiedPartData | SummaryTargetData;
export type RemOperationalRecord = {
  dataset: RemOperationalDataset; sourceKey: string; sourceSheet: string; sourceRow: number; data: RemOperationalData;
};
export type RemOperationalWorkbookPreview = {
  records: RemOperationalRecord[]; importedSheets: string[]; warnings: string[];
  counts: Record<RemOperationalDataset, number>;
};

const norm = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const blank = (value: unknown) => value === null || value === undefined || String(value).trim() === "";
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const PRODUCTS: RemProduct[] = ["VITROS", "VISION", "LVCC_ELECTROMETER", "LVCC_IR_WASH"];
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;
type LocatedSheet = { name: string; sheet: XLSX.WorkSheet; header: number; columns: Map<string, number>; rows: unknown[][] };

function absoluteRows(sheet: XLSX.WorkSheet): unknown[][] {
  const end = XLSX.utils.decode_range(sheet["!ref"] ?? "A1").e;
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1, raw: true, defval: null, range: { s: { r: 0, c: 0 }, e: end },
  });
}

function sourceValue(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function cellValue(sheet: XLSX.WorkSheet, name: string, row: number, col: number): unknown {
  const address = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = sheet[address] as XLSX.CellObject | undefined;
  if (!cell) return undefined;
  if (cell.t === "e") throw new Error(`${name}!${address}: cached Excel error; recalculate and save the workbook`);
  if (cell.f != null && (cell.v == null || cell.t === "z")) {
    throw new Error(`${name}!${address}: formula has no cached value; recalculate and save the workbook`);
  }
  return cell.v;
}

function validateSheetCaches(sheet: XLSX.WorkSheet, name: string): void {
  for (const address of Object.keys(sheet)) {
    if (!/^[A-Z]+[1-9]\d*$/.test(address)) continue;
    const cell = sheet[address] as XLSX.CellObject;
    if (cell.t === "e" || (cell.f != null && (cell.v == null || cell.t === "z"))) {
      const { r, c } = XLSX.utils.decode_cell(address);
      cellValue(sheet, name, r, c);
    }
  }
}

function headerAt(sheet: XLSX.WorkSheet, row: number): Map<string, number> {
  const end = XLSX.utils.decode_range(sheet["!ref"] ?? "A1").e.c;
  const columns = new Map<string, number>();
  for (let col = 0; col <= end; col++) {
    const value = norm((sheet[XLSX.utils.encode_cell({ r: row, c: col })] as XLSX.CellObject | undefined)?.v);
    if (value && !columns.has(value)) columns.set(value, col);
  }
  return columns;
}

function locate(workbook: XLSX.WorkBook, expected: string, signature: string[], warnings: string[], excludedSheets: ReadonlySet<string> = new Set()): LocatedSheet | undefined {
  const named = workbook.SheetNames.filter((name) => norm(name) === norm(expected));
  if (named.length > 1) throw new Error(`Ambiguous operational sheet: ${expected}`);
  const candidates: { name: string; header: number; columns: Map<string, number> }[] = [];
  for (const name of named.length ? named : workbook.SheetNames.filter((candidate) => !excludedSheets.has(candidate))) {
    if (excludedSheets.has(name)) throw new Error(`${expected}: worksheet already assigned to another operational role`);
    const sheet = workbook.Sheets[name];
    for (let row = 0; row < Math.min(6, XLSX.utils.decode_range(sheet["!ref"] ?? "A1").e.r + 1); row++) {
      const columns = headerAt(sheet, row);
      if (signature.every((label) => columns.has(norm(label)))) candidates.push({ name, header: row, columns });
    }
  }
  if (!candidates.length) {
    if (named.length) throw new Error(`${expected}: required operational headers are missing`);
    warnings.push(`${expected}: sheet absent; this operational dataset was not imported.`);
    return undefined;
  }
  if (candidates.length !== 1) throw new Error(`Ambiguous header signature for ${expected}`);
  const found = candidates[0];
  const sheet = workbook.Sheets[found.name];
  validateSheetCaches(sheet, found.name);
  // Duplicate required labels must not silently select a first matching column.
  for (const label of signature) {
    const end = XLSX.utils.decode_range(sheet["!ref"] ?? "A1").e.c;
    let matches = 0;
    for (let col = 0; col <= end; col++) if (norm(cellValue(sheet, found.name, found.header, col)) === norm(label)) matches++;
    if (matches !== 1) throw new Error(`${found.name}: ambiguous ${label} header`);
  }
  return { ...found, sheet, rows: absoluteRows(sheet) };
}

function reader(found: LocatedSheet, row: number, numericText: Record<string, string>) {
  const value = (label: string) => {
    const col = found.columns.get(norm(label));
    return col === undefined ? undefined : cellValue(found.sheet, found.name, row, col);
  };
  const context = (label: string) => `${found.name}!${XLSX.utils.encode_cell({ r: row, c: found.columns.get(norm(label)) ?? 0 })} (${label})`;
  const text = (label: string, required = false) => {
    const raw = value(label);
    if (blank(raw)) {
      if (required) throw new Error(`${context(label)}: required value missing`);
      return undefined;
    }
    return String(raw).trim();
  };
  const identifier = (label: string) => {
    const raw = value(label);
    if (typeof raw === "number" && !Number.isSafeInteger(raw)) throw new Error(`${context(label)}: unsafe numeric identifier`);
    return text(label, true)!.toUpperCase();
  };
  const number = (label: string, field: string, required = false, nonnegative = false) => {
    const raw = value(label);
    if (blank(raw)) {
      if (required) throw new Error(`${context(label)}: required number missing`);
      return undefined;
    }
    if ((typeof raw !== "number" && typeof raw !== "string") || (typeof raw === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(raw.trim()))) {
      throw new Error(`${context(label)}: malformed numeric value`);
    }
    const result = Number(raw);
    if (!Number.isFinite(result) || (nonnegative && result < 0)) throw new Error(`${context(label)}: invalid numeric value`);
    if (typeof raw === "string") numericText[field] = raw;
    return result;
  };
  return { value, text, identifier, number, context };
}

function dateParts(value: unknown, context: string): { day: string; timestamp: string } {
  let parts: number[];
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error(`${context}: invalid date`);
    parts = [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate(), value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds()];
  } else if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed || value < 1) throw new Error(`${context}: invalid Excel date`);
    parts = [parsed.y, parsed.m, parsed.d, parsed.H, parsed.M, parsed.S];
  } else {
    const text = String(value ?? "").trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?)?$/);
    const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (iso) parts = [Number(iso[1]), Number(iso[2]), Number(iso[3]), Number(iso[4] ?? 0), Number(iso[5] ?? 0), Number(iso[6] ?? 0)];
    else if (us) parts = [Number(us[3]), Number(us[1]), Number(us[2]), Number(us[4] ?? 0), Number(us[5] ?? 0), Number(us[6] ?? 0)];
    else throw new Error(`${context}: expected an Excel date, ISO date, or MM/DD/YYYY date`);
  }
  const [year, month, day, hour, minute, second] = parts;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (year < 1900 || year > 2200 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) throw new Error(`${context}: invalid calendar date`);
  return { day: isoDay(date), timestamp: date.toISOString().slice(0, 19) };
}

function monthValue(value: unknown, context: string): string {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})-?(\d{2})$/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error(`${context}: invalid year month`);
  return `${match[1]}-${match[2]}`;
}

function product(value: unknown): RemProduct | undefined {
  const name = norm(value).replace(/[-–—]/g, " ").replace(/\s+/g, " ");
  if (name === "vitros") return "VITROS";
  if (name === "vision") return "VISION";
  if (name === "lvcc electrometer") return "LVCC_ELECTROMETER";
  if (name === "lvcc ir wash" || name === "lvcc ir") return "LVCC_IR_WASH";
  return undefined;
}

function isoWeekStart(year: number, week: number): string {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7);
  const thursday = new Date(jan4);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  if (!Number.isInteger(week) || week < 1 || week > 53 || thursday.getUTCFullYear() !== year) throw new Error(`Invalid ISO week ${year}/${week}`);
  return isoDay(jan4);
}

function provenance<T extends NumericProvenance>(data: T, values: Record<string, string>): T {
  if (Object.keys(values).length) data.sourceNumericText = values;
  // Undefined values must not enter JSON storage or Convex action arguments.
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as T;
}

export function parseRemOperationalWorkbook(workbook: XLSX.WorkBook, planYear: number): RemOperationalWorkbookPreview {
  if (!Number.isInteger(planYear) || planYear < 2020 || planYear > 2100) throw new Error("Invalid operational plan year");
  const result: RemOperationalWorkbookPreview = {
    records: [], importedSheets: [], warnings: [],
    counts: { field_status: 0, lvcc_reviews: 0, install_parts: 0, certified_parts: 0, summary_targets: 0 },
  };
  const keys = new Set<string>();
  const add = (dataset: RemOperationalDataset, components: (string | number)[], sourceSheet: string, sourceRow: number, data: RemOperationalData) => {
    const keyScope = dataset === "install_parts" || dataset === "certified_parts" ? "history" : planYear;
    const sourceKey = `${keyScope}:${dataset}:${components.map((value) => encodeURIComponent(String(value))).join(":")}`;
    if (keys.has(sourceKey)) throw new Error(`${sourceSheet}!${sourceRow}: duplicate ${dataset} natural key`);
    keys.add(sourceKey);
    result.records.push({ dataset, sourceKey, sourceSheet, sourceRow, data });
    result.counts[dataset]++;
  };
  const imported = (name: string) => { if (!result.importedSheets.includes(name)) result.importedSheets.push(name); };

  const fieldSheets = new Set<string>();
  for (const family of ["VITROS", "VISION"] as const) {
    const shared = ["Posting Date", "Batch", "YYYY-MM", "Release", "$ parts at Install", "1st 90", "Status", "Install Date", "Country"];
    const signature = family === "VITROS" ? [...shared, "Duplicate", "Final Line", "Release FPY", "FPY Goal"] : [...shared, "Comment"];
    const oppositeName = `field status ${family === "VITROS" ? "vision" : "vitros"}`;
    const excludedSheets = new Set([...fieldSheets, ...workbook.SheetNames.filter((name) => norm(name) === oppositeName)]);
    const found = locate(workbook, `Field Status ${family}`, signature, result.warnings, excludedSheets);
    if (!found) continue;
    fieldSheets.add(found.name);
    for (let row = found.header + 1; row < found.rows.length; row++) {
      const numbers: Record<string, string> = {};
      const read = reader(found, row, numbers);
      if (blank(read.value("Batch"))) {
        if (found.rows[row].some((value) => !blank(value))) throw new Error(`${found.name}!${row + 1}: field record has no batch`);
        continue;
      }
      const batch = read.identifier("Batch");
      const data: FieldStatusData = { product: family, batch };
      data.orderReference = read.text(`${planYear} order`);
      for (const [field, label] of [["cleanliness", "Cleanliness"], ["cabinetry", "Cabinetry"], ["buildQuality", "Build Quality"], ["first90", "1st 90"], ["status", "Status"], ["country", "Country"], ["partsNotCertified", "Parts replaced during install, not part of Certified"], ["partsAlsoCertified", "Parts also replaced in Certified"], ["comment", "Comment"]] as const) data[field] = read.text(label);
      for (const [field, label] of [["duplicateCount", "Duplicate"], ["finalLine", "Final Line"], ["release", "Release"], ["partsAtInstallUsd", "$ parts at Install"]] as const) data[field] = read.number(label, field, false, field !== "partsAtInstallUsd");
      for (const [field, rawField, label] of [["postingDate", "sourcePostingDate", "Posting Date"], ["installDate", "sourceInstallDate", "Install Date"]] as const) {
        const raw = read.value(label);
        if (!blank(raw)) {
          data[rawField] = sourceValue(raw);
          if (norm(raw) === "tbd") result.warnings.push(`${read.context(label)}: source date is TBD; normalized date remains unavailable.`);
          else data[field] = dateParts(raw, read.context(label)).day;
        }
      }
      if (!blank(read.value("YYYY-MM"))) data.yearMonth = monthValue(read.value("YYYY-MM"), read.context("YYYY-MM"));
      for (const [field, rawField, label] of [["releaseFpyPct", "sourceReleaseFpy", "Release FPY"], ["fpyGoalPct", "sourceFpyGoal", "FPY Goal"]] as const) {
        const value = read.number(label, field, false, true);
        if (value !== undefined) {
          data[field] = value <= 1 ? value * 100 : value;
          if (data[field]! > 100) throw new Error(`${read.context(label)}: percentage exceeds 100%`);
          data[rawField] = read.value(label) as number | string;
          if (value > 1) result.warnings.push(`${read.context(label)}: interpreted source ${value} as percentage points; original value retained.`);
        }
      }
      add("field_status", [family, batch], found.name, row + 1, provenance(data, numbers));
    }
    imported(found.name);
  }

  // LVCC contains two repeated header blocks; identify the sheet and each block
  // explicitly so a summary/footer week-like number cannot become a record.
  const lvccNames = workbook.SheetNames.filter((name) => norm(name) === "lvcc dhr reviews");
  if (lvccNames.length > 1) throw new Error("Ambiguous LVCC DHR Reviews sheet");
  if (!lvccNames.length) result.warnings.push("LVCC DHR Reviews: sheet absent; this operational dataset was not imported.");
  else {
    const name = lvccNames[0]; const sheet = workbook.Sheets[name];
    validateSheetCaches(sheet, name);
    const rows = absoluteRows(sheet);
    const isSubtotal = (row: number, sectionHeader: number): boolean => {
      if (!rows[row] || !blank(rows[row][0]) || !blank(rows[row][1])) return false;
      const values = rows[row].flatMap((value, col) => blank(value) ? [] : [col]);
      return values.length > 0 && values.every((col) => {
        if (col < 2 || col > 4) return false;
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        const formula = String((sheet[address] as XLSX.CellObject | undefined)?.f ?? "");
        const match = formula.match(/^=?SUM\(\$?([CDE])\$?(\d+):\$?\1\$?(\d+)\)$/i);
        return Boolean(match && match[1].toUpperCase() === XLSX.utils.encode_col(col)
          && Number(match[2]) >= sectionHeader + 2 && Number(match[3]) < row + 1);
      });
    };
    let partNumber: string | undefined; let header = -1; let sections = 0; const parts = new Set<string>();
    for (let row = 0; row < rows.length; row++) {
      const first = cellValue(sheet, name, row, 0);
      if (typeof first === "string" && /^J\d+P?$/i.test(first.trim())) {
        partNumber = first.trim().toUpperCase(); header = -1;
        if (parts.has(partNumber)) throw new Error(`${name}!A${row + 1}: duplicate LVCC part section`);
        parts.add(partNumber); continue;
      }
      if (norm(first) === "week") {
        if (!partNumber || header >= 0 || norm(cellValue(sheet, name, row, 1)) !== "start" || norm(cellValue(sheet, name, row, 2)) !== "total") throw new Error(`${name}!${row + 1}: malformed LVCC section headers`);
        header = row; sections++; continue;
      }
      if (!partNumber || header < 0 || rows[row].every(blank)) continue;
      if (isSubtotal(row, header)) continue;
      // The source has one standalone numeric marker immediately before its
      // formula subtotal. This is distinct from a review row missing its date.
      if (typeof first === "number" && Number.isInteger(first) && rows[row].slice(1).every(blank) && isSubtotal(row + 1, header)) {
        result.warnings.push(`${name}!A${row + 1}: standalone marker before formula totals excluded from weekly records.`);
        continue;
      }
      if (blank(first) || blank(cellValue(sheet, name, row, 1))) throw new Error(`${name}!${row + 1}: LVCC review row requires both week and Start date`);
      const numbers: Record<string, string> = {};
      const found: LocatedSheet = { name, sheet, rows, header, columns: new Map([["week", 0], ["start", 1], ["total", 2], ["column d", 3], ["column e", 4]]) };
      const read = reader(found, row, numbers);
      const weekNumber = read.number("week", "weekNumber", true, true)!;
      const rawDate = read.value("start"); const normalizedSource = dateParts(rawDate, read.context("start")).day;
      const weekStart = isoWeekStart(planYear, weekNumber);
      if (normalizedSource !== weekStart) result.warnings.push(`${name}!B${row + 1}: source date ${normalizedSource} conflicts with ${planYear} week ${weekNumber}; normalized to ${weekStart}, source date retained.`);
      const reviewIds: LvccReviewData["reviewIds"] = [];
      for (let col = 5; col <= XLSX.utils.decode_range(sheet["!ref"] ?? "A1").e.c; col++) {
        const value = cellValue(sheet, name, row, col);
        if (!blank(value)) reviewIds.push({ slot: col - 4, value: String(value).trim(), sourceCell: XLSX.utils.encode_cell({ r: row, c: col }) });
      }
      const data: LvccReviewData = {
        partNumber, weekNumber, weekStart, sourceWeekStart: sourceValue(rawDate), reviewIds, listedCount: reviewIds.length,
        recordedTotal: read.number("total", "recordedTotal", false, true), sourceColumnD: read.number("column d", "sourceColumnD", false, true), sourceColumnE: read.number("column e", "sourceColumnE", false, true),
      };
      for (const [col, field] of [[3, "sourceColumnDLabel"], [4, "sourceColumnELabel"]] as const) {
        const label = cellValue(sheet, name, header, col); if (!blank(label)) data[field] = String(label).trim();
      }
      if (data.recordedTotal !== undefined) {
        data.totalDifference = data.listedCount - data.recordedTotal;
        if (data.totalDifference !== 0) result.warnings.push(`${name}!C${row + 1}: recorded total ${data.recordedTotal} differs from ${data.listedCount} listed review IDs; both retained.`);
      }
      add("lvcc_reviews", [partNumber, weekNumber], name, row + 1, provenance(data, numbers));
    }
    if (sections !== 2 || parts.size !== 2) throw new Error(`${name}: expected two distinct LVCC part review sections`);
    imported(name);
  }

  const install = locate(workbook, "Install Parts", ["Replaced in Service", "Key", "Year Month", "SO No", "Eqp JNo", "Part No", "Sum of Parts Qty", "Sum of Cost USD", "Sum of Part Cost USD", "Parts Complete LOC Dt Tm"], result.warnings);
  if (install) {
    for (let row = install.header + 1; row < install.rows.length; row++) {
      if (install.rows[row].every(blank)) continue;
      const numbers: Record<string, string> = {}; const read = reader(install, row, numbers);
      const serviceOrder = read.identifier("SO No"); const equipmentNumber = read.identifier("Eqp JNo"); const partNumber = read.identifier("Part No");
      const rawDate = read.value("Parts Complete LOC Dt Tm"); const rawMonth = read.value("Year Month");
      const data: InstallPartData = {
        serviceOrder, equipmentNumber, partNumber, completedAt: dateParts(rawDate, read.context("Parts Complete LOC Dt Tm")).timestamp,
        equipmentPartKey: read.identifier("Key"), yearMonth: monthValue(rawMonth, read.context("Year Month")),
        quantity: read.number("Sum of Parts Qty", "quantity", true)!, costUsd: read.number("Sum of Cost USD", "costUsd", true)!, partCostUsd: read.number("Sum of Part Cost USD", "partCostUsd", true)!,
        sourceCompletedAt: sourceValue(rawDate), sourceYearMonth: sourceValue(rawMonth),
      };
      if (data.equipmentPartKey !== `${equipmentNumber}-${partNumber}`) throw new Error(`${read.context("Key")}: equipment/part key mismatch`);
      for (const [field, label] of [["replacedInServiceKey", "Replaced in Service"], ["region", "Eqp WW Region Cd"], ["country", "Eqp Country Cd"], ["productFamily", "Eqp OC Product Family"], ["problemCode", "Problem Cd"], ["feedbackCode", "Parts Feedback Cd"], ["description", "Part Dsc"], ["technicianCode", "Parts Tech Cd"], ["technicianName", "Parts Tech Nm"], ["serviceMemo", "Parts Memo Service"], ["resolutionMemo", "Parts Memo Resolution"], ["serviceOrderFeedback", "SO Feedback"], ["installFeedbackNotes", "Install Feedback Notes"], ["internalComments", "OMNI Internal Comments"]] as const) data[field] = read.text(label);
      add("install_parts", [serviceOrder, equipmentNumber, partNumber], install.name, row + 1, provenance(data, numbers));
    }
    imported(install.name);
  }

  const certified = locate(workbook, "Certified Parts", ["Key", "Year Month", "Eqp JNo", "SO No", "SO Part Ln No", "Parts Link Lbr Line No", "Part No", "Sum of Parts Qty", "Sum of Part Cost USD", "Sum of All Cost USD", "Parts SO Line Type"], result.warnings);
  if (certified) {
    const totals = { quantity: 0, partCostUsd: 0, allCostUsd: 0 };
    let missingMonthCount = 0;
    let control: { row: number; values: typeof totals } | undefined;
    for (let row = certified.header + 1; row < certified.rows.length; row++) {
      if (certified.rows[row].every(blank)) continue;
      const numbers: Record<string, string> = {}; const read = reader(certified, row, numbers);
      const monthRaw = read.value("Year Month");
      if (norm(monthRaw) === "total") {
        if (control) throw new Error(`${certified.name}!${row + 1}: duplicate Certified Parts total control`);
        if (!["SO No", "Eqp JNo", "Part No", "SO Part Ln No", "Parts Link Lbr Line No", "Parts SO Line Type"].every((label) => blank(read.value(label)))) throw new Error(`${certified.name}!${row + 1}: ambiguous total row contains line identifiers`);
        control = { row: row + 1, values: { quantity: read.number("Sum of Parts Qty", "quantity", true)!, partCostUsd: read.number("Sum of Part Cost USD", "partCostUsd", true)!, allCostUsd: read.number("Sum of All Cost USD", "allCostUsd", true)! } };
        continue;
      }
      if (norm(monthRaw).startsWith("applied filters:") && certified.rows[row].filter((value) => !blank(value)).length === 1) continue;
      const data: CertifiedPartData = {
        serviceOrder: read.identifier("SO No"), partLineNumber: read.identifier("SO Part Ln No"), laborLineNumber: read.identifier("Parts Link Lbr Line No"), partNumber: read.identifier("Part No"), lineType: read.identifier("Parts SO Line Type"),
        equipmentNumber: read.identifier("Eqp JNo"), equipmentPartKey: read.identifier("Key"),
        quantity: read.number("Sum of Parts Qty", "quantity", true)!, partCostUsd: read.number("Sum of Part Cost USD", "partCostUsd", true)!, allCostUsd: read.number("Sum of All Cost USD", "allCostUsd", true)!,
        feedbackCode: read.text("Parts Feedback Cd"), description: read.text("Part Dsc"),
      };
      if (blank(monthRaw)) missingMonthCount++;
      else { data.yearMonth = monthValue(monthRaw, read.context("Year Month")); data.sourceYearMonth = sourceValue(monthRaw); }
      if (data.equipmentPartKey !== `${data.equipmentNumber}-${data.partNumber}`) throw new Error(`${read.context("Key")}: equipment/part key mismatch`);
      for (const field of ["quantity", "partCostUsd", "allCostUsd"] as const) totals[field] += data[field];
      add("certified_parts", [data.serviceOrder, data.partLineNumber, data.laborLineNumber, data.partNumber, data.lineType], certified.name, row + 1, provenance(data, numbers));
    }
    if (control) {
      for (const field of ["quantity", "partCostUsd", "allCostUsd"] as const) {
        const tolerance = field === "quantity" ? 1e-9 : 0.005;
        if (Math.abs(totals[field] - control.values[field]) > tolerance) throw new Error(`${certified.name}!${control.row}: ${field} source total does not reconcile with imported lines`);
      }
      result.warnings.push(`${certified.name}!${control.row}: source Total reconciled with ${result.counts.certified_parts} lines (quantity ${control.values.quantity}; part cost USD ${control.values.partCostUsd}; all cost USD ${control.values.allCostUsd}); footer excluded from records.`);
    } else result.warnings.push(`${certified.name}: no source Total control supplied; line completeness cannot be reconciled to a workbook control.`);
    if (missingMonthCount) result.warnings.push(`${certified.name}: ${missingMonthCount} lines have no source year month; records retained with month unavailable.`);
    imported(certified.name);
  }

  const summary = locate(workbook, `${planYear} Summary`, ["VITROS", "VISION", "LVCC - Electrometer", "LVCC IR Wash"], result.warnings);
  if (summary) {
    const columns = new Map<RemProduct, number>();
    for (const [label, col] of summary.columns) { const canonical = product(label); if (canonical) { if (columns.has(canonical)) throw new Error(`${summary.name}: duplicate product heading`); columns.set(canonical, col); } }
    const periodCol = 0; const quarterRows = new Map<string, number>(); let totalRow: number | undefined;
    for (let row = summary.header + 1; row < summary.rows.length; row++) {
      const label = String(cellValue(summary.sheet, summary.name, row, periodCol) ?? "").trim().toUpperCase();
      if (!label) continue;
      if (label === "TOTAL") { if (totalRow !== undefined) throw new Error(`${summary.name}: duplicate total row`); totalRow = row; }
      else if (QUARTERS.includes(label as typeof QUARTERS[number])) { if (quarterRows.has(label)) throw new Error(`${summary.name}: duplicate ${label}`); quarterRows.set(label, row); }
      else throw new Error(`${summary.name}!A${row + 1}: unexpected Summary period`);
    }
    if (columns.size !== 4 || quarterRows.size !== 4 || totalRow === undefined) throw new Error(`${summary.name}: expected four products, four quarters, and annual Total`);
    const tracker = workbook.SheetNames.filter((name) => norm(name) === "tracker");
    if (tracker.length > 1) throw new Error("Ambiguous Tracker sheet for Summary comparison");
    const trackerPlans = new Map<string, number>();
    if (tracker.length) {
      const name = tracker[0]; const sheet = workbook.Sheets[name];
      const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
      for (let row = 0; row < Math.min(6, range.e.r + 1); row++) {
        const starts: number[] = [];
        for (let col = 0; col <= range.e.c; col++) if (norm(cellValue(sheet, name, row, col)) === "product") starts.push(col);
        if (starts.length !== 4) continue;
        for (let group = 0; group < starts.length; group++) {
          const start = starts[group]; const end = starts[group + 1] ?? range.e.c + 1;
          const cols = new Map<string, number>();
          for (let col = start; col < end; col++) cols.set(norm(cellValue(sheet, name, row, col)), col);
          if (!["quarter", "week", "plan"].every((label) => cols.has(label))) throw new Error(`${name}: missing Tracker comparison headers`);
          const seen = new Set<string>();
          for (let r = row + 1; r <= range.e.r; r++) {
            const p = product(cellValue(sheet, name, r, start)); const week = cellValue(sheet, name, r, cols.get("week")!);
            if (!p || blank(week) || !Number.isInteger(Number(week)) || Number(week) < 1 || Number(week) > 53) continue;
            const read = reader({ name, sheet, header: row, columns: cols, rows: [] }, r, {});
            const quarter = read.text("quarter")?.toUpperCase();
            if (!quarter || !QUARTERS.includes(quarter as typeof QUARTERS[number])) throw new Error(`${name}!${r + 1}: invalid Tracker quarter`);
            const plan = read.number("plan", "plan", true, true)!;
            const identity = `${p}:${week}`; if (seen.has(identity)) throw new Error(`${name}: duplicate weekly comparison row`); seen.add(identity);
            const key = `${p}:${quarter}`; trackerPlans.set(key, (trackerPlans.get(key) ?? 0) + plan);
          }
        }
        break;
      }
      if (trackerPlans.size !== 16) throw new Error(`${name}: incomplete Tracker product/quarter comparison`);
    }
    for (const p of PRODUCTS) {
      const col = columns.get(p)!; let sum = 0;
      const numeric = (row: number, field: string, numbers: Record<string, string>) => reader({ ...summary, columns: new Map([[norm(field), col]]) }, row, numbers).number(field, field, true, true)!;
      const annualNumbers: Record<string, string> = {};
      const annualTargetValue = numeric(totalRow, "annualTargetValue", annualNumbers);
      for (const quarter of QUARTERS) {
        const row = quarterRows.get(quarter)!; const numbers: Record<string, string> = { ...annualNumbers };
        const targetValue = numeric(row, "targetValue", numbers); sum += targetValue;
        const data: SummaryTargetData = { product: p, quarter, targetValue, annualTargetValue };
        const trackerPlan = trackerPlans.get(`${p}:${quarter}`);
        if (trackerPlan !== undefined) {
          data.trackerPlanValue = trackerPlan; data.planVariance = trackerPlan - targetValue;
          if (data.planVariance !== 0) result.warnings.push(`${summary.name}!${XLSX.utils.encode_cell({ r: row, c: col })}: ${p} ${quarter} Summary target ${targetValue} differs from Tracker plan ${trackerPlan}; retained as separate measures.`);
        }
        add("summary_targets", [p, quarter], summary.name, row + 1, provenance(data, numbers));
      }
      if (Math.abs(sum - annualTargetValue) > 1e-9) throw new Error(`${summary.name}: ${p} quarterly targets do not reconcile with annual Total`);
    }
    if (!tracker.length) result.warnings.push(`${summary.name}: Tracker absent; operating-plan comparison unavailable.`);
    imported(summary.name);
  }
  return result;
}
