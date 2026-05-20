import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, theme } from "../../components/vitros/SharedComponents";

export function ProductionPlan() {
  const data = useConvexData();

  const byType: Record<string, { completed: number; inProgress: number }> = {};
  for (const a of data.analyzers) {
    if (!byType[a.analyzerType]) byType[a.analyzerType] = { completed: 0, inProgress: 0 };
    if (a.isComplete) byType[a.analyzerType].completed++;
    else byType[a.analyzerType].inProgress++;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📈 Production Plan</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Plan vs. actual by analyzer type</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DashCard label="TOTAL BUILDS" value={data.analyzers.length} icon="🔬" color="#6366f1" />
        <DashCard label="COMPLETED" value={data.analyzers.filter(a => a.isComplete).length} icon="✅" color={theme.statusOk} />
      </div>

      {Object.entries(byType).map(([type, { completed, inProgress }]) => (
        <WebCard key={type} className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>{type}</span>
            <span className="text-xs" style={{ color: theme.textMuted }}>{completed + inProgress} total</span>
          </div>
          <div className="flex gap-4">
            <div className="flex-1 text-center rounded-xl p-2" style={{ backgroundColor: theme.statusOk + "15" }}>
              <div className="text-lg font-black" style={{ color: theme.statusOk }}>{completed}</div>
              <div className="text-[10px]" style={{ color: theme.textMuted }}>Completed</div>
            </div>
            <div className="flex-1 text-center rounded-xl p-2" style={{ backgroundColor: "#f59e0b15" }}>
              <div className="text-lg font-black" style={{ color: "#f59e0b" }}>{inProgress}</div>
              <div className="text-[10px]" style={{ color: theme.textMuted }}>In Progress</div>
            </div>
          </div>
        </WebCard>
      ))}
    </div>
  );
}
