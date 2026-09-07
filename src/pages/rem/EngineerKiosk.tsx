import { useAction } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { WebCard, StatusBadge, ProgressBar, theme } from "../../components/vitros/SharedComponents";
import { useRemCoreData } from "../../hooks/useRemCoreData";

const STAGES = ["Procurement", "Cleaning", "Service", "Final Line", "Packaging", "Release Testing", "QA Release", "SAP Release", "Complete"];

type OperationalDetail = {
  analyzerId: string;
  currentStage: string;
  notes: string;
  isComplete: boolean;
};

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "REM analyzer update failed";
  if (/revision conflict/i.test(message)) return "This analyzer changed on another device. The latest authoritative values were reloaded.";
  if (/not authenticated|missing capability/i.test(message)) return "Your account does not have permission to update REM analyzers.";
  return message.slice(0, 240);
}

export function EngineerKiosk() {
  const data = useRemCoreData();
  const getOperational = useAction(api.remOperationalActions.getAnalyzerOperational);
  const updateOperational = useAction(api.remOperationalActions.updateAnalyzerOperational);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newStage, setNewStage] = useState("");
  const [expectedStage, setExpectedStage] = useState("");
  const [notes, setNotes] = useState("");
  const [expectedNotes, setExpectedNotes] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeAnalyzers = data.analyzers.filter((analyzer) => !analyzer.isComplete);
  const selected = data.analyzers.find((analyzer) => analyzer._id === selectedId);

  const applyDetail = (detail: OperationalDetail) => {
    setExpectedStage(detail.currentStage);
    setNewStage(detail.currentStage);
    setExpectedNotes(detail.notes);
    setNotes(detail.notes);
  };

  const loadOperational = async (analyzerId: string) => {
    const detail = await getOperational({ analyzerId }) as OperationalDetail;
    applyDetail(detail);
    return detail;
  };

  const selectAnalyzer = async (analyzerId: string) => {
    setSelectedId(analyzerId);
    setMessage(null);
    setError(null);
    setDetailBusy(true);
    try {
      await loadOperational(analyzerId);
    } catch (cause) {
      setError(safeError(cause));
    } finally {
      setDetailBusy(false);
    }
  };

  const save = async () => {
    if (!selected || detailBusy || saveBusy) return;
    setSaveBusy(true);
    setMessage(null);
    setError(null);
    try {
      const correlationId = `rem-analyzer:${selected._id}:${crypto.randomUUID()}`;
      const receipt = await updateOperational({
        analyzerId: selected._id,
        expectedStage,
        expectedNotes,
        stage: newStage,
        notes,
        correlationId,
      }) as { duplicate?: boolean; stage?: string; notes?: string };

      await data.refresh();
      if (newStage === "Complete") {
        setSelectedId(null);
        setMessage(receipt.duplicate ? "Analyzer was already synchronized." : "Analyzer marked complete and audit history recorded.");
        return;
      }

      const detail = await loadOperational(selected._id);
      setMessage(receipt.duplicate
        ? "Analyzer was already synchronized — no duplicate audit event was created."
        : `Authoritative REM record updated to ${detail.currentStage}.`);
    } catch (cause) {
      const text = safeError(cause);
      if (/changed on another device/i.test(text) && selectedId) {
        try {
          await Promise.all([data.refresh(), loadOperational(selectedId)]);
        } catch {
          // Preserve the original optimistic-concurrency error; a later retry can reload again.
        }
      }
      setError(text);
    } finally {
      setSaveBusy(false);
    }
  };

  const hasChange = !!selected && (newStage !== expectedStage || notes.trim() !== expectedNotes.trim());

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>🔧 Engineer Kiosk</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Securely update the authoritative REM stage and operator notes</p>
      </div>

      {(data.error || error) && (
        <WebCard className="p-3">
          <div className="text-sm font-bold" style={{ color: theme.statusOut }}>REM update unavailable</div>
          <div className="mt-1 text-xs" style={{ color: theme.textSecondary }}>{error || data.error}</div>
        </WebCard>
      )}
      {message && (
        <WebCard className="p-3">
          <div className="text-xs font-semibold" style={{ color: theme.statusOk }}>{message}</div>
        </WebCard>
      )}

      {!selected ? (
        <WebCard className="overflow-hidden">
          <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Active Analyzers</h3>
          </div>
          {data.isLoading ? (
            <div className="px-4 py-8 text-center text-sm" style={{ color: theme.textSecondary }}>Loading authoritative REM analyzers…</div>
          ) : activeAnalyzers.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm" style={{ color: theme.textSecondary }}>No active analyzers are currently recorded.</div>
          ) : (
            <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
              {activeAnalyzers.map((analyzer) => (
                <button
                  key={analyzer._id}
                  type="button"
                  onClick={() => void selectAnalyzer(analyzer._id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
                >
                  <div className="flex-1">
                    <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>{analyzer.serialNumber}</div>
                    <div className="text-xs" style={{ color: theme.textMuted }}>{analyzer.analyzerType}</div>
                  </div>
                  <div className="text-right">
                    <StatusBadge text={analyzer.currentStage || "Unassigned"} color="#6366f1" />
                    <div className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>{Math.round(analyzer.overallPct)}%</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </WebCard>
      ) : (
        <>
          <button
            type="button"
            onClick={() => { setSelectedId(null); setError(null); }}
            className="text-sm font-medium"
            style={{ color: "#6366f1" }}
          >← Back</button>

          <WebCard className="p-4">
            <div className="text-lg font-bold mb-1" style={{ color: theme.textPrimary }}>{selected.serialNumber}</div>
            <div className="text-sm mb-3" style={{ color: theme.textSecondary }}>{selected.analyzerType} · Authoritative stage: {expectedStage || selected.currentStage}</div>
            <ProgressBar value={selected.overallPct} maxValue={100} color="#6366f1" height={8} />
          </WebCard>

          <WebCard className="p-4">
            <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Update Stage</h3>
            <div className="space-y-1.5">
              {STAGES.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  disabled={detailBusy || saveBusy}
                  onClick={() => setNewStage(stage)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all disabled:opacity-50"
                  style={{
                    backgroundColor: newStage === stage ? "#6366f122" : "transparent",
                    border: `1px solid ${newStage === stage ? "#6366f1" : theme.cardBorder}`,
                  }}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: newStage === stage ? "#6366f1" : theme.cardBorder }} />
                  <span className="text-sm" style={{ color: theme.textPrimary }}>{stage}</span>
                  {stage === expectedStage && <span className="ml-auto text-[10px]" style={{ color: theme.textMuted }}>current</span>}
                </button>
              ))}
            </div>
          </WebCard>

          <WebCard className="p-4">
            <label className="text-xs font-semibold" style={{ color: theme.textSecondary }}>Operator Notes</label>
            <textarea
              className="w-full mt-1 px-3 py-2 rounded-xl text-sm border resize-none h-20 disabled:opacity-50"
              style={{ borderColor: theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
              placeholder="Add operational notes…"
              maxLength={4000}
              disabled={detailBusy || saveBusy}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
            <div className="mt-1 text-right text-[10px]" style={{ color: theme.textMuted }}>{notes.length}/4000</div>
          </WebCard>

          <button
            type="button"
            onClick={() => void save()}
            disabled={detailBusy || saveBusy || !hasChange}
            className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: "#6366f1" }}
          >
            {detailBusy ? "Loading authoritative record…" : saveBusy ? "Saving securely…" : `Update to ${newStage || expectedStage}`}
          </button>
        </>
      )}
    </div>
  );
}