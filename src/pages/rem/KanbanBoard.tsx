import { useMemo } from "react";
import { ProgressBar, WebCard, theme } from "../../components/vitros/SharedComponents";
import { useRemCoreData } from "../../hooks/useRemCoreData";

const STAGES = ["Procurement", "Cleaning", "Service", "Final Line", "Packaging", "Release Testing", "QA Release", "SAP Release"];

export function KanbanBoard() {
  const data = useRemCoreData();

  const columns = useMemo(() => {
    return STAGES.map((stage) => ({
      stage,
      analyzers: data.analyzers.filter((analyzer) => analyzer.currentStage === stage && !analyzer.isComplete),
    }));
  }, [data.analyzers]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📋 Kanban Board</h2>
        {!data.isLoading && !data.error && <span className="text-[10px] font-bold" style={{ color: theme.statusOk }}>LIVE · SUPABASE</span>}
      </div>

      {data.error && (
        <WebCard className="p-4">
          <div className="text-sm font-bold" style={{ color: theme.statusOut }}>REM Kanban unavailable</div>
          <div className="mt-1 text-xs" style={{ color: theme.textSecondary }}>The authoritative REM service could not be read. No legacy fallback was substituted.</div>
          <button type="button" onClick={() => void data.refresh()} className="mt-3 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>Retry</button>
        </WebCard>
      )}

      {data.isLoading ? (
        <WebCard className="py-10 text-center"><span className="text-sm" style={{ color: theme.textSecondary }}>Loading authoritative REM workflow…</span></WebCard>
      ) : !data.error && (
        <div className="overflow-x-auto pb-4 -mx-4 px-4">
          <div className="flex gap-3" style={{ minWidth: STAGES.length * 200 }}>
            {columns.map((column) => (
              <div key={column.stage} className="w-[200px] shrink-0 rounded-2xl p-3" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#6366f1" }} />
                  <span className="text-xs font-bold" style={{ color: theme.textPrimary }}>{column.stage}</span>
                  <span className="ml-auto text-[10px] font-bold" style={{ color: theme.textMuted }}>{column.analyzers.length}</span>
                </div>
                <div className="space-y-2">
                  {column.analyzers.map((analyzer) => (
                    <div key={analyzer.serialNumber} className="rounded-xl p-2.5" style={{ backgroundColor: "#111827", border: `1px solid ${theme.cardBorder}` }}>
                      <div className="text-xs font-bold mb-0.5" style={{ color: theme.textPrimary }}>{analyzer.serialNumber}</div>
                      <div className="text-[10px] mb-1.5" style={{ color: theme.textMuted }}>{analyzer.analyzerType}</div>
                      <ProgressBar value={analyzer.overallPct} maxValue={100} color="#6366f1" height={4} />
                      <div className="flex justify-between mt-1">
                        <span className="text-[9px]" style={{ color: theme.textMuted }}>{Math.round(analyzer.overallPct)}%</span>
                        <span className="text-[9px]" style={{ color: analyzer.daysInStage > analyzer.slaDays ? theme.statusOut : theme.textMuted }}>
                          Day {analyzer.daysInStage}
                        </span>
                      </div>
                    </div>
                  ))}
                  {column.analyzers.length === 0 && (
                    <div className="text-center py-4 text-[10px]" style={{ color: theme.textMuted }}>Empty</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}