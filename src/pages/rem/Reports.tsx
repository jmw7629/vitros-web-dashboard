import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, ProgressBar, theme } from "../../components/vitros/SharedComponents";

export function Reports() {
  const data = useConvexData();
  const total = data.analyzers.length;
  const completed = data.analyzers.filter(a => a.isComplete).length;
  const active = total - completed;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📊 REM Reports</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>
          Generated {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DashCard label="TOTAL" value={total} icon="🔬" color="#6366f1" />
        <DashCard label="ACTIVE" value={active} icon="🔧" color="#f59e0b" />
        <DashCard label="COMPLETED" value={completed} icon="✅" color={theme.statusOk} />
        <DashCard label="LVCC" value={data.lvccItems.length} icon="📋" color="#8b5cf6" />
      </div>

      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-2" style={{ color: theme.textPrimary }}>Completion Rate</h3>
        <ProgressBar value={completed} maxValue={total || 1} color={theme.statusOk} height={10} />
        <div className="text-xs mt-1 text-right" style={{ color: theme.textMuted }}>{total ? Math.round((completed/total)*100) : 0}%</div>
      </WebCard>

      <button className="w-full py-3 rounded-xl text-sm font-bold text-white" style={{ backgroundColor: "#6366f1" }}>
        Export REM Report
      </button>
    </div>
  );
}
