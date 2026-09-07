import { useMemo } from "react";
import { WebCard, DashCard, theme } from "../../components/vitros/SharedComponents";
import { useRemCoreData } from "../../hooks/useRemCoreData";

export function MorningSnapshot() {
  const data = useRemCoreData();

  const completed = data.analyzers.filter((analyzer) => analyzer.isComplete).length;
  const activeAnalyzers = data.analyzers.filter((analyzer) => !analyzer.isComplete);
  const active = activeAnalyzers.length;
  const slaAttention = activeAnalyzers.filter((analyzer) => analyzer.slaDays > 0 && analyzer.daysInStage > analyzer.slaDays).length;
  const averageProgress = active
    ? Math.round(activeAnalyzers.reduce((sum, analyzer) => sum + analyzer.overallPct, 0) / active)
    : 0;

  const stages = useMemo(() => {
    const counts: Record<string, number> = {};
    activeAnalyzers.forEach((analyzer) => {
      const stage = analyzer.currentStage || "Unassigned";
      counts[stage] = (counts[stage] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [data.analyzers]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>☀️ Morning Snapshot</h2>
          <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        {!data.isLoading && !data.error && <span className="text-[10px] font-bold" style={{ color: theme.statusOk }}>LIVE · SUPABASE</span>}
      </div>

      {data.error && (
        <WebCard className="p-4">
          <div className="text-sm font-bold" style={{ color: theme.statusOut }}>REM morning snapshot unavailable</div>
          <div className="mt-1 text-xs" style={{ color: theme.textSecondary }}>The authoritative REM service could not be read. Date-based completion estimates are not fabricated from missing fields.</div>
          <button type="button" onClick={() => void data.refresh()} className="mt-3 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>Retry</button>
        </WebCard>
      )}

      <div className="grid grid-cols-2 gap-3">
        <DashCard label="ACTIVE WIP" value={active} subtitle="in progress" icon="🔧" color="#f59e0b" />
        <DashCard label="COMPLETED" value={completed} subtitle="authoritative total" icon="✅" color={theme.statusOk} />
        <DashCard label="AVG PROGRESS" value={`${averageProgress}%`} subtitle="active analyzers" icon="📈" color="#8b5cf6" />
        <DashCard label="SLA ATTENTION" value={slaAttention} subtitle="days in stage > SLA" icon="⚠️" color={slaAttention > 0 ? theme.statusOut : theme.statusOk} />
      </div>

      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Active by Stage</h3>
        {data.isLoading ? (
          <div className="py-6 text-center text-sm" style={{ color: theme.textSecondary }}>Loading authoritative REM WIP…</div>
        ) : !data.error && stages.length === 0 ? (
          <div className="py-6 text-center text-sm" style={{ color: theme.textSecondary }}>No active REM work in progress.</div>
        ) : !data.error ? stages.map(([stage, count]) => (
          <div key={stage} className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
            <span className="text-sm" style={{ color: theme.textPrimary }}>{stage}</span>
            <span className="text-sm font-bold" style={{ color: "#6366f1" }}>{count}</span>
          </div>
        )) : null}
      </WebCard>
    </div>
  );
}