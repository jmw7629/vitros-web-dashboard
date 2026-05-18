import { useMemo } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, StatusBadge, theme } from "../../components/vitros/SharedComponents";

export function WeeklyNotes() {
  const data = useConvexData();

  const notes = useMemo(() => {
    return [...(data.weeklyNotes || [])].sort((a, b) => b.weekNumber - a.weekNumber);
  }, [data.weeklyNotes]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📝 Weekly Notes</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Production notes, issues, and decisions</p>
      </div>

      {notes.length === 0 ? (
        <WebCard className="py-10 text-center">
          <div className="text-3xl mb-2">📝</div>
          <div className="text-sm" style={{ color: theme.textSecondary }}>No weekly notes yet</div>
        </WebCard>
      ) : (
        notes.map((note, i) => (
          <WebCard key={i} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>Week {note.weekNumber}</span>
              <StatusBadge text={note.quarter} color="#8b5cf6" />
              <span className="ml-auto text-[10px]" style={{ color: theme.textMuted }}>{note.weekStart}</span>
            </div>
            {note.notes && note.notes.map((n: any, j: number) => (
              <div key={j} className="py-1.5 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
                {n.product && <StatusBadge text={n.product} color="#6366f1" />}
                <p className="text-sm mt-1" style={{ color: theme.textPrimary }}>{n.content}</p>
              </div>
            ))}
          </WebCard>
        ))
      )}
    </div>
  );
}
