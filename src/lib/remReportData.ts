import type { REMAnalyzer, LVCCItem } from "../hooks/useConvexData";
import type { RemTrackerPlanningRow, RemBuildPlanRow, RemTargetPlanningRow } from "../hooks/useRemPlanningData";
import type { PeriodRange } from "./periodHelper";
import { parseReportingDate, isInPeriod, getISOWeek } from "./periodHelper";

export interface RemReportSnapshot {
  total: number;
  active: number;
  completed: number;
}

export interface RemPeriodActivity {
  analyzers: REMAnalyzer[];
  lvccItems: LVCCItem[];
  analyzerUnknownDates: number;
  lvccUnknownDates: number;
}

export interface RemPlanningPeriodResult {
  trackerRows: RemTrackerPlanningRow[];
  buildPlanRows: RemBuildPlanRow[];
  targets: RemTargetPlanningRow[];
}

export interface RemReportResult {
  snapshot: RemReportSnapshot;
  periodActivity: RemPeriodActivity;
  planningPeriod: RemPlanningPeriodResult;
  period: PeriodRange;
}

function getAnalyzerTimestamp(analyzer: REMAnalyzer): number | null {
  if (analyzer.startDate) {
    return parseReportingDate(analyzer.startDate);
  }
  return null;
}

function getLvccTimestamp(item: LVCCItem): number | null {
  if (item.endDate) {
    return parseReportingDate(item.endDate);
  }
  if (item.startDate) {
    return parseReportingDate(item.startDate);
  }
  return null;
}

function getWeekYearForMonthly(weekNumber: number, year: number): { month: number; year: number } {
  const jan4 = new Date(year, 0, 4);
  const startOfJan4Week = new Date(jan4);
  startOfJan4Week.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const thursdayOfTargetWeek = new Date(startOfJan4Week);
  thursdayOfTargetWeek.setDate(startOfJan4Week.getDate() + (weekNumber - 1) * 7 + 3);
  return { month: thursdayOfTargetWeek.getMonth(), year: thursdayOfTargetWeek.getFullYear() };
}

function quarterLabelToNumber(quarter: string): number | null {
  const match = /^Q([1-4])$/i.exec(quarter.trim());
  return match ? Number(match[1]) : null;
}

function filterTrackerByPeriod(rows: RemTrackerPlanningRow[], period: PeriodRange): RemTrackerPlanningRow[] {
  return rows.filter((row) => {
    if (!row.year || !row.weekNumber || row.weekNumber < 1 || row.weekNumber > 53) return false;

    switch (period.type) {
      case "weekly": {
        const targetWeek = getISOWeek(period.start);
        return row.year === period.year && row.weekNumber === targetWeek;
      }
      case "monthly": {
        const { month, year } = getWeekYearForMonthly(row.weekNumber, row.year);
        return year === period.year && month === period.start.getMonth();
      }
      case "quarterly": {
        const rowQuarterNum = quarterLabelToNumber(row.quarter);
        if (rowQuarterNum === null) return false;
        const targetQuarter = Math.floor(period.start.getMonth() / 3) + 1;
        return row.year === period.year && rowQuarterNum === targetQuarter;
      }
      case "annual": {
        return row.year === period.year;
      }
      default:
        return false;
    }
  });
}

function filterBuildPlanByPeriod(rows: RemBuildPlanRow[], period: PeriodRange): RemBuildPlanRow[] {
  return rows.filter((row) => {
    if (!row.year || !row.weekNumber || row.weekNumber < 1 || row.weekNumber > 53) return false;

    switch (period.type) {
      case "weekly": {
        const targetWeek = getISOWeek(period.start);
        return row.year === period.year && row.weekNumber === targetWeek;
      }
      case "monthly": {
        const { month, year } = getWeekYearForMonthly(row.weekNumber, row.year);
        return year === period.year && month === period.start.getMonth();
      }
      case "quarterly": {
        const rowQuarterNum = quarterLabelToNumber(row.quarter);
        if (rowQuarterNum === null) return false;
        const targetQuarter = Math.floor(period.start.getMonth() / 3) + 1;
        return row.year === period.year && rowQuarterNum === targetQuarter;
      }
      case "annual": {
        return row.year === period.year;
      }
      default:
        return false;
    }
  });
}

function filterTargetsByPeriod(targets: RemTargetPlanningRow[], period: PeriodRange): RemTargetPlanningRow[] {
  return targets.filter((row) => row.year === period.year);
}

export function computeRemSnapshot(analyzers: REMAnalyzer[]): RemReportSnapshot {
  const total = analyzers.length;
  const completed = analyzers.filter((a) => a.isComplete).length;
  const active = total - completed;
  return { total, active, completed };
}

export function computeRemPeriodActivity(
  analyzers: REMAnalyzer[],
  lvccItems: LVCCItem[],
  period: PeriodRange
): RemPeriodActivity {
  const analyzerUnknownDates = analyzers.filter((a) => getAnalyzerTimestamp(a) === null).length;
  const lvccUnknownDates = lvccItems.filter((i) => getLvccTimestamp(i) === null).length;

  const analyzersInPeriod = analyzers.filter((a) => {
    const ts = getAnalyzerTimestamp(a);
    return ts !== null && isInPeriod(ts, period);
  });

  const lvccInPeriod = lvccItems.filter((i) => {
    const ts = getLvccTimestamp(i);
    return ts !== null && isInPeriod(ts, period);
  });

  return {
    analyzers: analyzersInPeriod,
    lvccItems: lvccInPeriod,
    analyzerUnknownDates,
    lvccUnknownDates,
  };
}

export function computeRemPlanningPeriod(
  trackerWeekly: RemTrackerPlanningRow[],
  buildPlan: RemBuildPlanRow[],
  targets: RemTargetPlanningRow[],
  period: PeriodRange
): RemPlanningPeriodResult {
  return {
    trackerRows: filterTrackerByPeriod(trackerWeekly, period),
    buildPlanRows: filterBuildPlanByPeriod(buildPlan, period),
    targets: filterTargetsByPeriod(targets, period),
  };
}

export function computeRemReport(
  analyzers: REMAnalyzer[],
  lvccItems: LVCCItem[],
  trackerWeekly: RemTrackerPlanningRow[],
  buildPlan: RemBuildPlanRow[],
  targets: RemTargetPlanningRow[],
  period: PeriodRange
): RemReportResult {
  return {
    snapshot: computeRemSnapshot(analyzers),
    periodActivity: computeRemPeriodActivity(analyzers, lvccItems, period),
    planningPeriod: computeRemPlanningPeriod(trackerWeekly, buildPlan, targets, period),
    period,
  };
}

export interface RemExportRow {
  period: string;
  periodStart: string;
  periodEnd: string;
  serialNumber: string;
  analyzerType: string;
  productionOrder: string;
  currentStage: string;
  overallPct: number;
  procurementPct: number;
  cleaningPct: number;
  servicePct: number;
  finalLinePct: number;
  packagingPct: number;
  releaseTestingPct: number;
  qaReleasePct: number;
  sapReleasePct: number;
  daysInStage: number;
  slaDays: number;
  complete: string;
  activityDate: string;
  activityDateSource: string;
}

export interface RemLvccExportRow {
  period: string;
  periodStart: string;
  periodEnd: string;
  serialNumber: string;
  batchNumber: string;
  itemType: string;
  currentStage: string;
  buildPct: number;
  testPct: number;
  packagingPct: number;
  qaReleasePct: number;
  sapReleasePct: number;
  complete: string;
  activityDate: string;
  activityDateSource: string;
}

export interface RemTrackerExportRow {
  period: string;
  year: number;
  product: string;
  quarter: string;
  weekNumber: number;
  weekStart: string;
  plan: number;
  recordedActual: string;
  missingActuals: string;
  weeklyForecast: string;
  accumulatedForecast: string;
  allocationMethod: string;
}

export interface RemBuildPlanExportRow {
  period: string;
  year: number;
  quarter: string;
  weekNumber: number;
  weekStart: string;
  delivery3600: string;
  delivery5600: string;
  delivery7600: string;
  deliveryVision: string;
  deliveryElectrometer: string;
  deliveryIrWash: string;
  deliveryTotal: string;
  capacityTotal: string;
  headCount: string;
  actualsVitrosVsPlan: string;
  allocationMethod: string;
}

export interface RemExportMetadata {
  generatedAt: string;
  generatedBy: string;
  periodType: string;
  periodLabel: string;
  periodStartLocal: string;
  periodEndLocal: string;
  timezone: string;
  totalAnalyzers: number;
  analyzersInPeriod: number;
  analyzersUnknownDate: number;
  totalLvcc: number;
  lvccInPeriod: number;
  lvccUnknownDate: number;
  trackerUniqueWeeksInPeriod: number;
  trackerMissingActuals: number;
  buildPlanWeeksInPeriod: number;
  allocationNote: string;
}

function formatLocalDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str) || str.startsWith("=") || str.startsWith("+") || str.startsWith("-") || str.startsWith("@")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function neutralizeFormula(value: string): string {
  if (!value) return value;
  if (value.startsWith("=") || value.startsWith("+") || value.startsWith("-") || value.startsWith("@")) {
    return `'${value}`;
  }
  return value;
}

function displayActualOrMissing(value: number | undefined): { display: string; missing: boolean } {
  if (value === undefined || value === null) return { display: "", missing: true };
  return { display: String(value), missing: false };
}

function displayNumber(value: number | undefined): string {
  if (value === undefined || value === null) return "";
  if (value === 0) return "0";
  return String(value);
}

export function buildAnalyzerExportRows(
  analyzers: REMAnalyzer[],
  period: PeriodRange,
  getTimestamp: (a: REMAnalyzer) => number | null
): RemExportRow[] {
  return analyzers.map((analyzer) => {
    const ts = getTimestamp(analyzer);
    const activityDate = ts !== null ? new Date(ts) : null;
    return {
      period: period.label,
      periodStart: formatLocalDate(period.start),
      periodEnd: formatLocalDate(period.end),
      serialNumber: analyzer.serialNumber,
      analyzerType: analyzer.analyzerType,
      productionOrder: analyzer.productionOrder?.toString() ?? "",
      currentStage: analyzer.currentStage,
      overallPct: analyzer.overallPct,
      procurementPct: analyzer.procurementPct,
      cleaningPct: analyzer.cleaningPct,
      servicePct: analyzer.servicePct,
      finalLinePct: analyzer.finalLinePct,
      packagingPct: analyzer.packagingPct,
      releaseTestingPct: analyzer.releaseTestingPct,
      qaReleasePct: analyzer.qaReleasePct,
      sapReleasePct: analyzer.sapReleasePct,
      daysInStage: analyzer.daysInStage,
      slaDays: analyzer.slaDays,
      complete: analyzer.isComplete ? "Yes" : "No",
      activityDate: activityDate ? formatLocalDate(activityDate) : "Unknown",
      activityDateSource: analyzer.startDate ? "startDate" : "Unknown",
    };
  });
}

export function buildLvccExportRows(
  lvccItems: LVCCItem[],
  period: PeriodRange,
  getTimestamp: (i: LVCCItem) => number | null
): RemLvccExportRow[] {
  return lvccItems.map((item) => {
    const ts = getTimestamp(item);
    const activityDate = ts !== null ? new Date(ts) : null;
    const source = item.endDate ? "endDate" : item.startDate ? "startDate" : "Unknown";
    return {
      period: period.label,
      periodStart: formatLocalDate(period.start),
      periodEnd: formatLocalDate(period.end),
      serialNumber: item.serialNumber,
      batchNumber: item.batchNumber ?? "",
      itemType: item.itemType ?? "",
      currentStage: item.currentStage ?? "",
      buildPct: item.buildPct,
      testPct: item.testPct,
      packagingPct: item.packagingPct,
      qaReleasePct: item.qaReleasePct,
      sapReleasePct: item.sapReleasePct,
      complete: item.isComplete ? "Yes" : "No",
      activityDate: activityDate ? formatLocalDate(activityDate) : "Unknown",
      activityDateSource: source,
    };
  });
}

function getAllocationLabel(periodType: string): string {
  switch (periodType) {
    case "monthly":
      return "Whole-week allocation by Thursday month";
    case "quarterly":
      return "Matches source row quarter (Q1-Q4) and source year";
    case "annual":
      return "Matches source row year";
    case "weekly":
      return "Exact ISO week and year match";
    default:
      return "";
  }
}

export function buildTrackerExportRows(
  rows: RemTrackerPlanningRow[],
  period: PeriodRange
): RemTrackerExportRow[] {
  const label = getAllocationLabel(period.type);
  return rows.map((row) => {
    const { display: actualDisp, missing } = displayActualOrMissing(row.actual);
    return {
      period: period.label,
      year: row.year,
      product: row.product,
      quarter: row.quarter,
      weekNumber: row.weekNumber,
      weekStart: row.weekStart ?? "",
      plan: row.plan,
      recordedActual: actualDisp,
      missingActuals: missing ? "yes" : "no",
      weeklyForecast: displayNumber(row.weeklyForecast),
      accumulatedForecast: displayNumber(row.accumulatedForecast),
      allocationMethod: label,
    };
  });
}

export function buildBuildPlanExportRows(
  rows: RemBuildPlanRow[],
  period: PeriodRange
): RemBuildPlanExportRow[] {
  const label = getAllocationLabel(period.type);
  return rows.map((row) => ({
    period: period.label,
    year: row.year,
    quarter: row.quarter,
    weekNumber: row.weekNumber,
    weekStart: row.weekStart ?? "",
    delivery3600: displayNumber(row.delivery.analyzer3600),
    delivery5600: displayNumber(row.delivery.analyzer5600),
    delivery7600: displayNumber(row.delivery.analyzer7600),
    deliveryVision: displayNumber(row.delivery.vision),
    deliveryElectrometer: displayNumber(row.delivery.electrometer),
    deliveryIrWash: displayNumber(row.delivery.irWash),
    deliveryTotal: displayNumber(row.delivery.total),
    capacityTotal: displayNumber(row.capacity.capacity),
    headCount: displayNumber(row.capacity.headCount),
    actualsVitrosVsPlan: displayNumber(row.actuals.vitrosVsPlan),
    allocationMethod: label,
  }));
}

export function buildExportMetadata(
  period: PeriodRange,
  snapshot: RemReportSnapshot,
  periodActivity: RemPeriodActivity,
  planningPeriod: RemPlanningPeriodResult,
  allLvccCount: number
): RemExportMetadata {
  const missingActuals = planningPeriod.trackerRows.filter(
    (r) => r.actual === undefined || r.actual === null
  ).length;
  const uniqueWeeks = new Set(
    planningPeriod.trackerRows.map((r) => `${r.year}-W${r.weekNumber}`)
  ).size;

  return {
    generatedAt: new Date().toISOString(),
    generatedBy: "VITROS REM Reports",
    periodType: period.type,
    periodLabel: period.label,
    periodStartLocal: formatLocalDate(period.start),
    periodEndLocal: formatLocalDate(period.end),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    totalAnalyzers: snapshot.total,
    analyzersInPeriod: periodActivity.analyzers.length,
    analyzersUnknownDate: periodActivity.analyzerUnknownDates,
    totalLvcc: allLvccCount,
    lvccInPeriod: periodActivity.lvccItems.length,
    lvccUnknownDate: periodActivity.lvccUnknownDates,
    trackerUniqueWeeksInPeriod: uniqueWeeks,
    trackerMissingActuals: missingActuals,
    buildPlanWeeksInPeriod: planningPeriod.buildPlanRows.length,
    allocationNote: getAllocationLabel(period.type),
  };
}

function csvGenerate<T extends object>(rows: T[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const csvRows = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const raw = (row as Record<string, unknown>)[h];
          if (typeof raw === "string") {
            return escapeCsvValue(neutralizeFormula(raw));
          }
          return escapeCsvValue(raw);
        })
        .join(",")
    ),
  ];
  return csvRows.join("\n");
}

export function generateAnalyzerCsv(rows: RemExportRow[]): string {
  return csvGenerate(rows);
}

export function generateLvccCsv(rows: RemLvccExportRow[]): string {
  return csvGenerate(rows);
}

export function generateTrackerCsv(rows: RemTrackerExportRow[]): string {
  return csvGenerate(rows);
}

export function generateBuildPlanCsv(rows: RemBuildPlanExportRow[]): string {
  return csvGenerate(rows);
}

export function generateMetadataCsv(metadata: RemExportMetadata): string {
  const entries = Object.entries(metadata);
  const csvRows = [
    "Property,Value",
    ...entries.map(([key, value]) => `${escapeCsvValue(key)},${escapeCsvValue(value)}`),
  ];
  return csvRows.join("\n");
}