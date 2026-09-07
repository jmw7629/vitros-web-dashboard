import { useRemCoreData } from "../../hooks/useRemCoreData";
import { WebCard, DashCard, StatusBadge, theme } from "../../components/vitros/SharedComponents";

export function FieldStatus() {
  const data = useRemCoreData();
  const completed = data.analyzers.filter((analyzer) => analyzer.isComplete);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>🌍 Field Status</h2>
          <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Analyzers released to the field</p>
        </div>
        {!data.isLoading && !data.error && <span className="text-[10px] font-bold" style={{ color: theme.statusOk }}>LIVE · SUPABASE</span>}
      </div>

      {data.error && (
        <WebCard className="p-4">
          <div className="text-sm font-bold" style={{ color: theme.statusOut }}>REM field status unavailable</div>
          <div className="mt-1 text-xs" style={{ color: theme.textSecondary }}>The authoritative REM service could not be read. No legacy fallback was substituted.</div>
          <button type="button" onClick={() => void data.refresh()} className="mt-3 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>Retry</button>
        </WebCard>
      )}

      <DashCard label="RELEASED" value={completed.length} icon="🌍" color={theme.statusOk} />

      <WebCard className="overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Completed Analyzers</h3>
        </div>
        {data.isLoading ? (
          <div className="py-8 text-center text-sm" style={{ color: theme.textSecondary }}>Loading authoritative REM releases…</div>
        ) : !data.error && completed.length === 0 ? (
          <div className="py-8 text-center text-sm" style={{ color: theme.textSecondary }}>No completed analyzers yet</div>
        ) : !data.error ? (
          <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
            {completed.map((analyzer) => (
              <div key={analyzer.serialNumber} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1">
                  <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>{analyzer.serialNumber}</div>
                  <div className="text-xs" style={{ color: theme.textMuted }}>{analyzer.analyzerType}</div>
                </div>
                <StatusBadge text="Complete" color={theme.statusOk} />
              </div>
            ))}
          </div>
        ) : null}
      </WebCard>
    </div>
  );
}