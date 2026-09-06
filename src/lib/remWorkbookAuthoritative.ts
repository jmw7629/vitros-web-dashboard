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
};

const normalize = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

function optionalText(value: unknown, max = 500): string | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

function numberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || String(value).trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function nonNegative(value: unknown, field: string, max = 1_000_000): number | undefined {
  const n = numberValue(value);
  if (n === undefined) return undefined;
  if (n < 0 || n > max) throw new Error(`${field} is outside the supported range`);
  return n;
}

function percent(value: unknown): number {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid progress value: ${String(value)}`);
  const scaled = n <= 1.000001 ? n * 100 : n;
  if (scaled > 100.0001) throw new Error(`Progress exceeds 100%: ${String(value)}`);
  return Math.round(Math.min(100, scaled) * 1000) / 1000;
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

function parseAnalyzers(sheet: XLSX.WorkSheet) {
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

  for (const row of rows.slice(headerIndex + 2)) {
    const serial = String(row[serialCol] ?? "").trim().toUpperCase();
    if (!serial) continue;
    if (!/^\d{8}$/.test(serial)) {
      skippedRows += 1;
      continue;
    }
    const productionOrder = Number(row[productionOrderCol]);
    if (!Number.isFinite(productionOrder) || productionOrder < 0) {
      skippedRows += 1;
      continue;
    }
    if (serials.has(serial)) throw new Error(`Duplicate WIP serial found in workbook: ${serial}`);
    serials.add(serial);
    analyzers.push({
      serialNumber: serial,
      analyzerType: analyzerTypeFromSerial(serial),
      productionOrder,
      cleaningPct: percent(row[cleanCol]),
      servicePct: percent(row[serviceCol]),
      finalLinePct: percent(row[finalLineCol]),
      releaseTestingPct: percent(row[releaseCol]),
      packagingPct: percent(row[packCol]),
    });
  }

  if (analyzers.length < 5) throw new Error(`Only ${analyzers.length} valid analyzer rows were found; import stopped safely.`);
  if (analyzers.length > 250) throw new Error("REM workbook exceeds the 250-analyzer import safety limit");
  return { analyzers, skippedRows };
}

function parseTracker(sheet: XLSX.WorkSheet, year: number) {
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

    for (const row of rows.slice(headerIndex + 1)) {
      const product = canonicalProduct(row[cols.product]);
      const week = numberValue(row[cols.week]);
      if (!product || week === undefined || !Number.isInteger(week) || week < 1 || week > 53) continue;
      const plan = nonNegative(row[cols.plan], `${product} week ${week} plan`, 100_000);
      if (plan === undefined) continue;
      const sourceKey = `${year}:tracker:${product}:${week}`;
      if (seen.has(sourceKey)) throw new Error(`Duplicate REM Tracker row: ${sourceKey}`);
      seen.add(sourceKey);
      const rawQuarter = cols.quarter === undefined ? undefined : optionalText(row[cols.quarter], 8)?.toUpperCase();
      const quarter = rawQuarter && /^Q[1-4]$/.test(rawQuarter) ? rawQuarter : quarterFromWeek(week);
      trackerWeekly.push({
        sourceKey,
        year,
        product,
        quarter,
        weekNumber: week,
        weekStart: cols.date === undefined ? undefined : toIsoDate(row[cols.date]),
        plan,
        actual: cols.actual === undefined ? undefined : nonNegative(row[cols.actual], `${sourceKey} actual`, 100_000),
        quarterPlan: cols.quarterPlan === undefined ? undefined : nonNegative(row[cols.quarterPlan], `${sourceKey} quarterPlan`, 1_000_000),
        quarterActual: cols.quarterActual === undefined ? undefined : nonNegative(row[cols.quarterActual], `${sourceKey} quarterActual`, 1_000_000),
        totalPlan: cols.totalPlan === undefined ? undefined : nonNegative(row[cols.totalPlan], `${sourceKey} totalPlan`, 1_000_000),
        totalActual: cols.totalActual === undefined ? undefined : nonNegative(row[cols.totalActual], `${sourceKey} totalActual`, 1_000_000),
        weeklyForecast: cols.weeklyForecast === undefined ? undefined : nonNegative(row[cols.weeklyForecast], `${sourceKey} weeklyForecast`, 100_000),
        accumulatedForecast: cols.accumulatedForecast === undefined ? undefined : nonNegative(row[cols.accumulatedForecast], `${sourceKey} accumulatedForecast`, 1_000_000),
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

function parseBuildPlan(sheet: XLSX.WorkSheet, year: number) {
  const rows = matrix(sheet);
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map(normalize);
    return cells.includes("week") && cells.includes("3600") && cells.includes("5600") && cells.includes("7600") && cells.includes("head count");
  });
  if (headerIndex < 0) throw new Error("REM Build Plan headers were not found");

  const col = (letters: string) => XLSX.utils.decode_col(letters);
  const n = (row: unknown[], letters: string, label: string, max = 1_000_000) => nonNegative(row[col(letters)], label, max);
  const signed = (row: unknown[], letters: string) => numberValue(row[col(letters)]);
  const buildPlan: BuildPlanImportRow[] = [];
  const seen = new Set<string>();

  for (const row of rows.slice(headerIndex + 1)) {
    const week = numberValue(row[col("B")]);
    const quarterRaw = optionalText(row[col("A")], 8)?.toUpperCase();
    if (week === undefined || !Number.isInteger(week) || week < 1 || week > 53) continue;
    const quarter = quarterRaw && /^Q[1-4]$/.test(quarterRaw) ? quarterRaw : quarterFromWeek(week);
    const sourceKey = `${year}:build-plan:${week}`;
    if (seen.has(sourceKey)) throw new Error(`Duplicate REM Build Plan week: ${week}`);
    seen.add(sourceKey);
    const data: Record<string, unknown> = {
      sourceKey,
      year,
      quarter,
      weekNumber: week,
      weekStart: toIsoDate(row[col("C")]),
      delivery: {
        analyzer3600: n(row, "D", `${sourceKey} delivery 3600`, 10_000),
        analyzer5600: n(row, "E", `${sourceKey} delivery 5600`, 10_000),
        analyzer7600: n(row, "F", `${sourceKey} delivery 7600`, 10_000),
        vision: n(row, "G", `${sourceKey} delivery VISION`, 10_000),
        electrometer: n(row, "H", `${sourceKey} delivery electrometer`, 10_000),
        irWash: n(row, "I", `${sourceKey} delivery IR`, 10_000),
        total: n(row, "J", `${sourceKey} delivery total`, 50_000),
      },
      capacity: {
        meets: n(row, "K", `${sourceKey} meets`, 100_000),
        exceeds: n(row, "L", `${sourceKey} exceeds`, 100_000),
        capacity: n(row, "M", `${sourceKey} capacity`, 100_000),
        delta: signed(row, "N"),
        headCount: n(row, "O", `${sourceKey} headcount`, 1_000),
        onboarding: n(row, "P", `${sourceKey} onboarding`, 1_000),
        inTraining: n(row, "Q", `${sourceKey} in-training`, 1_000),
        holidays: n(row, "R", `${sourceKey} holidays`, 1_000),
        ptoDays: n(row, "S", `${sourceKey} PTO`, 10_000),
      },
      actuals: {
        analyzer3600: n(row, "U", `${sourceKey} actual 3600`, 10_000),
        analyzer5600: n(row, "V", `${sourceKey} actual 5600`, 10_000),
        analyzer7600: n(row, "W", `${sourceKey} actual 7600`, 10_000),
        vitrosVsPlan: signed(row, "X"),
        vitrosQuarterDelta: signed(row, "Y"),
        vitrosWipMonday: n(row, "Z", `${sourceKey} VITROS WIP`, 100_000),
        clean: n(row, "AA", `${sourceKey} clean`, 100_000),
        service: n(row, "AB", `${sourceKey} service`, 100_000),
        finalLine: n(row, "AC", `${sourceKey} final`, 100_000),
        release: n(row, "AD", `${sourceKey} release`, 100_000),
        pack: n(row, "AE", `${sourceKey} pack`, 100_000),
        qc: n(row, "AF", `${sourceKey} QC`, 100_000),
        finishedGoods: n(row, "AG", `${sourceKey} FG`, 100_000),
        vision: n(row, "AI", `${sourceKey} VISION`, 10_000),
        visionVsPlan: signed(row, "AJ"),
        visionQuarterDelta: signed(row, "AK"),
        visionService: n(row, "AL", `${sourceKey} VISION service`, 100_000),
        visionFinalLine: n(row, "AM", `${sourceKey} VISION final`, 100_000),
        visionPack: n(row, "AN", `${sourceKey} VISION pack`, 100_000),
        visionFinishedGoods: n(row, "AO", `${sourceKey} VISION FG`, 100_000),
        electrometer: n(row, "AQ", `${sourceKey} electrometer`, 10_000),
        electrometerVsPlan: signed(row, "AR"),
        electrometerQuarterDelta: signed(row, "AS"),
        electrometerVsForecast: signed(row, "AT"),
        irWash: n(row, "AU", `${sourceKey} IR`, 10_000),
        irVsPlan: signed(row, "AV"),
        irQuarterDelta: signed(row, "AW"),
        irVsForecast: signed(row, "AX"),
        electrometerWip: n(row, "AY", `${sourceKey} electrometer WIP`, 100_000),
        irWip: n(row, "AZ", `${sourceKey} IR WIP`, 100_000),
        lvccFinishedGoods: n(row, "BA", `${sourceKey} LVCC FG`, 100_000),
      },
      planningHours: {
        analyzer3600: n(row, "BF", `${sourceKey} planning 3600`, 1_000),
        analyzer5600: n(row, "BG", `${sourceKey} planning 5600`, 1_000),
        analyzer7600: n(row, "BH", `${sourceKey} planning 7600`, 1_000),
        vision: n(row, "BI", `${sourceKey} planning VISION`, 1_000),
        lvcc: n(row, "BJ", `${sourceKey} planning LVCC`, 1_000),
      },
    };
    buildPlan.push({ sourceKey, year, quarter, weekNumber: week, weekStart: toIsoDate(row[col("C")]), data });
  }
  if (buildPlan.length < 20) throw new Error("REM Build Plan did not contain enough authoritative weekly rows");
  return buildPlan;
}

function parseStaff(sheet: XLSX.WorkSheet, year: number) {
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

  for (const row of rows.slice(headerIndex + 1)) {
    const wwid = String(row[idx("WWID")] ?? "").trim();
    const name = optionalText(row[idx("Name")], 160);
    if (!wwid || !/^\d{6,12}$/.test(wwid) || !name) continue;
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
    staff.push({
      sourceKey,
      year,
      wwid,
      name,
      role: optionalText(row[idx("Role")], 120),
      started: optionalText(row[idx("Started")], 80) ?? toIsoDate(row[idx("Started")]),
      completeAfter: toIsoDate(row[idx("Complete after")]) ?? optionalText(row[idx("Complete after")], 80),
      fte: nonNegative(row[idx("FTE")], `${sourceKey} FTE`, 5),
      trainingUntil: optionalText(row[idx("Training Unitl")], 80),
      skills,
      certifications,
      comment: optionalText(row[idx("Comment")], 1_000),
    });
  }
  if (staff.length < 5) throw new Error("REM Staff sheet did not contain enough recognized people");
  return staff;
}

function parseWeeklyNotes(sheet: XLSX.WorkSheet, year: number) {
  const rows = matrix(sheet);
  const headerIndex = rows.findIndex((row) => row.some((value) => normalize(value) === "week"));
  if (headerIndex < 0) throw new Error("REM Notes week column was not found");
  const header = rows[headerIndex].map(normalize);
  const weekCol = header.indexOf("week");
  const weeklyNotes: WeeklyNoteImportRow[] = [];
  const seen = new Set<string>();

  for (const row of rows.slice(headerIndex + 1)) {
    const week = numberValue(row[weekCol]);
    if (week === undefined || !Number.isInteger(week) || week < 1 || week > 53) continue;
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
  const recognizedSheets = [trackerSheet, buildPlanSheet, staffSheet, notesSheet, wip.name];
  const fieldStatus = normalizedNames.get("field status vitros");
  if (fieldStatus) recognizedSheets.push(fieldStatus);

  const { analyzers, skippedRows } = parseAnalyzers(workbook.Sheets[wip.name]);
  const { trackerWeekly, targets } = parseTracker(workbook.Sheets[trackerSheet], planYear);
  const buildPlan = parseBuildPlan(workbook.Sheets[buildPlanSheet], planYear);
  const staff = parseStaff(workbook.Sheets[staffSheet], planYear);
  const weeklyNotes = parseWeeklyNotes(workbook.Sheets[notesSheet], planYear);

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
  };
}
