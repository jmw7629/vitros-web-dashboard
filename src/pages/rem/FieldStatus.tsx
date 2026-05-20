import { useMemo } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, StatusBadge, theme } from "../../components/vitros/SharedComponents";

export function FieldStatus() {
  const data = useConvexData();

  const completed = data.analyzers.filter(a => a.isComplete);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>🌍 Field Status</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Analyzers released to the field</p>
      </div>

      <DashCard label="RELEASED" value={completed.length} icon="🌍" color={theme.statusOk} />

      <WebCard className="overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Completed Analyzers</h3>
        </div>
        {completed.length === 0 ? (
          <div className="py-8 text-center text-sm" style={{ color: theme.textSecondary }}>No completed analyzers yet</div>
        ) : (
          <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
            {completed.map(a => (
              <div key={a.serialNumber} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1">
                  <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>{a.serialNumber}</div>
                  <div className="text-xs" style={{ color: theme.textMuted }}>{a.analyzerType}</div>
                </div>
                <StatusBadge text="Complete" color={theme.statusOk} />
              </div>
            ))}
          </div>
        )}
      </WebCard>
    </div>
  );
}
