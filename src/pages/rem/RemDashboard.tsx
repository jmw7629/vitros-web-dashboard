import { useRemInspection, RemInfoCard } from "../../components/vitros/RemDataDialog";
import { useEffect, useMemo, useState } from "react";
import { useConfig } from "../../hooks/useConfig";
import { WebCard, DashCard, ProgressBar, theme } from "../../components/vitros/SharedComponents";
import { useRemCoreData } from "../../hooks/useRemCoreData";
import { browserSafeRead } from "../../lib/browserSafeRead";
import type { RemProgressChartConfig } from "../../lib/configRegistry";

type RemSummary = {
  total: number;
  completed: number;
  active: number;
  by_type: { type: string; total: number; completed: number }[];
  by_stage: { stage: string; count: number }[];
  lvcc_total: number;
  lvcc_active: number;
};

export function RemDashboard() {
  const data = useRemCoreData();
  const { get } = useConfig();
  const remProgressConfig = get<RemProgressChartConfig>("charts.remProgress");
  const [summary, setSummary] = useState<RemSummary | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await browserSafeRead<RemSummary>("rem_summary");
        if (cancelled) return;
        setSummary(rows[0] ?? null);
        setLiveError(null);
      } catch (error) {
        if (cancelled) return;
        setLiveError(error instanceof Error ? error.message : "REM live summary unavailable");
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const fallbackTotal = data.analyzers.length;
  const fallbackCompleted = data.analyzers.filter((analyzer) => analyzer.isComplete).length;
  const total = summary?.total ?? fallbackTotal;
  const completed = summary?.completed ?? fallbackCompleted;
  const active = summary?.active ?? (fallbackTotal - fallbackCompleted);

  const byType = useMemo(() => {
    if (summary) return summary.by_type.map((item) => [item.type, { total: item.total, completed: item.completed }] as const);
    const counts: Record<string, { total: number; completed: number }> = {};
    for (const analyzer of data.analyzers) {
      if (!counts[analyzer.analyzerType]) counts[analyzer.analyzerType] = { total: 0, completed: 0 };
      counts[analyzer.analyzerType].total += 1;
      if (analyzer.isComplete) counts[analyzer.analyzerType].completed += 1;
    }
    return Object.entries(counts).sort((a, b) => b[1].total - a[1].total);
  }, [summary, data.analyzers]);

  const byStage = useMemo(() => {
    if (summary) return summary.by_stage.map((item) => [item.stage, item.count] as const);
    const counts: Record<string, number> = {};
    data.analyzers.filter((analyzer) => !analyzer.isComplete).forEach((analyzer) => {
      const stage = analyzer.currentStage || "Unassigned";
      counts[stage] = (counts[stage] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [summary, data.analyzers]);

  const lvccTotal = summary?.lvcc_total ?? data.lvccItems.length;
  const lvccActive = summary?.lvcc_active ?? data.lvccItems.filter((item) => !item.isComplete).length;
  const unavailable = !!liveError && !!data.error;

  const progressColor = remProgressConfig.color || "#6366f1";
  const showProgress = remProgressConfig.visible !== false;

  const { inspect, dialog } = useRemInspection();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>REM Dashboard</h2>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: unavailable ? theme.statusOut : liveError ? theme.textMuted : theme.statusOk }}>
          {unavailable ? "Unavailable" : liveError ? "Authenticated Supabase" : summary ? "Live Supabase" : "Loading live data"}
        </span>
      </div>

      {unavailable && (
        <WebCard className="p-4">
          <div className="text-sm font-bold" style={{ color: theme.statusOut }}>REM dashboard unavailable</div>
          <div className="mt-1 text-xs" style={{ color: theme.textSecondary }}>Both the least-privilege summary and authenticated authoritative REM read failed. No legacy Convex data was substituted.</div>
          <button type="button" onClick={() => void data.refresh()} className="mt-3 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>Retry authoritative read</button>
        </WebCard>
      )}

      <div className="grid grid-cols-3 gap-3">
        <DashCard onClick={() => inspect("TOTAL", data.analyzers)} label="TOTAL" value={total} icon="🔬" color={progressColor} />
        <DashCard onClick={() => inspect("COMPLETED", data.analyzers.filter(a => a.isComplete))} label="COMPLETED" value={completed} icon="✅" color={theme.statusOk} />
        <DashCard onClick={() => inspect("IN PROGRESS", data.analyzers.filter(a => !a.isComplete))} label="IN PROGRESS" value={active} icon="🔧" color="#f59e0b" />
      </div>

      {showProgress && (
        <RemInfoCard title="Analyzer types" data={data.analyzers} className="p-4">
          <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>By Analyzer Type</h3>
          {byType.length === 0 ? (
            <div className="text-sm py-4 text-center" style={{ color: theme.textMuted }}>No REM analyzers available</div>
          ) : byType.map(([type, counts]) => (
            <button type="button" onClick={() => inspect(type, data.analyzers.filter(a => a.analyzerType === type))} key={type} className="mb-3 w-full text-left">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm" style={{ color: theme.textPrimary }}>{type}</span>
                <span className="text-xs" style={{ color: theme.textMuted }}>{counts.completed}/{counts.total} complete</span>
              </div>
              <ProgressBar value={counts.completed} maxValue={counts.total} color={progressColor} />
            </button>
          ))}
        </RemInfoCard>
      )}

      <RemInfoCard title="WIP by stage" data={data.analyzers.filter(a => !a.isComplete)} className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>WIP by Stage</h3>
        {byStage.length === 0 ? (
          <div className="text-sm py-4 text-center" style={{ color: theme.textMuted }}>No active REM work in progress</div>
        ) : byStage.map(([stage, count]) => (
          <button type="button" onClick={() => inspect(stage, data.analyzers.filter(a => !a.isComplete && a.currentStage === stage))} key={stage} className="w-full text-left flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: progressColor }} />
              <span className="text-sm" style={{ color: theme.textPrimary }}>{stage}</span>
            </div>
            <span className="text-sm font-bold" style={{ color: progressColor }}>{count}</span>
          </button>
        ))}
      </RemInfoCard>

      <div className="grid grid-cols-2 gap-3">
        <DashCard onClick={() => inspect("LVCC TOTAL", data.lvccItems)} label="LVCC TOTAL" value={lvccTotal} icon="📋" color="#8b5cf6" />
        <DashCard onClick={() => inspect("LVCC ACTIVE", data.lvccItems.filter(a => !a.isComplete))} label="LVCC ACTIVE" value={lvccActive} icon="⚡" color="#f59e0b" />
      </div>
      {dialog}
    </div>
  );
}