import { useEffect, useMemo, useState } from "react";
import { useConvexData, type LVCCItem, type REMAnalyzer } from "../../hooks/useConvexData";
import { browserSafeRead } from "../../lib/browserSafeRead";
import { WebCard, DashCard, ProgressBar, theme } from "../../components/vitros/SharedComponents";

function mapAnalyzer(row: any): REMAnalyzer {
  return {
    _id: row.id,
    serialNumber: row.serial_number || "",
    analyzerType: row.analyzer_type || "Unknown",
    currentStage: row.current_stage || "Unassigned",
    startDate: row.start_date || undefined,
    productionOrder: row.production_order == null ? undefined : Number(row.production_order),
    procurementPct: Number(row.procurement_pct) || 0,
    cleaningPct: Number(row.cleaning_pct) || 0,
    servicePct: Number(row.service_pct) || 0,
    finalLinePct: Number(row.final_line_pct) || 0,
    packagingPct: Number(row.packaging_pct) || 0,
    releaseTestingPct: Number(row.release_testing_pct) || 0,
    qaReleasePct: Number(row.qa_release_pct) || 0,
    sapReleasePct: Number(row.sap_release_pct) || 0,
    currentPct: Number(row.current_pct) || 0,
    overallPct: Number(row.overall_pct) || 0,
    isComplete: row.is_complete === true,
    daysInStage: Number(row.days_in_stage) || 0,
    slaDays: Number(row.sla_days) || 0,
  };
}

function mapLvcc(row: any): LVCCItem {
  return {
    _id: row.id,
    serialNumber: row.serial_number || "",
    batchNumber: row.batch_number || undefined,
    itemType: row.item_type || undefined,
    currentStage: row.current_stage || undefined,
    startDate: row.start_date || undefined,
    endDate: row.end_date || undefined,
    isComplete: row.is_complete === true,
    buildPct: Number(row.build_pct) || 0,
    testPct: Number(row.test_pct) || 0,
    packagingPct: Number(row.packaging_pct) || 0,
    qaReleasePct: Number(row.qa_release_pct) || 0,
    sapReleasePct: Number(row.sap_release_pct) || 0,
  };
}

export function RemDashboard() {
  const data = useConvexData();
  const [liveAnalyzers, setLiveAnalyzers] = useState<REMAnalyzer[] | null>(null);
  const [liveLvcc, setLiveLvcc] = useState<LVCCItem[] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [analyzers, lvcc] = await Promise.all([
          browserSafeRead<any>("rem_analyzers"),
          browserSafeRead<any>("rem_lvcc"),
        ]);
        if (cancelled) return;
        setLiveAnalyzers(analyzers.map(mapAnalyzer));
        setLiveLvcc(lvcc.map(mapLvcc));
        setLiveError(null);
      } catch (error) {
        if (cancelled) return;
        setLiveError(error instanceof Error ? error.message : "REM live data unavailable");
      }
    };
    load();
    const interval = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const analyzers = liveAnalyzers ?? data.analyzers;
  const lvccItems = liveLvcc ?? data.lvccItems;
  const total = analyzers.length;
  const completed = analyzers.filter(a => a.isComplete).length;
  const active = total - completed;

  const byType = useMemo(() => {
    const m: Record<string, { total: number; completed: number }> = {};
    for (const a of analyzers) {
      if (!m[a.analyzerType]) m[a.analyzerType] = { total: 0, completed: 0 };
      m[a.analyzerType].total++;
      if (a.isComplete) m[a.analyzerType].completed++;
    }
    return Object.entries(m).sort((a, b) => b[1].total - a[1].total);
  }, [analyzers]);

  const byStage = useMemo(() => {
    const m: Record<string, number> = {};
    analyzers.filter(a => !a.isComplete).forEach(a => { m[a.currentStage] = (m[a.currentStage] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [analyzers]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>REM Dashboard</h2>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: liveError ? theme.textMuted : theme.statusOk }}>
          {liveError ? "Fallback data" : liveAnalyzers ? "Live Supabase" : "Loading live data"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <DashCard label="TOTAL" value={total} icon="🔬" color="#6366f1" />
        <DashCard label="COMPLETED" value={completed} icon="✅" color={theme.statusOk} />
        <DashCard label="IN PROGRESS" value={active} icon="🔧" color="#f59e0b" />
      </div>

      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>By Analyzer Type</h3>
        {byType.length === 0 ? (
          <div className="text-sm py-4 text-center" style={{ color: theme.textMuted }}>No REM analyzers available</div>
        ) : byType.map(([type, { total: t, completed: c }]) => (
          <div key={type} className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm" style={{ color: theme.textPrimary }}>{type}</span>
              <span className="text-xs" style={{ color: theme.textMuted }}>{c}/{t} complete</span>
            </div>
            <ProgressBar value={c} maxValue={t} color="#6366f1" />
          </div>
        ))}
      </WebCard>

      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>WIP by Stage</h3>
        {byStage.length === 0 ? (
          <div className="text-sm py-4 text-center" style={{ color: theme.textMuted }}>No active REM work in progress</div>
        ) : byStage.map(([stage, count]) => (
          <div key={stage} className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#6366f1" }} />
              <span className="text-sm" style={{ color: theme.textPrimary }}>{stage}</span>
            </div>
            <span className="text-sm font-bold" style={{ color: "#6366f1" }}>{count}</span>
          </div>
        ))}
      </WebCard>

      <div className="grid grid-cols-2 gap-3">
        <DashCard label="LVCC TOTAL" value={lvccItems.length} icon="📋" color="#8b5cf6" />
        <DashCard label="LVCC ACTIVE" value={lvccItems.filter(l => !l.isComplete).length} icon="⚡" color="#f59e0b" />
      </div>
    </div>
  );
}
