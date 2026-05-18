import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, StatusBadge, ProgressBar, theme } from "../../components/vitros/SharedComponents";

export function LvccTracker() {
  const data = useConvexData();
  const active = data.lvccItems.filter(l => !l.isComplete);
  const _completed = data.lvccItems.filter(l => l.isComplete);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📋 LVCC Tracker</h2>

      <div className="grid grid-cols-2 gap-3">
        <DashCard label="TOTAL" value={data.lvccItems.length} icon="📋" color="#6366f1" />
        <DashCard label="ACTIVE" value={active.length} icon="⚡" color="#f59e0b" />
      </div>

      {data.lvccItems.map(item => {
        const stages = [
          { name: "Build", pct: item.buildPct },
          { name: "Test", pct: item.testPct },
          { name: "Pack", pct: item.packagingPct },
          { name: "QA", pct: item.qaReleasePct },
          { name: "SAP", pct: item.sapReleasePct },
        ];
        return (
          <WebCard key={item.serialNumber} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>{item.serialNumber}</span>
              <StatusBadge text={item.itemType || "LVCC"} color="#8b5cf6" />
              {item.isComplete && <StatusBadge text="Complete" color={theme.statusOk} />}
            </div>
            <div className="flex gap-3">
              {stages.map(s => (
                <div key={s.name} className="flex-1 text-center">
                  <div className="text-xs font-bold mb-1" style={{ color: s.pct >= 100 ? theme.statusOk : "#6366f1" }}>
                    {Math.round(s.pct)}%
                  </div>
                  <ProgressBar value={s.pct} maxValue={100} color={s.pct >= 100 ? theme.statusOk : "#6366f1"} height={4} />
                  <div className="text-[8px] mt-0.5" style={{ color: theme.textMuted }}>{s.name}</div>
                </div>
              ))}
            </div>
          </WebCard>
        );
      })}
    </div>
  );
}
