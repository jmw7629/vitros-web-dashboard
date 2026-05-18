import { useMemo } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, theme } from "../../components/vitros/SharedComponents";

export function MorningSnapshot() {
  const data = useConvexData();

  const completedThisWeek = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    return data.analyzers.filter(a => a.isComplete && a.targetDate && new Date(a.targetDate) >= startOfWeek).length;
  }, [data.analyzers]);

  const completedLastWeek = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
    return data.analyzers.filter(a => a.isComplete && a.targetDate && new Date(a.targetDate) >= startOfLastWeek && new Date(a.targetDate) < startOfWeek).length;
  }, [data.analyzers]);

  const completedThisMonth = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return data.analyzers.filter(a => a.isComplete && a.targetDate && new Date(a.targetDate) >= startOfMonth).length;
  }, [data.analyzers]);

  const active = data.analyzers.filter(a => !a.isComplete).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>☀️ Morning Snapshot</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DashCard label="THIS WEEK" value={completedThisWeek} subtitle="completed" icon="📅" color={theme.statusOk} />
        <DashCard label="LAST WEEK" value={completedLastWeek} subtitle="completed" icon="📊" color="#6366f1" />
        <DashCard label="THIS MONTH" value={completedThisMonth} subtitle="completed" icon="📈" color="#8b5cf6" />
        <DashCard label="ACTIVE WIP" value={active} subtitle="in progress" icon="🔧" color="#f59e0b" />
      </div>

      {/* Stage distribution */}
      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Active by Stage</h3>
        {(() => {
          const stages: Record<string, number> = {};
          data.analyzers.filter(a => !a.isComplete).forEach(a => { stages[a.currentStage] = (stages[a.currentStage] || 0) + 1; });
          return Object.entries(stages).sort((a, b) => b[1] - a[1]).map(([stage, count]) => (
            <div key={stage} className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
              <span className="text-sm" style={{ color: theme.textPrimary }}>{stage}</span>
              <span className="text-sm font-bold" style={{ color: "#6366f1" }}>{count}</span>
            </div>
          ));
        })()}
      </WebCard>
    </div>
  );
}
