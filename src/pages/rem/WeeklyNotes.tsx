import { useMemo } from "react";
import { useRemCoreData } from "../../hooks/useRemCoreData";
import { WebCard, StatusBadge, theme } from "../../components/vitros/SharedComponents";

export function WeeklyNotes() {
  const data = useRemCoreData();

  const notes = useMemo(() => {
    return [...(data.weeklyNotes || [])].sort((a, b) => b.weekNumber - a.weekNumber);
  }, [data.weeklyNotes]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📝 Weekly Notes</h2>
          <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Production notes, issues, and decisions</p>
        </div>
        {!data.isLoading && !data.error && <span className="text-[10px] font-bold" style={{ color: theme.statusOk }}>LIVE · {notes.length}</span>}
      </div>

      {data.error ? (
        <WebCard className="p-4">
          <div className="text-sm font-bold" style={{ color: theme.statusDanger }}>REM notes unavailable</div>
          <div className="text-xs mt-1" style={{ color: theme.textSecondary }}>The authoritative REM service could not be read. No empty-data fallback was substituted.</div>
          <button type="button" onClick={() => void data.refresh()} className="mt-3 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>Retry</button>
        </WebCard>
      ) : data.isLoading ? (
        <WebCard className="py-10 text-center">
          <div className="text-sm" style={{ color: theme.textSecondary }}>Loading authoritative REM notes…</div>
        </WebCard>
      ) : notes.length === 0 ? (
        <WebCard className="py-10 text-center">
          <div className="text-3xl mb-2">📝</div>
          <div className="text-sm" style={{ color: theme.textSecondary }}>No weekly notes are currently recorded.</div>
        </WebCard>
      ) : (
        notes.map(note => (
          <WebCard key={note._id || `${note.weekStart}-${note.weekNumber}`} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>Week {note.weekNumber}</span>
              <StatusBadge text={note.quarter} color="#8b5cf6" />
              <span className="ml-auto text-[10px]" style={{ color: theme.textMuted }}>{note.weekStart}</span>
            </div>
            {note.notes.map((n, j) => (
              <div key={`${note._id || note.weekStart}-${j}`} className="py-1.5 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
                {n.product && <StatusBadge text={n.product} color="#6366f1" />}
                <p className="text-sm mt-1 whitespace-pre-wrap" style={{ color: theme.textPrimary }}>{n.content}</p>
              </div>
            ))}
          </WebCard>
        ))
      )}
    </div>
  );
}
