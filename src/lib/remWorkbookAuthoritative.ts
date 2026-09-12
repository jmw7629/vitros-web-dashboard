import * as XLSX from "xlsx";

export type AnalyzerImportRow = {
  serialNumber: string;
  analyzerType: string;
  productionOrder?: number;
  cleaningPct: number;
  servicePct: number;
  finalLinePct: number;
  releaseTestingPct: number;
  packagingPct: number;
};

export type TrackerWeeklyImportRow = {
  sourceKey: string;
  year: number;
  product: string;
  quarter: string;
  weekNumber: number;
  weekStart?: string;
  plan: number;
  actual?: number;
  quarterPlan?: number;
  quarterActual?: number;
  totalPlan?: number;
  totalActual?: number;
  weeklyForecast?: number;
  accumulatedForecast?: number;
};

export type BuildPlanImportRow = {
  sourceKey: string;
  year: number;
  quarter: string;
  weekNumber: number;
  weekStart?: string;
  data: Record<string, unknown>;
};

export type StaffImportRow = {
  sourceKey: string;
  year: number;
  wwid: string;
  name: string;
  role?: string;
  started?: string;
  completeAfter?: string;
  fte?: number;
  trainingUntil?: string;
  skills: Record<string, string>;
  certifications: Record<string, string>;
  comment?: string;
};

export type WeeklyNoteImportRow = {
  sourceKey: string;
  year: number;
  weekStart?: string;
  weekNumber: number;
  quarter: string;
  notes: {
    vitros?: string;
    vision?: string;
    lvccElectrometer?: string;
    lvccIrWash?: string;
  };
};

export type TargetImportRow = {
  sourceKey: string;
  year: number;
  targetType: string;
  targetValue: number;
  actualValue: number;
  data: Record<string, unknown>;
};

export type AuthoritativeRemImportPreview = {
  fileName: string;
  fileHash: string;
  planYear: number;
  sourceSheet: string;
  sourceWeek?: number;
  analyzers: AnalyzerImportRow[];
  trackerWeekly: TrackerWeeklyImportRow[];
  buildPlan: BuildPlanImportRow[];
  staff: StaffImportRow[];
  weeklyNotes: WeeklyNoteImportRow[];
  targets: TargetImportRow[];
  skippedRows: number;
  recognizedSheets: string[];
  importedSheets: string[];
  unimportedSheets: string[];
};

const normalize = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

function optionalText(value: unknown, max = 500): string | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function numberValue(value: unknown, context?: string): number | undefined {
  if (isBlank(value)) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const preview = JSON.stringify(String(value).slice(0, 120));
    if (context) throw new Error(`${context}: malformed numeric value ${preview} — expected a finite number`);
    return undefined; // Week discovery skips non-data labels such as totals.
  }
  return n;
}

function nonNegative(value: unknown, field: string, max = 1_000_000): number | undefined {
  const n = numberValue(value, field);
  if (n === undefined) return undefined;
  if (n < 0 || n > max) throw new Error(`${field} is outside the supported range`);
  return n;
}

function percent(value: unknown, field?: string): number {
  if (isBlank(value)) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    const label = field ? `${field}: ` : "";
    throw new Error(`${label}Invalid progress value: ${String(value).slice(0, 120)}`);
  }
  const scaled = n <= 1.000001 ? n * 100 : n;
  if (scaled > 100.0001) throw new Error(`Progress exceeds 100%: ${String(value).slice(0, 120)}`);
  return Math.round(Math.min(100, scaled) * 1000) / 1000;
}

function ensureFormulaCache(sheet: XLSX.WorkSheet, sheetName: string, r: number, c: number, field: string): void {
  if (c < 0) return; // Optional columns can be absent from the source sheet.
  const address = XLSX.utils.encode_cell({ r, c });
  const cell = (sheet as unknown as Record<string, XLSX.CellObject>)[address] as XLSX.CellObject | undefined;
  if (!cell || cell.f == null) return;
  if (cell.t === "e") {
    const detail = (cell as unknown as { w?: string }).w ?? String(cell.v ?? "#ERR");
    throw new Error(`${field} at ${sheetName}!${address} has formula error cached value ${JSON.stringify(detail.slice(0, 120))} — recalculate workbook before import`);
  }
  if (cell.v === undefined || cell.v === null) {
    throw new Error(`${field} at ${sheetName}!${address} has formula without cached value — open and recalculate/save workbook before import`);
  }
  if (cell.t === "z") {
    throw new Error(`${field} at ${sheetName}!${address} has formula without cached value (empty) — recalculate workbook before import`);
  }
}

function analyzerTypeFromSerial(serial: string) {
  if (serial.startsWith("3600")) return "3600";
  if (serial.startsWith("5600")) return "5600";
  if (serial.startsWith("7600")) return "7600";
  throw new Error(`Unsupported VITROS analyzer serial ${serial}`);
}

function toIsoDate(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m && parsed?.d) {
      return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  const text = optionalText(value, 40);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : text;
}

function quarterFromWeek(week: number) {
  if (week <= 13) return "Q1";
  if (week <= 26) return "Q2";
  if (week <= 39) return "Q3";
  return "Q4";
}

function canonicalProduct(value: unknown): string | undefined {
  const n = normalize(value).replace(/\s*[-–—]\s*/g, "-");
  if (!n) return undefined;
  if (n === "vitros") return "VITROS";
  if (n === "vision") return "VISION";
  if (n.includes("lvcc") && n.includes("electrometer")) return "LVCC_ELECTROMETER";
  if (n.includes("lvcc") && (n.includes("ir wash") || n.endsWith("-ir"))) return "LVCC_IR_WASH";
  return undefined;
}

function matrix(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
}

function inferPlanYear(workbook: XLSX.WorkBook) {
  for (const name of workbook.SheetNames) {
    const match = normalize(name).match(/^(20\d{2}) summary$/);
    if (match) return Number(match[1]);
  }
  throw new Error("REM workbook year could not be established from its internal summary sheet");
}

function latestVitrosWip(workbook: XLSX.WorkBook) {
  const candidates = workbook.SheetNames
    .map((name) => {
      const match = normalize(name).match(/^wip productivity vitros wk\s*(\d{1,2})$/);
      return match ? { name, week: Number(match[1]) } : null;
    })
    .filter((value): value is { name: string; week: number } => Boolean(value))
    .filter(({ week }) => Number.isInteger(week) && week >= 1 && week <= 53)
    .sort((a, b) => b.week - a.week);

  if (candidates[0]) return candidates[0];
  const fallback = workbook.SheetNames.find((name) => normalize(name).startsWith("wip productivity vitros"));
  if (!fallback) throw new Error("REM VITROS WIP sheet was not found");
  return { name: fallback, week: undefined };
}

function parseAnalyzers(sheet: XLSX.WorkSheet, sheetName: string) {
  const rows = matrix(sheet);
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map(normalize);
    return cells.includes("production order")
      && cells.includes("wip")
      && cells.includes("clean")
      && cells.includes("service")
      && cells.includes("fl")
      && cells.includes("release/clean")
      && cells.includes("pack");
  });
  if (headerIndex < 0) throw new Error("REM WIP headers were not found");

  const header = rows[headerIndex].map(normalize);
  const productionOrderCol = header.indexOf("production order");
  const serialCol = header.indexOf("wip");
  const cleanCol = header.indexOf("clean");
  const serviceCol = header.indexOf("service");
  const finalLineCol = header.indexOf("fl");
  const releaseCol = header.indexOf("release/clean");
  const packCol = header.indexOf("pack");

  const analyzers: AnalyzerImportRow[] = [];
  const serials = new Set<string>();
  let skippedRows = 0;

  for (let r = headerIndex + 2; r < rows.length; r++) {
    const row = rows[r];
    const serialAddr = XLSX.utils.encode_cell({ r, c: serialCol });
    const serialField = `WIP serial at ${sheetName}!${serialAddr}`;
    ensureFormulaCache(sheet, sheetName, r, serialCol, serialField);
    const serial = String(row[serialCol] ?? "").trim().toUpperCase();
    if (!serial) continue;
    if (!/^\d{8}$/.test(serial)) {
      skippedRows += 1;
      continue;
    }
    const poAddr = XLSX.utils.encode_cell({ r, c: productionOrderCol });
    const poField = `Analyzer ${serial} production order at ${sheetName}!${poAddr}`;
    ensureFormulaCache(sheet, sheetName, r, productionOrderCol, poField);
    const rawPO = row[productionOrderCol];
    const productionOrder = numberValue(rawPO, poField);
    if (productionOrder !== undefined && productionOrder < 0) {
      skippedRows += 1;
      continue;
    }
    const poValue = productionOrder ?? 0;
    if (serials.has(serial)) throw new Error(`Duplicate WIP serial found in workbook: ${serial}`);
    serials.add(serial);
    const pctField = (col: number, label: string) => `${label} for ${serial} at ${sheetName}!${XLSX.utils.encode_cell({ r, c: col })}`;
    ensureFormulaCache(sheet, sheetName, r, cleanCol, pctField(cleanCol, "CleaningPct"));
    ensureFormulaCache(sheet, sheetName, r, serviceCol, pctField(serviceCol, "ServicePct"));
    ensureFormulaCache(sheet, sheetName, r, finalLineCol, pctField(finalLineCol, "FinalLinePct"));
    ensureFormulaCache(sheet, sheetName, r, releaseCol, pctField(releaseCol, "ReleasePct"));
    ensureFormulaCache(sheet, sheetName, r, packCol, pctField(packCol, "PackPct"));
    analyzers.push({
      serialNumber: serial,
      analyzerType: analyzerTypeFromSerial(serial),
      productionOrder: poValue,
      cleaningPct: percent(row[cleanCol], pctField(cleanCol, "CleaningPct")),
      servicePct: percent(row[serviceCol], pctField(serviceCol, "ServicePct")),
      finalLinePct: percent(row[finalLineCol], pctField(finalLineCol, "FinalLinePct")),
      releaseTestingPct: percent(row[releaseCol], pctField(releaseCol, "ReleasePct")),
      packagingPct: percent(row[packCol], pctField(packCol, "PackPct")),
    });
  }

  if (analyzers.length < 5) throw new Error(`Only ${analyzers.length} valid analyzer rows were found; import stopped safely.`);
  if (analyzers.length > 250) throw new Error("REM workbook exceeds the 250-analyzer import safety limit");
  return { analyzers, skippedRows };
}

function parseTracker(sheet: XLSX.WorkSheet, sheetName: string, year: number) {
  const rows = matrix(sheet);
  const headerIndex = rows.findIndex((row) => row.filter((value) => normalize(value) === "product").length >= 4);
  if (headerIndex < 0) throw new Error("REM Tracker product groups were not found");
  const header = rows[headerIndex].map(normalize);
  const starts = header.flatMap((value, index) => value === "product" ? [index] : []);
  if (starts.length < 4) throw new Error("REM Tracker is missing expected product groups");

  const trackerWeekly: TrackerWeeklyImportRow[] = [];
  const seen = new Set<string>();

  for (let groupIndex = 0; groupIndex < starts.length; groupIndex += 1) {
    const start = starts[groupIndex];
    const end = starts[groupIndex + 1] ?? header.length;
    const local = (label: string) => {
      const absolute = header.findIndex((value, index) => index >= start && index < end && value === label);
      return absolute >= 0 ? absolute : undefined;
    };
    const cols = {
      product: start,
      quarter: local("quarter"),
      week: local("week"),
      date: local("date"),
      plan: local("plan"),
      actual: local("actuals"),
      quarterPlan: local("quarter plan"),
      quarterActual: local("quarter actual"),
      totalPlan: local("total plan"),
      totalActual: local("total actuals"),
      weeklyForecast: local("wkly fc"),
      accumulatedForecast: local("accumulate fc"),
    };
    if (cols.week === undefined || cols.plan === undefined) continue;

    for (let r = headerIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      if (cols.product >= 0) {
        const prodAddr = XLSX.utils.encode_cell({ r, c: cols.product });
        const prodField = `Tracker product at ${sheetName}!${prodAddr}`;
        ensureFormulaCache(sheet, sheetName, r, cols.product, prodField);
      }
      const product = canonicalProduct(row[cols.product]);
      if (!product) continue;
      const weekAddr = XLSX.utils.encode_cell({ r, c: cols.week });
      const weekField = `${product} week at ${sheetName}!${weekAddr}`;
      ensureFormulaCache(sheet, sheetName, r, cols.week, weekField);
      // Lenient discovery: footer/total labels are skipped, not rejected as malformed
      const week = numberValue(row[cols.week]);
      if (week === undefined || !Number.isInteger(week) || week < 1 || week > 53) continue;
      const planAddr = XLSX.utils.encode_cell({ r, c: cols.plan });
      const planField = `${product} week ${week} plan at ${sheetName}!${planAddr}`;
      ensureFormulaCache(sheet, sheetName, r, cols.plan, planField);
      const plan = nonNegative(row[cols.plan], planField, 100_000);
      if (plan === undefined) continue;
      const sourceKey = `${year}:tracker:${product}:${week}`;
      if (seen.has(sourceKey)) throw new Error(`Duplicate REM Tracker row: ${sourceKey}`);
      seen.add(sourceKey);
      if (cols.quarter !== undefined && cols.quarter >= 0) {
        const qAddr = XLSX.utils.encode_cell({ r, c: cols.quarter });
        ensureFormulaCache(sheet, sheetName, r, cols.quarter, `${product} quarter at ${sheetName}!${qAddr}`);
      }
      if (cols.date !== undefined && cols.date >= 0) {
        const dAddr = XLSX.utils.encode_cell({ r, c: cols.date });
        ensureFormulaCache(sheet, sheetName, r, cols.date, `Tracker date at ${sheetName}!${dAddr}`);
      }
      const rawQuarter = cols.quarter === undefined ? undefined : optionalText(row[cols.quarter], 8)?.toUpperCase();
      const quarter = rawQuarter && /^Q[1-4]$/.test(rawQuarter) ? rawQuarter : quarterFromWeek(week);
      const readNonNeg = (col: number | undefined, label: string, max: number) => {
        if (col === undefined) return undefined;
        const addr = XLSX.utils.encode_cell({ r, c: col });
        const field = `${sourceKey} ${label} at ${sheetName}!${addr}`;
        ensureFormulaCache(sheet, sheetName, r, col, field);
        return nonNegative(row[col], field, max);
      };
      trackerWeekly.push({
        sourceKey,
        year,
        product,
        quarter,
        weekNumber: week,
        weekStart: cols.date === undefined ? undefined : toIsoDate(row[cols.date]),
        plan,
        actual: readNonNeg(cols.actual, "actual", 100_000),
        quarterPlan: readNonNeg(cols.quarterPlan, "quarterPlan", 1_000_000),
        quarterActual: readNonNeg(cols.quarterActual, "quarterActual", 1_000_000),
        totalPlan: readNonNeg(cols.totalPlan, "totalPlan", 1_000_000),
        totalActual: readNonNeg(cols.totalActual, "totalActual", 1_000_000),
        weeklyForecast: readNonNeg(cols.weeklyForecast, "weeklyForecast", 100_000),
        accumulatedForecast: readNonNeg(cols.accumulatedForecast, "accumulatedForecast", 1_000_000),
      });
    }
  }

  if (trackerWeekly.length < 40) throw new Error("REM Tracker did not contain enough authoritative weekly rows");

  const totals = new Map<string, { plan: number; actual: number; actualWeeks: number }>();
  for (const row of trackerWeekly) {
    const current = totals.get(row.product) ?? { plan: 0, actual: 0, actualWeeks: 0 };
    current.plan += row.plan;
    if (row.actual !== undefined) {
      current.actual += row.actual;
      current.actualWeeks += 1;
    }
    totals.set(row.product, current);
  }
  const targets: TargetImportRow[] = Array.from(totals.entries()).map(([product, values]) => ({
    sourceKey: `${year}:target:${product}`,
    year,
    targetType: `${product}_ANNUAL_PLAN`,
    targetValue: values.plan,
    actualValue: values.actual,
    data: { product, actualWeeks: values.actualWeeks, source: "Tracker" },
  }));
  return { trackerWeekly, targets };
}

function parseBuildPlan(sheet: XLSX.WorkSheet, sheetName: string, year: number) {
  const rows = matrix(sheet);
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map(normalize);
    return cells.includes("week") && cells.includes("3600") && cells.includes("5600") && cells.includes("7600") && cells.includes("head count");
  });
  if (headerIndex < 0) throw new Error("REM Build Plan headers were not found");

  const col = (letters: string) => XLSX.utils.decode_col(letters);
  const buildPlan: BuildPlanImportRow[] = [];
  const seen = new Set<string>();

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const weekColIdx = col("B");
    const weekAddr = XLSX.utils.encode_cell({ r, c: weekColIdx });
    const weekField = `Build Plan week at ${sheetName}!${weekAddr}`;
    ensureFormulaCache(sheet, sheetName, r, weekColIdx, weekField);
    const week = numberValue(row[weekColIdx]);
    if (week === undefined || !Number.isInteger(week) || week < 1 || week > 53) continue;
    ensureFormulaCache(sheet, sheetName, r, col("A"), "Build Plan quarter");
    ensureFormulaCache(sheet, sheetName, r, col("C"), "Build Plan date");
    const quarterRaw = optionalText(row[col("A")], 8)?.toUpperCase();
    const quarter = quarterRaw && /^Q[1-4]$/.test(quarterRaw) ? quarterRaw : quarterFromWeek(week);
    const sourceKey = `${year}:build-plan:${week}`;
    if (seen.has(sourceKey)) throw new Error(`Duplicate REM Build Plan week: ${week}`);
    seen.add(sourceKey);
    const nAt = (letters: string, label: string, max = 1_000_000) => {
      const c = col(letters);
      const addr = XLSX.utils.encode_cell({ r, c });
      const field = `${label} at ${sheetName}!${addr}`;
      ensureFormulaCache(sheet, sheetName, r, c, field);
      return nonNegative(row[c], field, max);
    };
    const signedAt = (letters: string, label: string) => {
      const c = col(letters);
      const addr = XLSX.utils.encode_cell({ r, c });
      const field = `${label} at ${sheetName}!${addr}`;
      ensureFormulaCache(sheet, sheetName, r, c, field);
      return numberValue(row[c], field);
    };
    const data: Record<string, unknown> = {
      sourceKey,
      year,
      quarter,
      weekNumber: week,
      weekStart: toIsoDate(row[col("C")]),
      delivery: {
        analyzer3600: nAt("D", `${sourceKey} delivery 3600`, 10_000),
        analyzer5600: nAt("E", `${sourceKey} delivery 5600`, 10_000),
        analyzer7600: nAt("F", `${sourceKey} delivery 7600`, 10_000),
        vision: nAt("G", `${sourceKey} delivery VISION`, 10_000),
        electrometer: nAt("H", `${sourceKey} delivery electrometer`, 10_000),
        irWash: nAt("I", `${sourceKey} delivery IR`, 10_000),
        total: nAt("J", `${sourceKey} delivery total`, 50_000),
      },
      capacity: {
        meets: nAt("K", `${sourceKey} meets`, 100_000),
        exceeds: nAt("L", `${sourceKey} exceeds`, 100_000),
        capacity: nAt("M", `${sourceKey} capacity`, 100_000),
        delta: signedAt("N", `${sourceKey} delta`),
        headCount: nAt("O", `${sourceKey} headcount`, 1_000),
        onboarding: nAt("P", `${sourceKey} onboarding`, 1_000),
        inTraining: nAt("Q", `${sourceKey} in-training`, 1_000),
        holidays: nAt("R", `${sourceKey} holidays`, 1_000),
        ptoDays: nAt("S", `${sourceKey} PTO`, 10_000),
      },
      actuals: {
        analyzer3600: nAt("U", `${sourceKey} actual 3600`, 10_000),
        analyzer5600: nAt("V", `${sourceKey} actual 5600`, 10_000),
        analyzer7600: nAt("W", `${sourceKey} actual 7600`, 10_000),
        vitrosVsPlan: signedAt("X", `${sourceKey} vitrosVsPlan`),
        vitrosQuarterDelta: signedAt("Y", `${sourceKey} vitrosQuarterDelta`),
        vitrosWipMonday: nAt("Z", `${sourceKey} VITROS WIP`, 100_000),
        clean: nAt("AA", `${sourceKey} clean`, 100_000),
        service: nAt("AB", `${sourceKey} service`, 100_000),
        finalLine: nAt("AC", `${sourceKey} final`, 100_000),
        release: nAt("AD", `${sourceKey} release`, 100_000),
        pack: nAt("AE", `${sourceKey} pack`, 100_000),
        qc: nAt("AF", `${sourceKey} QC`, 100_000),
        finishedGoods: nAt("AG", `${sourceKey} FG`, 100_000),
        vision: nAt("AI", `${sourceKey} VISION`, 10_000),
        visionVsPlan: signedAt("AJ", `${sourceKey} visionVsPlan`),
        visionQuarterDelta: signedAt("AK", `${sourceKey} visionQuarterDelta`),
        visionService: nAt("AL", `${sourceKey} VISION service`, 100_000),
        visionFinalLine: nAt("AM", `${sourceKey} VISION final`, 100_000),
        visionPack: nAt("AN", `${sourceKey} VISION pack`, 100_000),
        visionFinishedGoods: nAt("AO", `${sourceKey} VISION FG`, 100_000),
        electrometer: nAt("AQ", `${sourceKey} electrometer`, 10_000),
        electrometerVsPlan: signedAt("AR", `${sourceKey} electrometerVsPlan`),
        electrometerQuarterDelta: signedAt("AS", `${sourceKey} electrometerQuarterDelta`),
        electrometerVsForecast: signedAt("AT", `${sourceKey} electrometerVsForecast`),
        irWash: nAt("AU", `${sourceKey} IR`, 10_000),
        irVsPlan: signedAt("AV", `${sourceKey} irVsPlan`),
        irQuarterDelta: signedAt("AW", `${sourceKey} irQuarterDelta`),
        irVsForecast: signedAt("AX", `${sourceKey} irVsForecast`),
        electrometerWip: nAt("AY", `${sourceKey} electrometer WIP`, 100_000),
        irWip: nAt("AZ", `${sourceKey} IR WIP`, 100_000),
        lvccFinishedGoods: nAt("BA", `${sourceKey} LVCC FG`, 100_000),
      },
      planningHours: {
        analyzer3600: nAt("BF", `${sourceKey} planning 3600`, 1_000),
        analyzer5600: nAt("BG", `${sourceKey} planning 5600`, 1_000),
        analyzer7600: nAt("BH", `${sourceKey} planning 7600`, 1_000),
        vision: nAt("BI", `${sourceKey} planning VISION`, 1_000),
        lvcc: nAt("BJ", `${sourceKey} planning LVCC`, 1_000),
      },
    };
    buildPlan.push({ sourceKey, year, quarter, weekNumber: week, weekStart: toIsoDate(row[col("C")]), data });
  }
  if (buildPlan.length < 20) throw new Error("REM Build Plan did not contain enough authoritative weekly rows");
  return buildPlan;
}

function parseStaff(sheet: XLSX.WorkSheet, sheetName: string, year: number) {
  const rows = matrix(sheet);
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map(normalize);
    return cells.includes("wwid") && cells.includes("name") && cells.includes("role") && cells.includes("fte") && cells.includes("cleaning") && cells.includes("dhr");
  });
  if (headerIndex < 0) throw new Error("REM Staff headers were not found");
  const header = rows[headerIndex].map(normalize);
  const idx = (label: string) => header.indexOf(normalize(label));
  const staff: StaffImportRow[] = [];
  const seen = new Set<string>();
  const skillLabels = ["Cleaning", "Service", "Final Line", "Release/Clean", "Pack", "Troubleshoot", "DHR", "SOF/Parts", "VISION", "LVCC"];

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    ensureFormulaCache(sheet, sheetName, r, idx("WWID"), "Staff WWID");
    ensureFormulaCache(sheet, sheetName, r, idx("Name"), "Staff name");
    const wwid = String(row[idx("WWID")] ?? "").trim();
    const name = optionalText(row[idx("Name")], 160);
    if (!wwid || !/^\d{6,12}$/.test(wwid) || !name) continue;
    for (const label of [...skillLabels, "Role", "Started", "Complete after", "Training Unitl", "Comment", "Required/Optional", "FE online", "FE Classroom"]) {
      ensureFormulaCache(sheet, sheetName, r, idx(label), `Staff ${label}`);
    }
    const sourceKey = `${year}:staff:${wwid}`;
    if (seen.has(sourceKey)) throw new Error(`Duplicate REM staff WWID: ${wwid}`);
    seen.add(sourceKey);
    const skills: Record<string, string> = {};
    for (const label of skillLabels) {
      const value = optionalText(row[idx(label)], 80);
      if (value) skills[label] = value;
    }
    const certifications: Record<string, string> = {};
    for (const [key, label] of [["requiredOptional", "Required/Optional"], ["feOnline", "FE online"], ["feClassroom", "FE Classroom"]] as const) {
      const value = optionalText(row[idx(label)], 300);
      if (value) certifications[key] = value;
    }
    const fteCol = idx("FTE");
    if (fteCol >= 0) {
      const fteField = `${sourceKey} FTE at ${sheetName}!${XLSX.utils.encode_cell({ r, c: fteCol })}`;
      ensureFormulaCache(sheet, sheetName, r, fteCol, fteField);
    }
    staff.push({
      sourceKey,
      year,
      wwid,
      name,
      role: optionalText(row[idx("Role")], 120),
      started: optionalText(row[idx("Started")], 80) ?? toIsoDate(row[idx("Started")]),
      completeAfter: toIsoDate(row[idx("Complete after")]) ?? optionalText(row[idx("Complete after")], 80),
      fte: fteCol >= 0 ? nonNegative(row[fteCol], `${sourceKey} FTE at ${sheetName}!${XLSX.utils.encode_cell({ r, c: fteCol })}`, 5) : undefined,
      trainingUntil: optionalText(row[idx("Training Unitl")], 80),
      skills,
      certifications,
      comment: optionalText(row[idx("Comment")], 1_000),
    });
  }
  if (staff.length < 5) throw new Error("REM Staff sheet did not contain enough recognized people");
  return staff;
}

function parseWeeklyNotes(sheet: XLSX.WorkSheet, sheetName: string, year: number) {
  const rows = matrix(sheet);
  const headerIndex = rows.findIndex((row) => row.some((value) => normalize(value) === "week"));
  if (headerIndex < 0) throw new Error("REM Notes week column was not found");
  const header = rows[headerIndex].map(normalize);
  const weekCol = header.indexOf("week");
  const weeklyNotes: WeeklyNoteImportRow[] = [];
  const seen = new Set<string>();

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const weekField = `Notes week at ${sheetName}!${XLSX.utils.encode_cell({ r, c: weekCol })}`;
    ensureFormulaCache(sheet, sheetName, r, weekCol, weekField);
    const week = numberValue(row[weekCol]);
    if (week === undefined || !Number.isInteger(week) || week < 1 || week > 53) continue;
    for (const c of [0, 2, 3, 4, 5, 6]) {
      ensureFormulaCache(sheet, sheetName, r, c, "Weekly note");
    }
    const quarterRaw = optionalText(row[0], 8)?.toUpperCase();
    const quarter = quarterRaw && /^Q[1-4]$/.test(quarterRaw) ? quarterRaw : quarterFromWeek(week);
    const notes = {
      vitros: optionalText(row[3], 10_000),
      vision: optionalText(row[4], 10_000),
      lvccElectrometer: optionalText(row[5], 10_000),
      lvccIrWash: optionalText(row[6], 10_000),
    };
    if (!Object.values(notes).some(Boolean)) continue;
    const sourceKey = `${year}:notes:${week}`;
    if (seen.has(sourceKey)) throw new Error(`Duplicate REM Notes week: ${week}`);
    seen.add(sourceKey);
    weeklyNotes.push({ sourceKey, year, weekStart: toIsoDate(row[2]), weekNumber: week, quarter, notes });
  }
  return weeklyNotes;
}

export function parseAuthoritativeRemWorkbook(
  fileName: string,
  fileHash: string,
  workbook: XLSX.WorkBook,
): AuthoritativeRemImportPreview {
  const normalizedNames = new Map(workbook.SheetNames.map((name) => [normalize(name), name]));
  const required = ["tracker", "build plan", "staff", "notes - issues"];
  const missing = required.filter((name) => !normalizedNames.has(name));
  if (missing.length) {
    throw new Error(`This file is not recognized as the REM production workbook. Missing internal sheet signatures: ${missing.join(", ")}`);
  }

  const planYear = inferPlanYear(workbook);
  const wip = latestVitrosWip(workbook);
  const trackerSheet = normalizedNames.get("tracker")!;
  const buildPlanSheet = normalizedNames.get("build plan")!;
  const staffSheet = normalizedNames.get("staff")!;
  const notesSheet = normalizedNames.get("notes - issues")!;
  const importedSheets = [trackerSheet, buildPlanSheet, staffSheet, notesSheet, wip.name];
  const recognizedSheets = [...importedSheets];
  const unimportedSheets = workbook.SheetNames.filter((name) => !importedSheets.includes(name));

  const { analyzers, skippedRows } = parseAnalyzers(workbook.Sheets[wip.name], wip.name);
  const { trackerWeekly, targets } = parseTracker(workbook.Sheets[trackerSheet], trackerSheet, planYear);
  const buildPlan = parseBuildPlan(workbook.Sheets[buildPlanSheet], buildPlanSheet, planYear);
  const staff = parseStaff(workbook.Sheets[staffSheet], staffSheet, planYear);
  const weeklyNotes = parseWeeklyNotes(workbook.Sheets[notesSheet], notesSheet, planYear);

  return {
    fileName,
    fileHash,
    planYear,
    sourceSheet: wip.name,
    sourceWeek: wip.week,
    analyzers,
    trackerWeekly,
    buildPlan,
    staff,
    weeklyNotes,
    targets,
    skippedRows,
    recognizedSheets,
    importedSheets,
    unimportedSheets,
  };
}
