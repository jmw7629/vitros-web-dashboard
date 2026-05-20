import { useMemo } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { ProgressBar, theme } from "../../components/vitros/SharedComponents";

const STAGES = ["Procurement", "Cleaning", "Service/Repair", "Final Line", "Packaging", "Release Testing", "QA Release", "SAP Release"];

export function KanbanBoard() {
  const data = useConvexData();

  const columns = useMemo(() => {
    return STAGES.map(stage => ({
      stage,
      analyzers: data.analyzers.filter(a => a.currentStage === stage && !a.isComplete),
    }));
  }, [data.analyzers]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📋 Kanban Board</h2>

      {/* Horizontal scroll */}
      <div className="overflow-x-auto pb-4 -mx-4 px-4">
        <div className="flex gap-3" style={{ minWidth: STAGES.length * 200 }}>
          {columns.map(col => (
            <div key={col.stage} className="w-[200px] shrink-0 rounded-2xl p-3" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#6366f1" }} />
                <span className="text-xs font-bold" style={{ color: theme.textPrimary }}>{col.stage}</span>
                <span className="ml-auto text-[10px] font-bold" style={{ color: theme.textMuted }}>{col.analyzers.length}</span>
              </div>
              <div className="space-y-2">
                {col.analyzers.map(a => (
                  <div key={a.serialNumber} className="rounded-xl p-2.5" style={{ backgroundColor: "#111827", border: `1px solid ${theme.cardBorder}` }}>
                    <div className="text-xs font-bold mb-0.5" style={{ color: theme.textPrimary }}>{a.serialNumber}</div>
                    <div className="text-[10px] mb-1.5" style={{ color: theme.textMuted }}>{a.analyzerType}</div>
                    <ProgressBar value={a.overallPct} maxValue={100} color="#6366f1" height={4} />
                    <div className="flex justify-between mt-1">
                      <span className="text-[9px]" style={{ color: theme.textMuted }}>{Math.round(a.overallPct)}%</span>
                      <span className="text-[9px]" style={{ color: a.daysInStage > a.slaDays ? theme.statusOut : theme.textMuted }}>
                        Day {a.daysInStage}
                      </span>
                    </div>
                  </div>
                ))}
                {col.analyzers.length === 0 && (
                  <div className="text-center py-4 text-[10px]" style={{ color: theme.textMuted }}>Empty</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
