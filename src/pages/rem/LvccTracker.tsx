import { useRemCoreData } from "../../hooks/useRemCoreData";
import { WebCard, DashCard, StatusBadge, ProgressBar, theme } from "../../components/vitros/SharedComponents";

export function LvccTracker() {
  const data = useRemCoreData();
  const active = data.lvccItems.filter(l => !l.isComplete);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📋 LVCC Tracker</h2>
        {!data.isLoading && !data.error && <span className="text-[10px] font-bold" style={{ color: theme.statusOk }}>LIVE · {data.lvccItems.length}</span>}
      </div>

      {data.error && (
        <WebCard className="p-4">
          <div className="text-sm font-bold" style={{ color: theme.statusOut }}>REM LVCC data unavailable</div>
          <div className="text-xs mt-1" style={{ color: theme.textSecondary }}>The authoritative REM service could not be read. No empty-data fallback was substituted.</div>
          <button type="button" onClick={() => void data.refresh()} className="mt-3 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>Retry</button>
        </WebCard>
      )}

      <div className="grid grid-cols-2 gap-3">
        <DashCard label="TOTAL" value={data.lvccItems.length} icon="📋" color="#6366f1" />
        <DashCard label="ACTIVE" value={active.length} icon="⚡" color="#f59e0b" />
      </div>

      {data.isLoading && <WebCard className="py-10 text-center"><span className="text-sm" style={{ color: theme.textSecondary }}>Loading authoritative LVCC data…</span></WebCard>}
      {!data.isLoading && !data.error && data.lvccItems.length === 0 && <WebCard className="py-10 text-center"><span className="text-sm" style={{ color: theme.textSecondary }}>No LVCC items are currently recorded.</span></WebCard>}

      {data.lvccItems.map(item => {
        const stages = [
          { name: "Build", pct: item.buildPct },
          { name: "Test", pct: item.testPct },
          { name: "Pack", pct: item.packagingPct },
          { name: "QA", pct: item.qaReleasePct },
          { name: "SAP", pct: item.sapReleasePct },
        ];
        return (
          <WebCard key={item._id || item.serialNumber} className="p-4">
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
