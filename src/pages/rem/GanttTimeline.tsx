import { useMemo } from "react";
import { WebCard, theme } from "../../components/vitros/SharedComponents";
import { useRemCoreData } from "../../hooks/useRemCoreData";

const STAGES = ["Procurement", "Cleaning", "Service", "Final Line", "Packaging", "Release Testing", "QA Release", "SAP Release"];
const STAGE_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#6366f1"];

export function GanttTimeline() {
  const data = useRemCoreData();

  const activeAnalyzers = useMemo(() => {
    return data.analyzers
      .filter((analyzer) => !analyzer.isComplete)
      .sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
  }, [data.analyzers]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📊 Gantt Timeline</h2>
          <p className="text-sm" style={{ color: theme.textSecondary }}>Authoritative progress view of active analyzer builds</p>
        </div>
        {!data.isLoading && !data.error && <span className="text-[10px] font-bold" style={{ color: theme.statusOk }}>LIVE · SUPABASE</span>}
      </div>

      {data.error && (
        <WebCard className="p-4">
          <div className="text-sm font-bold" style={{ color: theme.statusOut }}>REM timeline unavailable</div>
          <div className="mt-1 text-xs" style={{ color: theme.textSecondary }}>The authoritative REM service could not be read. No legacy fallback was substituted.</div>
          <button type="button" onClick={() => void data.refresh()} className="mt-3 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>Retry</button>
        </WebCard>
      )}

      <div className="flex flex-wrap gap-2">
        {STAGES.map((stage, index) => (
          <div key={stage} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: STAGE_COLORS[index] }} />
            <span className="text-[9px]" style={{ color: theme.textSecondary }}>{stage}</span>
          </div>
        ))}
      </div>

      <WebCard className="p-4 overflow-x-auto">
        {data.isLoading ? (
          <div className="py-8 text-center text-sm" style={{ color: theme.textSecondary }}>Loading authoritative REM timeline…</div>
        ) : !data.error && activeAnalyzers.length === 0 ? (
          <div className="py-8 text-center text-sm" style={{ color: theme.textSecondary }}>No active analyzer builds are currently recorded.</div>
        ) : !data.error ? (
          <div className="space-y-3" style={{ minWidth: 500 }}>
            {activeAnalyzers.map((analyzer) => {
              const stages = [
                { name: "Procurement", pct: analyzer.procurementPct },
                { name: "Cleaning", pct: analyzer.cleaningPct },
                { name: "Service", pct: analyzer.servicePct },
                { name: "Final Line", pct: analyzer.finalLinePct },
                { name: "Packaging", pct: analyzer.packagingPct },
                { name: "Release Testing", pct: analyzer.releaseTestingPct },
                { name: "QA Release", pct: analyzer.qaReleasePct },
                { name: "SAP Release", pct: analyzer.sapReleasePct },
              ];
              return (
                <div key={analyzer.serialNumber} className="flex items-center gap-3">
                  <div className="w-[80px] shrink-0">
                    <div className="text-xs font-bold" style={{ color: theme.textPrimary }}>{analyzer.serialNumber}</div>
                    <div className="text-[9px]" style={{ color: theme.textMuted }}>{analyzer.analyzerType}</div>
                  </div>
                  <div className="flex-1 flex gap-0.5 h-5">
                    {stages.map((stage, index) => (
                      <div
                        key={stage.name}
                        className="flex-1 rounded-sm"
                        style={{
                          backgroundColor: stage.pct > 0 ? STAGE_COLORS[index] : "#1e293b",
                          opacity: stage.pct > 0 ? Math.max(0.3, stage.pct / 100) : 1,
                        }}
                        title={`${stage.name}: ${Math.round(stage.pct)}%`}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] w-[30px] text-right font-bold" style={{ color: theme.textPrimary }}>{Math.round(analyzer.overallPct)}%</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </WebCard>
    </div>
  );
}