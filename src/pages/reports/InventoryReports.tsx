import { useState, useMemo, useCallback } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { useInventoryReport } from "../../hooks/useInventoryReport";
import { WebCard, theme, statusColor } from "../../components/vitros/SharedComponents";
import { ChevronLeft, ChevronRight, Download, Calendar, FileText, Printer } from "lucide-react";
import type { PeriodType } from "../../lib/periodHelper";
import {
  createPeriodRange,
  getPreviousPeriod,
  getNextPeriod,
  formatPeriodRange,
  getConfiguredTimezone,
  PERIOD_TYPES,
} from "../../lib/periodHelper";

const fmt = (n: number) => n.toLocaleString();

export function InventoryReports() {
  const data = useConvexData();
  const [periodType, setPeriodType] = useState<PeriodType>("monthly");
  const [referenceDate, setReferenceDate] = useState<Date>(new Date());

  const currentPeriod = useMemo(() => createPeriodRange(periodType, referenceDate), [periodType, referenceDate]);
  const report = useInventoryReport(currentPeriod);

  const goToPrevious = useCallback(() => {
    setReferenceDate(d => new Date(getPreviousPeriod(createPeriodRange(periodType, d)).start));
  }, [periodType]);

  const goToNext = useCallback(() => {
    setReferenceDate(d => new Date(getNextPeriod(createPeriodRange(periodType, d)).start));
  }, [periodType]);

  const goToToday = useCallback(() => {
    setReferenceDate(new Date());
  }, [periodType]);

  const parts = data.parts;
  const partsInPeriod = useMemo(() => parts, [parts]);
  const txnsInPeriod = report.items;

  const totalParts = partsInPeriod.length;
  const totalUnits = partsInPeriod.reduce((s, p) => s + p.qoh, 0);
  const healthy = partsInPeriod.filter(p => p.status === "OK");
  const lowStock = partsInPeriod.filter(p => p.status === "LOW");
  const stockouts = partsInPeriod.filter(p => p.status === "OUT");
  const overstocked = partsInPeriod.filter(p => p.status === "OVER");
  const requiredStockouts = stockouts.filter(p => p.type === "Required");
  const healthPct = totalParts > 0 ? Math.round((healthy.length / totalParts) * 100) : 0;

  const txnsByMode = useMemo(() => {
    const modes = ["IN", "OUT", "RECEIVE", "ADJUST"];
    const result: Record<string, number> = {};
    for (const mode of modes) {
      result[mode] = txnsInPeriod.filter(t => t.mode === mode).length;
    }
    return result;
  }, [txnsInPeriod]);

  const needReorder = partsInPeriod.filter(p => p.qoh < p.minQty);
  const totalReorderUnits = needReorder.reduce((s, p) => s + Math.max(0, p.maxQty - p.qoh), 0);

  const topMovingParts = useMemo(() => {
    const partMovement: Record<string, { in: number; out: number; partNumber: string; description: string }> = Object.create(null);
    for (const t of txnsInPeriod) {
      if (!partMovement[t.partNumber]) {
        partMovement[t.partNumber] = { in: 0, out: 0, partNumber: t.partNumber, description: t.description || "" };
      }
      if (t.mode === "IN" || t.mode === "RECEIVE") partMovement[t.partNumber].in += t.qty;
      if (t.mode === "OUT") partMovement[t.partNumber].out += t.qty;
    }
    return Object.values(partMovement)
      .map(p => ({ ...p, total: p.in + p.out }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [txnsInPeriod]);

  const handlePrint = () => { setTimeout(() => window.print(), 200); };

  const exportToCSV = () => {
    if (report.isLoading || report.error || data.isLoading || data.error) return;
    const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const headers = [
      "Period", "Start Date", "End Date", "Timezone", "Activity Loaded At", "Stock Basis", "Current Total Parts", "Current Total Units", "Current Health %",
      "Current Healthy", "Current Low Stock", "Current Stock-Outs", "Current Overstocked", "Current Required Stock-Outs",
      "IN Transactions", "OUT Transactions", "RECEIVE Transactions", "ADJUST Transactions",
      "Parts Below Reorder", "Total Reorder Units"
    ];
    const row = [
      currentPeriod.label,
      localDay(currentPeriod.start),
      localDay(currentPeriod.end),
      getConfiguredTimezone(),
      report.loadedAt ? new Date(report.loadedAt).toISOString() : "",
      "Current stock snapshot; activity is filtered to the selected period",
      totalParts,
      totalUnits,
      healthPct,
      healthy.length,
      lowStock.length,
      stockouts.length,
      overstocked.length,
      requiredStockouts.length,
      txnsByMode.IN || 0,
      txnsByMode.OUT || 0,
      txnsByMode.RECEIVE || 0,
      txnsByMode.ADJUST || 0,
      needReorder.length,
      totalReorderUnits,
    ];
    const csv = [headers, row].map(cells => cells.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `VITROS_Inventory_Report_${currentPeriod.type}_${currentPeriod.year}_${currentPeriod.periodIndex}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Header with period selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="h-6 w-6 text-blue-600" />
            <h2 className="text-2xl font-bold" style={{ color: theme.textPrimary }}>Inventory Reports</h2>
          </div>
          <p className="text-sm" style={{ color: theme.textSecondary }}>
            {currentPeriod.label} — {formatPeriodRange(currentPeriod)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period type selector */}
          <div className="flex items-center gap-2">
            <label htmlFor="period-type" className="text-sm font-medium" style={{ color: theme.textPrimary }}>Period:</label>
            <select
              id="period-type"
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value as PeriodType)}
              className="rounded-lg border px-3 py-2 text-sm"
              style={{ backgroundColor: theme.cardBg, color: theme.textPrimary, borderColor: theme.cardBorder }}
            >
              {PERIOD_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          {/* Navigation */}
          <div className="flex items-center gap-1">
            <button aria-label="Previous period" onClick={goToPrevious} className="p-2 rounded-lg border text-sm"
              style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg, color: theme.textPrimary }}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button aria-label="Next period" onClick={goToNext} className="p-2 rounded-lg border text-sm"
              style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg, color: theme.textPrimary }}>
              <ChevronRight className="h-4 w-4" />
            </button>
            <button onClick={goToToday} className="px-3 py-2 rounded-lg border text-xs font-medium"
              style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg, color: theme.textPrimary }}>
              This Period
            </button>
          </div>
          <button onClick={report.refresh} disabled={report.isLoading} className="px-3 py-2 rounded-lg border text-sm">Refresh</button>
          <button onClick={exportToCSV} disabled={report.isLoading || !!report.error || data.isLoading || !!data.error} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
            style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg, color: theme.textSecondary }}>
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-2 text-sm font-bold bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors dark:bg-slate-600">
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
        </div>
      </div>

      {/* Period info banner */}
      <WebCard className="p-3 border-l-4" style={{ borderColor: theme.accentBlue, backgroundColor: theme.cardBg }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" style={{ color: theme.accentBlue }} />
            <span className="text-sm font-medium" style={{ color: theme.textPrimary }}>
              {currentPeriod.type.charAt(0).toUpperCase() + currentPeriod.type.slice(1)} Report
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
              {currentPeriod.label}
            </span>
          </div>
          <div className="text-xs" style={{ color: theme.textMuted }}>
            {formatPeriodRange(currentPeriod)}
          </div>
        </div>
      </WebCard>

      <p className="text-xs" style={{ color: theme.textSecondary }}>Stock figures show the current balance. Activity includes all recorded IN, OUT, RECEIVE and ADJUST movements in the selected period. Calendar: {getConfiguredTimezone()}, Monday-start weeks.</p>
      {report.isLoading && <p role="status">Loading complete period activity…</p>}
      {report.error && <p role="alert" style={{ color: theme.statusOut }}>{report.error}</p>}

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Current SKUs", value: fmt(totalParts), sub: `${fmt(totalUnits)} units`, color: theme.accentBlue },
          { label: "Current Health", value: `${healthPct}%`, sub: `${healthy.length} healthy`, color: healthPct >= 60 ? theme.statusOk : theme.statusLow },
          { label: "Current Stock-Outs", value: fmt(stockouts.length), sub: `${requiredStockouts.length} required`, color: theme.statusOut },
          { label: "Period Activity", value: report.isLoading ? "…" : report.error ? "Unavailable" : fmt(txnsInPeriod.length), sub: `${txnsByMode.OUT || 0} out / ${txnsByMode.IN + txnsByMode.RECEIVE || 0} in`, color: theme.textPrimary },
        ].map((s, i) => (
          <WebCard key={i} className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.textMuted }}>{s.label}</p>
            <p className="text-2xl font-black mt-0.5" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>{s.sub}</p>
          </WebCard>
        ))}
      </div>

      {/* Inventory Status Breakdown */}
      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Inventory Status Breakdown</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Healthy", value: healthy.length, total: totalParts, color: theme.statusOk, textColor: theme.statusOk },
            { label: "Low Stock", value: lowStock.length, total: totalParts, color: theme.statusLow, textColor: theme.statusLow },
            { label: "Stock-Out", value: stockouts.length, total: totalParts, color: theme.statusOut, textColor: theme.statusOut },
            { label: "Overstocked", value: overstocked.length, total: totalParts, color: theme.accentBlue, textColor: theme.accentBlue },
          ].map((s, i) => (
            <div key={i} className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase" style={{ color: theme.textMuted }}>{s.label}</span>
                <span className="text-lg font-black" style={{ color: s.textColor }}>{s.value}</span>
              </div>
              <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ backgroundColor: s.color, width: `${totalParts > 0 ? (s.value / s.total) * 100 : 0}%` }} />
              </div>
              <p className="text-[10px] mt-1" style={{ color: theme.textMuted }}>
                {totalParts > 0 ? Math.round((s.value / s.total) * 100) : 0}% of {s.total}
              </p>
            </div>
          ))}
        </div>
      </WebCard>

      {/* Transaction Activity by Mode */}
      {!report.isLoading && !report.error && <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Transaction Activity</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { mode: "IN", label: "Received", count: txnsByMode.IN || 0, color: theme.statusOk },
            { mode: "OUT", label: "Consumed", count: txnsByMode.OUT || 0, color: theme.statusOut },
            { mode: "RECEIVE", label: "Incoming", count: txnsByMode.RECEIVE || 0, color: theme.accentBlue },
            { mode: "ADJUST", label: "Adjusted", count: txnsByMode.ADJUST || 0, color: theme.statusLow },
          ].map((s, i) => (
            <WebCard key={i} className="p-3 text-center">
              <p className="text-[10px] font-bold uppercase" style={{ color: theme.textMuted }}>{s.label}</p>
              <p className="text-2xl font-black mt-1" style={{ color: s.color }}>{fmt(s.count)}</p>
            </WebCard>
          ))}
        </div>
      </WebCard>}

      {/* Reorder Alerts */}
      {needReorder.length > 0 && (
        <WebCard className="p-4 border-l-4" style={{ borderColor: theme.statusOut, backgroundColor: theme.cardBg }}>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: theme.statusOut + "20" }}>
              <span style={{ color: theme.statusOut }}>⚠</span>
            </div>
            <div>
              <p className="font-bold text-sm" style={{ color: theme.textPrimary }}>
                {needReorder.length} Parts Below Reorder Point
              </p>
              <p className="text-xs mt-0.5" style={{ color: theme.textSecondary }}>
                {stockouts.length} at zero stock. Total reorder quantity: {fmt(totalReorderUnits)} units
              </p>
              <p className="text-xs mt-1" style={{ color: theme.textMuted }}>
                {needReorder.slice(0, 5).map(p => p.partNumber).join(", ")}{needReorder.length > 5 ? "..." : ""}
              </p>
            </div>
          </div>
        </WebCard>
      )}

      {/* Top Moving Parts */}
      {topMovingParts.length > 0 && (
        <WebCard className="p-4">
          <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Top Moving Parts (by volume)</h3>
          <div className="space-y-2">
            {topMovingParts.map((p, i) => (
              <div key={p.partNumber} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-mono text-blue-600 w-20 shrink-0">{p.partNumber}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: theme.textPrimary }}>{p.description}</p>
                    <p className="text-[10px]" style={{ color: theme.textMuted }}>IN: {fmt(p.in)} · OUT: {fmt(p.out)}</p>
                  </div>
                </div>
                <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>{fmt(p.total)}</span>
              </div>
            ))}
          </div>
        </WebCard>
      )}
    </div>
  );
}
