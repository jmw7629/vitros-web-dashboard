import { useRemInspection, RemInfoCard } from "../../components/vitros/RemDataDialog";
import { saveAs } from "file-saver";
import { useState, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import { WebCard, DashCard, ProgressBar, theme } from "../../components/vitros/SharedComponents";
import { useRemCoreData } from "../../hooks/useRemCoreData";
import { useRemPlanningData } from "../../hooks/useRemPlanningData";
import { RemOperationalRecords } from "../../components/vitros/RemOperationalRecords";
import type { RemOperationalDataset } from "../../hooks/useRemOperationalData";
import { ChevronLeft, ChevronRight, Download, Calendar, FileText, AlertCircle, Info, TrendingUp, BarChart3, Loader2 } from "lucide-react";
import type { PeriodType, PeriodRange } from "../../lib/periodHelper";
import {
  createPeriodRange,
  getPreviousPeriod,
  getNextPeriod,
  formatPeriodRange,
  PERIOD_TYPES,
} from "../../lib/periodHelper";
import {
  computeRemReport,
  buildAnalyzerExportRows,
  buildLvccExportRows,
  buildTrackerExportRows,
  buildBuildPlanExportRows,
  buildExportMetadata,
  generateAnalyzerCsv,
  generateLvccCsv,
  generateTrackerCsv,
  generateBuildPlanCsv,
  generateMetadataCsv,
  type RemReportResult,
} from "../../lib/remReportData";
import type { REMAnalyzer, LVCCItem } from "../../hooks/useConvexData";

const DATASETS: Array<[RemOperationalDataset, string]> = [
  ["field_status", "Field Status"],
  ["lvcc_reviews", "LVCC DHR Reviews"],
  ["install_parts", "Install Parts"],
  ["certified_parts", "Certified Parts"],
  ["summary_targets", "Summary Targets"],
];

function neutralizeFormula(value: string): string {
  if (!value) return value;
  if (value.startsWith("=") || value.startsWith("+") || value.startsWith("-") || value.startsWith("@")) {
    return `'${value}`;
  }
  return value;
}

export function RemReports() {
  const data = useRemCoreData();
  const planning = useRemPlanningData();
  const [dataset, setDataset] = useState<RemOperationalDataset>("field_status");
  const [periodType, setPeriodType] = useState<PeriodType>("monthly");
  const [referenceDate, setReferenceDate] = useState<Date>(new Date());

  const currentPeriod = useMemo(() => createPeriodRange(periodType, referenceDate), [periodType, referenceDate]);

  const goToPrevious = useCallback(() => {
    setReferenceDate((d) => new Date(getPreviousPeriod(createPeriodRange(periodType, d)).start));
  }, [periodType]);

  const goToNext = useCallback(() => {
    setReferenceDate((d) => new Date(getNextPeriod(createPeriodRange(periodType, d)).start));
  }, [periodType]);

  const goToToday = useCallback(() => {
    setReferenceDate(new Date());
  }, []);

  const isLoading = data.isLoading || planning.isLoading;
  const hasError = !!data.error || !!planning.error;
  const errorMessages = [data.error, planning.error].filter(Boolean).join("; ");

  const report = useMemo((): RemReportResult | null => {
    if (hasError || isLoading || !data.analyzers) return null;
    return computeRemReport(
      data.analyzers,
      data.lvccItems,
      planning.trackerWeekly,
      planning.buildPlan,
      planning.targets,
      currentPeriod
    );
  }, [data.analyzers, data.lvccItems, data.error, data.isLoading, planning.trackerWeekly, planning.buildPlan, planning.targets, planning.isLoading, planning.error, currentPeriod, hasError, isLoading]);

  const snapshot = report?.snapshot ?? { total: 0, active: 0, completed: 0 };
  const periodActivity = report?.periodActivity ?? { analyzers: [], lvccItems: [], analyzerUnknownDates: 0, lvccUnknownDates: 0 };
  const planningPeriod = report?.planningPeriod ?? { trackerRows: [], buildPlanRows: [], targets: [] };

  const total = snapshot.total;
  const completed = snapshot.completed;
  const active = total - completed;

  const trackerPlanTotal = useMemo(() => {
    return planningPeriod.trackerRows.reduce((sum, r) => sum + r.plan, 0);
  }, [planningPeriod.trackerRows]);

  const recordedActualCount = useMemo(() => {
    return planningPeriod.trackerRows.filter((r) => r.actual !== undefined && r.actual !== null).length;
  }, [planningPeriod.trackerRows]);

  const missingActualCount = useMemo(() => {
    return planningPeriod.trackerRows.filter((r) => r.actual === undefined || r.actual === null).length;
  }, [planningPeriod.trackerRows]);

  const recordedActualSum = useMemo(() => {
    return planningPeriod.trackerRows
      .filter((r) => r.actual !== undefined && r.actual !== null)
      .reduce((sum, r) => sum + (r.actual ?? 0), 0);
  }, [planningPeriod.trackerRows]);

  const getAnalyzerTimestamp = useCallback((a: REMAnalyzer): number | null => {
    if (a.startDate) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a.startDate);
      if (match) {
        const [year, month, day] = match.slice(1).map(Number);
        const d = new Date(year, month - 1, day);
        return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d.getTime() : null;
      }
      if (/^\d{4}-\d{2}-\d{2}T/.test(a.startDate)) {
        const time = Date.parse(a.startDate);
        return Number.isFinite(time) ? time : null;
      }
    }
    return null;
  }, []);

  const getLvccTimestamp = useCallback((i: LVCCItem): number | null => {
    const dateStr = i.endDate ?? i.startDate;
    if (dateStr) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
      if (match) {
        const [year, month, day] = match.slice(1).map(Number);
        const d = new Date(year, month - 1, day);
        return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d.getTime() : null;
      }
      if (/^\d{4}-\d{2}-\d{2}T/.test(dateStr)) {
        const time = Date.parse(dateStr);
        return Number.isFinite(time) ? time : null;
      }
    }
    return null;
  }, []);

  const allLvccCount = data.lvccItems?.length ?? 0;

  const exportReport = useCallback(() => {
    if (!report || hasError || isLoading) return;
    const workbook = XLSX.utils.book_new();

    const analyzerSheetData = buildAnalyzerExportRows(periodActivity.analyzers, currentPeriod, getAnalyzerTimestamp).map((row) => {
      const out: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(row)) {
        out[key] = typeof value === "string" ? neutralizeFormula(value) : value;
      }
      return out;
    });

    const lvccSheetData = buildLvccExportRows(periodActivity.lvccItems, currentPeriod, getLvccTimestamp).map((row) => {
      const out: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(row)) {
        out[key] = typeof value === "string" ? neutralizeFormula(value) : value;
      }
      return out;
    });

    const trackerSheetData = buildTrackerExportRows(planningPeriod.trackerRows, currentPeriod).map((row) => {
      const out: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(row)) {
        out[key] = typeof value === "string" ? neutralizeFormula(value) : value;
      }
      return out;
    });

    const buildPlanSheetData = buildBuildPlanExportRows(planningPeriod.buildPlanRows, currentPeriod).map((row) => {
      const out: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(row)) {
        out[key] = typeof value === "string" ? neutralizeFormula(value) : value;
      }
      return out;
    });

    const metadata = buildExportMetadata(currentPeriod, snapshot, periodActivity, planningPeriod, allLvccCount);
    const metadataSheetData = Object.entries(metadata).map(([key, value]) => ({ Property: key, Value: value }));

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analyzerSheetData), "REM Analyzers");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(lvccSheetData), "LVCC");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(trackerSheetData), "Tracker Weekly");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(buildPlanSheetData), "Build Plan");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(metadataSheetData), "Export Context");

    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    saveAs(
      new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `REM_Report_${currentPeriod.type}_${currentPeriod.year}_${currentPeriod.periodIndex}.xlsx`,
    );
  }, [report, hasError, isLoading, currentPeriod, periodActivity, snapshot, planningPeriod, getAnalyzerTimestamp, getLvccTimestamp, allLvccCount]);

  const exportCSV = useCallback(() => {
    if (!report || hasError || isLoading) return;

    const analyzerRows = buildAnalyzerExportRows(periodActivity.analyzers, currentPeriod, getAnalyzerTimestamp);
    const lvccRows = buildLvccExportRows(periodActivity.lvccItems, currentPeriod, getLvccTimestamp);
    const trackerRows = buildTrackerExportRows(planningPeriod.trackerRows, currentPeriod);
    const buildPlanRows = buildBuildPlanExportRows(planningPeriod.buildPlanRows, currentPeriod);
    const metadata = buildExportMetadata(currentPeriod, snapshot, periodActivity, planningPeriod, allLvccCount);

    const combinedCsv = [
      "=== REM Analyzers ===",
      generateAnalyzerCsv(analyzerRows),
      "",
      "=== LVCC Items ===",
      generateLvccCsv(lvccRows),
      "",
      "=== Tracker Weekly (Plan vs Recorded Actual) ===",
      generateTrackerCsv(trackerRows),
      "",
      "=== Build Plan ===",
      generateBuildPlanCsv(buildPlanRows),
      "",
      "=== Export Context ===",
      generateMetadataCsv(metadata),
    ].join("\n");

    const blob = new Blob([combinedCsv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `REM_Report_${currentPeriod.type}_${currentPeriod.year}_${currentPeriod.periodIndex}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report, hasError, isLoading, currentPeriod, periodActivity, snapshot, planningPeriod, getAnalyzerTimestamp, getLvccTimestamp, allLvccCount]);

  const allocationNote = useMemo(() => {
    switch (currentPeriod.type) {
      case "monthly":
        return "Monthly: whole-week allocation by Thursday month. Do not sum accumulated forecast across weeks.";
      case "quarterly":
        return "Quarterly: matches source row quarter (Q1-Q4) and source year. Not computed from week number.";
      case "annual":
        return "Annual: matches source row year.";
      case "weekly":
        return "Weekly: exact ISO week and year match.";
      default:
        return "";
    }
  }, [currentPeriod.type]);

  const { inspect, dialog } = useRemInspection();

  return (
    <div className="space-y-4">
      {/* Header with period selector */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="h-6 w-6 text-purple-600" />
            <h2 className="text-2xl font-bold" style={{ color: theme.textPrimary }}>REM Reports</h2>
          </div>
          <p className="text-sm" style={{ color: theme.textSecondary }}>
            {currentPeriod.label} — {formatPeriodRange(currentPeriod)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <label htmlFor="rem-period-type" className="text-sm font-medium" style={{ color: theme.textPrimary }}>Period:</label>
            <select
              id="rem-period-type"
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value as PeriodType)}
              className="rounded-lg border px-3 py-2 text-sm"
              style={{ backgroundColor: theme.cardBg, color: theme.textPrimary, borderColor: theme.cardBorder }}
            >
              {PERIOD_TYPES.map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={goToPrevious} className="p-2 rounded-lg border text-sm" title="Previous period"
              style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg, color: theme.textPrimary }}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={goToNext} className="p-2 rounded-lg border text-sm" title="Next period"
              style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg, color: theme.textPrimary }}>
              <ChevronRight className="h-4 w-4" />
            </button>
            <button onClick={goToToday} className="px-3 py-2 rounded-lg border text-xs font-medium" title="Current period"
              style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg, color: theme.textPrimary }}>
              This Period
            </button>
          </div>
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg, color: theme.textSecondary }}
            disabled={isLoading || hasError || !report}>
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button onClick={exportReport} disabled={isLoading || hasError || !report}
            className="px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: "#6366f1" }}>
            Export XLSX
          </button>
        </div>
      </div>

      <WebCard className="p-3 border-l-4" style={{ borderColor: "#8b5cf6", backgroundColor: theme.cardBg }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" style={{ color: "#8b5cf6" }} />
            <span className="text-sm font-medium" style={{ color: theme.textPrimary }}>
              {currentPeriod.type.charAt(0).toUpperCase() + currentPeriod.type.slice(1)} Report
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300">
              {currentPeriod.label}
            </span>
          </div>
          <div className="text-xs" style={{ color: theme.textMuted }}>
            {formatPeriodRange(currentPeriod)}
          </div>
        </div>
      </WebCard>

      {isLoading && (
        <WebCard className="p-4">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: theme.textSecondary }} />
            <span className="text-sm" style={{ color: theme.textSecondary }}>Loading REM report data...</span>
          </div>
        </WebCard>
      )}

      {hasError && !isLoading && (
        <WebCard className="p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0" style={{ color: theme.statusOut }} />
            <div>
              <div className="text-sm font-bold" style={{ color: theme.statusOut }}>REM report data unavailable</div>
              <div className="mt-1 text-xs" style={{ color: theme.textSecondary }}>
                {errorMessages}. Export is disabled rather than substituting legacy data.
              </div>
              <div className="mt-2 flex gap-2">
                {data.error && (
                  <button type="button" onClick={() => void data.refresh()} className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>
                    Retry Core Data
                  </button>
                )}
                {planning.error && (
                  <button type="button" onClick={() => void planning.refresh()} className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>
                    Retry Planning Data
                  </button>
                )}
              </div>
            </div>
          </div>
        </WebCard>
      )}

      {!isLoading && !hasError && report && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <DashCard onClick={() => inspect("TOTAL (Current Snapshot)", data.analyzers)} label="TOTAL (Current Snapshot)" value={total} icon="🔬" color="#6366f1" />
            <DashCard onClick={() => inspect("ACTIVE (Current Snapshot)", data.analyzers.filter(a => !a.isComplete))} label="ACTIVE (Current Snapshot)" value={active} icon="🔧" color="#f59e0b" />
            <DashCard onClick={() => inspect("COMPLETED (Current Snapshot)", data.analyzers.filter(a => a.isComplete))} label="COMPLETED (Current Snapshot)" value={completed} icon="✅" color={theme.statusOk} />
            <DashCard onClick={() => inspect("LVCC IN PERIOD", periodActivity.lvccItems)} label="LVCC IN PERIOD" value={periodActivity.lvccItems.length} icon="📋" color="#8b5cf6" />
          </div>

          <RemInfoCard title="Period date coverage" data={{analyzers:data.analyzers,lvcc:data.lvccItems}} className="p-4 border-l-4" style={{ borderColor: theme.accentBlue, backgroundColor: theme.cardBg }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4" style={{ color: theme.accentBlue }} />
                <span className="text-sm" style={{ color: theme.textPrimary }}>
                  Analyzer/LVCC period counts use authoritative dates (startDate, endDate). Items with unknown dates excluded from period counts.
                </span>
              </div>
              <div className="text-xs" style={{ color: theme.textMuted }}>
                Analyzers unknown date: {periodActivity.analyzerUnknownDates} | LVCC unknown date: {periodActivity.lvccUnknownDates} | LVCC total: {allLvccCount}
              </div>
            </div>
          </RemInfoCard>

          <RemInfoCard title="Completion rate" data={data.analyzers} className="p-4">
            <h3 className="text-sm font-bold mb-2" style={{ color: theme.textPrimary }}>Completion Rate (Current Snapshot)</h3>
            <ProgressBar value={completed} maxValue={total || 1} color={theme.statusOk} height={10} />
            <div className="text-xs mt-1 text-right" style={{ color: theme.textMuted }}>{total ? Math.round((completed / total) * 100) : 0}%</div>
          </RemInfoCard>

          {/* Planning Data - Tracker Plan vs Recorded Actual */}
          <RemInfoCard title="Tracker plan and actual" data={planningPeriod.trackerRows} className="p-4 border-l-4" style={{ borderColor: "#3b82f6", backgroundColor: theme.cardBg }}>
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4" style={{ color: "#3b82f6" }} />
              <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>
                Tracker Plan vs Recorded Actual — {currentPeriod.label}
              </h3>
            </div>
            {planningPeriod.trackerRows.length > 0 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <DashCard onClick={() => inspect("PLAN TOTAL", planningPeriod.trackerRows)} label="PLAN TOTAL" value={trackerPlanTotal} icon="📊" color="#3b82f6" />
                  <DashCard onClick={() => inspect("RECORDED ACTUAL (partial)", planningPeriod.trackerRows.filter(r => r.actual !== undefined))} label="RECORDED ACTUAL (partial)" value={recordedActualSum} icon="📈" color={theme.statusOk} />
                  <DashCard onClick={() => inspect("Missing actuals", planningPeriod.trackerRows.filter(r => r.actual === undefined))} label={`MISSING ACTUALS: ${missingActualCount} of ${planningPeriod.trackerRows.length}`} value={`${recordedActualCount} recorded`} icon="⚠️" color="#f59e0b" />
                </div>
                <div className="max-h-[16rem] overflow-auto" role="region" aria-label="Tracker weekly rows" tabIndex={0}>
                  <table className="w-full min-w-[600px] border-collapse text-left">
                    <thead className="sticky top-0 z-10" style={{ backgroundColor: theme.cardBg }}>
                      <tr>
                        <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: theme.textSecondary }}>Product</th>
                        <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: theme.textSecondary }}>Week</th>
                        <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: theme.textSecondary }}>Quarter</th>
                        <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-right" style={{ color: theme.textSecondary }}>Plan</th>
                        <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-right" style={{ color: theme.textSecondary }}>Recorded Actual</th>
                        <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-right" style={{ color: theme.textSecondary }}>Forecast</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planningPeriod.trackerRows.map((row) => {
                        const hasActual = row.actual !== undefined && row.actual !== null;
                        return (
                          <tr key={row._id} style={{ borderBottom: `1px solid ${theme.cardBorder}` }}>
                            <td className="px-3 py-2 text-xs" style={{ color: theme.textPrimary }}><button className="underline" onClick={() => inspect(row.product, row)}>{row.product}</button></td>
                            <td className="px-3 py-2 text-xs" style={{ color: theme.textSecondary }}><button className="underline" onClick={() => inspect(`Week ${row.weekNumber}`, row)}>W{row.weekNumber}</button></td>
                            <td className="px-3 py-2 text-xs" style={{ color: theme.textSecondary }}>{row.quarter}</td>
                            <td className="px-3 py-2 text-xs text-right font-medium" style={{ color: theme.textPrimary }}>{row.plan}</td>
                            <td className="px-3 py-2 text-xs text-right" style={{ color: hasActual ? theme.textPrimary : theme.textMuted }}>
                              {hasActual ? row.actual : "—"}
                            </td>
                            <td className="px-3 py-2 text-xs text-right" style={{ color: row.weeklyForecast !== undefined ? theme.textPrimary : theme.textMuted }}>
                              {row.weeklyForecast !== undefined && row.weeklyForecast !== null ? row.weeklyForecast : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="text-[11px] italic" style={{ color: theme.textMuted }}>
                  Note: {allocationNote} {missingActualCount > 0 ? `Recorded Actual is a partial sum of ${recordedActualCount} of ${planningPeriod.trackerRows.length} rows with recorded data.` : "All rows have recorded actuals."}
                </div>
              </div>
            ) : (
              <div className="text-xs" style={{ color: theme.textSecondary }}>
                No tracker planning data available for this period.
              </div>
            )}
          </RemInfoCard>

          {/* Build Plan Data */}
          <RemInfoCard title="Build plan" data={planningPeriod.buildPlanRows} className="p-4 border-l-4" style={{ borderColor: "#f59e0b", backgroundColor: theme.cardBg }}>
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4" style={{ color: "#f59e0b" }} />
              <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>
                Build Plan — {currentPeriod.label}
              </h3>
            </div>
            {planningPeriod.buildPlanRows.length > 0 ? (
              <div className="max-h-[16rem] overflow-auto" role="region" aria-label="Build plan rows" tabIndex={0}>
                <table className="w-full min-w-[600px] border-collapse text-left">
                  <thead className="sticky top-0 z-10" style={{ backgroundColor: theme.cardBg }}>
                    <tr>
                      <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: theme.textSecondary }}>Week</th>
                      <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-right" style={{ color: theme.textSecondary }}>3600</th>
                      <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-right" style={{ color: theme.textSecondary }}>5600</th>
                      <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-right" style={{ color: theme.textSecondary }}>7600</th>
                      <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-right" style={{ color: theme.textSecondary }}>Vision</th>
                      <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-right" style={{ color: theme.textSecondary }}>Total</th>
                      <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-right" style={{ color: theme.textSecondary }}>Capacity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planningPeriod.buildPlanRows.map((row) => (
                      <tr key={row._id} style={{ borderBottom: `1px solid ${theme.cardBorder}` }}>
                        <td className="px-3 py-2 text-xs" style={{ color: theme.textSecondary }}><button className="underline" onClick={() => inspect(`Week ${row.weekNumber}`, row)}>W{row.weekNumber}</button></td>
                        <td className="px-3 py-2 text-xs text-right" style={{ color: theme.textPrimary }}>{row.delivery.analyzer3600 ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-right" style={{ color: theme.textPrimary }}>{row.delivery.analyzer5600 ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-right" style={{ color: theme.textPrimary }}>{row.delivery.analyzer7600 ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-right" style={{ color: theme.textPrimary }}>{row.delivery.vision ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-right font-medium" style={{ color: theme.textPrimary }}>{row.delivery.total ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-right" style={{ color: theme.textPrimary }}>{row.capacity.capacity ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs" style={{ color: theme.textSecondary }}>
                No build plan data available for this period.
              </div>
            )}
          </RemInfoCard>
        </>
      )}

      {/* Source browser section - explicitly independent of report period */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="rem-report-dataset" className="text-sm font-bold" style={{ color: theme.textPrimary }}>Workbook records</label>
          <select id="rem-report-dataset" value={dataset} onChange={(event) => {
            const match = DATASETS.find(([value]) => value === event.target.value);
            if (match) setDataset(match[0]);
          }} className="rounded-lg border px-3 py-2 text-sm" style={{ backgroundColor: theme.cardBg, color: theme.textPrimary, borderColor: theme.cardBorder }}>
            {DATASETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <span className="text-[11px] italic px-2 py-1 rounded" style={{ color: theme.textMuted, backgroundColor: theme.inputBg }}>
            Source browser (independent of report period)
          </span>
        </div>
        <RemOperationalRecords key={dataset} dataset={dataset} title={DATASETS.find(([value]) => value === dataset)?.[1] ?? "Workbook Records"} />
      </div>
      {dialog}
    </div>
  );
}