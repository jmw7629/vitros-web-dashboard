import { useState } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, StatusBadge, ProgressBar, theme } from "../../components/vitros/SharedComponents";

const STAGES = ["Procurement", "Cleaning", "Service/Repair", "Final Line", "Packaging", "Release Testing", "QA Release", "SAP Release", "Complete"];

export function EngineerKiosk() {
  const data = useConvexData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newStage, setNewStage] = useState("");
  const [notes, setNotes] = useState("");

  const activeAnalyzers = data.analyzers.filter(a => !a.isComplete);
  const selected = activeAnalyzers.find(a => a._id === selectedId);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>🔧 Engineer Kiosk</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Select an analyzer to update its stage</p>
      </div>

      {!selected ? (
        <WebCard className="overflow-hidden">
          <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Active Analyzers</h3>
          </div>
          <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
            {activeAnalyzers.map(a => (
              <button key={a._id} onClick={() => { setSelectedId(a._id); setNewStage(a.currentStage); }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left">
                <div className="flex-1">
                  <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>{a.serialNumber}</div>
                  <div className="text-xs" style={{ color: theme.textMuted }}>{a.analyzerType}</div>
                </div>
                <div className="text-right">
                  <StatusBadge text={a.currentStage} color="#6366f1" />
                  <div className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>{Math.round(a.overallPct)}%</div>
                </div>
              </button>
            ))}
          </div>
        </WebCard>
      ) : (
        <>
          <button onClick={() => setSelectedId(null)} className="text-sm font-medium" style={{ color: "#6366f1" }}>← Back</button>

          <WebCard className="p-4">
            <div className="text-lg font-bold mb-1" style={{ color: theme.textPrimary }}>{selected.serialNumber}</div>
            <div className="text-sm mb-3" style={{ color: theme.textSecondary }}>{selected.analyzerType} · Current: {selected.currentStage}</div>
            <ProgressBar value={selected.overallPct} maxValue={100} color="#6366f1" height={8} />
          </WebCard>

          <WebCard className="p-4">
            <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Update Stage</h3>
            <div className="space-y-1.5">
              {STAGES.map(stage => (
                <button key={stage} onClick={() => setNewStage(stage)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all"
                  style={{
                    backgroundColor: newStage === stage ? "#6366f122" : "transparent",
                    border: `1px solid ${newStage === stage ? "#6366f1" : theme.cardBorder}`,
                  }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: newStage === stage ? "#6366f1" : theme.cardBorder }} />
                  <span className="text-sm" style={{ color: theme.textPrimary }}>{stage}</span>
                  {stage === selected.currentStage && <span className="ml-auto text-[10px]" style={{ color: theme.textMuted }}>current</span>}
                </button>
              ))}
            </div>
          </WebCard>

          <WebCard className="p-4">
            <label className="text-xs font-semibold" style={{ color: theme.textSecondary }}>Notes</label>
            <textarea className="w-full mt-1 px-3 py-2 rounded-xl text-sm border resize-none h-20"
              style={{ borderColor: theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
              placeholder="Add notes..." value={notes} onChange={e => setNotes(e.target.value)} />
          </WebCard>

          <button disabled={newStage === selected.currentStage}
            className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: "#6366f1" }}>
            Update to {newStage}
          </button>
        </>
      )}
    </div>
  );
}
