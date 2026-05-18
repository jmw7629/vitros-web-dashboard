import { useMemo } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, ProgressBar, theme } from "../../components/vitros/SharedComponents";

export function RemDashboard() {
  const data = useConvexData();

  const total = data.analyzers.length;
  const completed = data.analyzers.filter(a => a.isComplete).length;
  const active = total - completed;

  const byType = useMemo(() => {
    const m: Record<string, { total: number; completed: number }> = {};
    for (const a of data.analyzers) {
      if (!m[a.analyzerType]) m[a.analyzerType] = { total: 0, completed: 0 };
      m[a.analyzerType].total++;
      if (a.isComplete) m[a.analyzerType].completed++;
    }
    return Object.entries(m).sort((a, b) => b[1].total - a[1].total);
  }, [data.analyzers]);

  const byStage = useMemo(() => {
    const m: Record<string, number> = {};
    data.analyzers.filter(a => !a.isComplete).forEach(a => { m[a.currentStage] = (m[a.currentStage] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [data.analyzers]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>REM Dashboard</h2>

      <div className="grid grid-cols-3 gap-3">
        <DashCard label="TOTAL" value={total} icon="🔬" color="#6366f1" />
        <DashCard label="COMPLETED" value={completed} icon="✅" color={theme.statusOk} />
        <DashCard label="IN PROGRESS" value={active} icon="🔧" color="#f59e0b" />
      </div>

      {/* By Type */}
      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>By Analyzer Type</h3>
        {byType.map(([type, { total: t, completed: c }]) => (
          <div key={type} className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm" style={{ color: theme.textPrimary }}>{type}</span>
              <span className="text-xs" style={{ color: theme.textMuted }}>{c}/{t} complete</span>
            </div>
            <ProgressBar value={c} maxValue={t} color="#6366f1" />
          </div>
        ))}
      </WebCard>

      {/* WIP by Stage */}
      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>WIP by Stage</h3>
        {byStage.map(([stage, count]) => (
          <div key={stage} className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#6366f1" }} />
              <span className="text-sm" style={{ color: theme.textPrimary }}>{stage}</span>
            </div>
            <span className="text-sm font-bold" style={{ color: "#6366f1" }}>{count}</span>
          </div>
        ))}
      </WebCard>

      {/* LVCC Summary */}
      <div className="grid grid-cols-2 gap-3">
        <DashCard label="LVCC TOTAL" value={data.lvccItems.length} icon="📋" color="#8b5cf6" />
        <DashCard label="LVCC ACTIVE" value={data.lvccItems.filter(l => !l.isComplete).length} icon="⚡" color="#f59e0b" />
      </div>
    </div>
  );
}
