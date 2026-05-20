import { useMemo } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, theme } from "../../components/vitros/SharedComponents";

const STAGES = ["Procurement", "Cleaning", "Service/Repair", "Final Line", "Packaging", "Release Testing", "QA Release", "SAP Release"];
const STAGE_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#6366f1"];

export function GanttTimeline() {
  const data = useConvexData();

  const activeAnalyzers = useMemo(() => {
    return data.analyzers.filter(a => !a.isComplete).sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
  }, [data.analyzers]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📊 Gantt Timeline</h2>
      <p className="text-sm" style={{ color: theme.textSecondary }}>Time-based view of analyzer builds</p>

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {STAGES.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: STAGE_COLORS[i] }} />
            <span className="text-[9px]" style={{ color: theme.textSecondary }}>{s}</span>
          </div>
        ))}
      </div>

      <WebCard className="p-4 overflow-x-auto">
        <div className="space-y-3" style={{ minWidth: 500 }}>
          {activeAnalyzers.map(a => {
            const stages = [
              { name: "Procurement", pct: a.procurementPct },
              { name: "Cleaning", pct: a.cleaningPct },
              { name: "Service", pct: a.servicePct },
              { name: "Final Line", pct: a.finalLinePct },
              { name: "Packaging", pct: a.packagingPct },
              { name: "Release Testing", pct: a.releaseTestingPct },
              { name: "QA Release", pct: a.qaReleasePct },
              { name: "SAP Release", pct: a.sapReleasePct },
            ];
            return (
              <div key={a.serialNumber} className="flex items-center gap-3">
                <div className="w-[80px] shrink-0">
                  <div className="text-xs font-bold" style={{ color: theme.textPrimary }}>{a.serialNumber}</div>
                  <div className="text-[9px]" style={{ color: theme.textMuted }}>{a.analyzerType}</div>
                </div>
                <div className="flex-1 flex gap-0.5 h-5">
                  {stages.map((s, i) => (
                    <div key={s.name} className="flex-1 rounded-sm" style={{
                      backgroundColor: s.pct > 0 ? STAGE_COLORS[i] : "#1e293b",
                      opacity: s.pct > 0 ? Math.max(0.3, s.pct / 100) : 1,
                    }} title={s.name + ": " + Math.round(s.pct) + "%"} />
                  ))}
                </div>
                <span className="text-[10px] w-[30px] text-right font-bold" style={{ color: theme.textPrimary }}>{Math.round(a.overallPct)}%</span>
              </div>
            );
          })}
        </div>
      </WebCard>
    </div>
  );
}
