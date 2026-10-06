import { progressStages, reportedOverall, type RemKind } from '../../../convex/remProgressContract';
import { ProgressBar } from './SharedComponents';

export function RemProgressSummary({ kind, progress }: { kind: RemKind; progress?: Record<string, number | null> }) {
  const stages = progressStages(kind);
  const values = progress ?? {};
  const overall = reportedOverall(kind, values);
  const reported = stages.filter(s => typeof values[s.key] === 'number').length;
  return overall === null ? (
    <span className="text-xs text-slate-400">{reported} of {stages.length} stages reported · overall unreported</span>
  ) : (
    <div className="flex items-center gap-2">
      <div className="flex-1"><ProgressBar value={overall} maxValue={100} color="#818cf8" height={5} /></div>
      <span className="text-xs">{Math.round(overall)}%</span>
    </div>
  );
}
