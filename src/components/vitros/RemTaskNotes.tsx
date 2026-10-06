import { useAction } from 'convex/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import { progressStages, type RemKind } from '../../../convex/remProgressContract';
import { theme } from './SharedComponents';

export type TaskNote = { id: string; stage: string; content: string; engineerName: string; createdAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null };
type Engineer = { id: string; name: string; initials: string };
type AddCommand = { stage: string; content: string; engineerId: string; correlationId: string };
type AckCommand = { noteId: string; engineerId: string; correlationId: string };
const inputStyle = { backgroundColor: theme.cardBg, color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` };
const stamp = (s: string) => new Date(s).toLocaleString();
const sortNotes = (list: TaskNote[]) => [...list].sort((a, b) => {
  const ap = a.acknowledgedAt ? 1 : 0; const bp = b.acknowledgedAt ? 1 : 0;
  if (ap !== bp) return ap - bp;
  return b.createdAt.localeCompare(a.createdAt);
});
const safeError = (e: unknown, fallback: string) => {
  const data = (e as { data?: unknown } | null)?.data;
  if (typeof data === 'string' && data.trim()) return data;
  if (e instanceof Error && e.message.trim()) return e.message;
  return fallback;
};

export function RemTaskNotes({ kind, recordId, initialStage = '', onChanged }: { kind: RemKind; recordId: string; initialStage?: string; onChanged?: () => void }) {
  const listNotes = useAction(api.remProgressActions.listTaskNotes);
  const addNote = useAction(api.remProgressActions.addTaskNote);
  const acknowledgeNote = useAction(api.remProgressActions.acknowledgeTaskNote);
  const [notes, setNotes] = useState<TaskNote[] | null>(null);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [stage, setStage] = useState(initialStage);
  const [content, setContent] = useState('');
  const [noteEngineerId, setNoteEngineerId] = useState('');
  const [ackEngineerId, setAckEngineerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<AddCommand | null>(null);
  const [pendingAck, setPendingAck] = useState<AckCommand | null>(null);
  const alive = useRef(true); const saving = useRef(false);
  const stages = progressStages(kind);
  const stageOptions = stages.some(s => s.label === stage) ? stages.map(s => s.label) : stage ? [stage, ...stages.map(s => s.label)] : stages.map(s => s.label);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await listNotes({ kind, recordId });
      if (!alive.current) return;
      setNotes(result.notes); setEngineers(result.engineers); setCanWrite(result.canWrite);
    } catch (e) { if (alive.current) setError(safeError(e, 'Unable to load task notes')); }
    finally { if (alive.current) setLoading(false); }
  }, [kind, recordId, listNotes]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  const add = async () => {
    if (saving.current || !content.trim() || !noteEngineerId) return;
    saving.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const command = pendingAdd ?? { stage, content: content.trim(), engineerId: noteEngineerId, correlationId: `rem-note:${crypto.randomUUID()}` };
      setPendingAdd(command);
      const receipt = await addNote({ kind, recordId, ...command });
      if (!alive.current) return;
      setPendingAdd(null);
      setNotes(prev => sortNotes([receipt.note, ...(prev ?? []).filter(n => n.id !== receipt.note.id)]));
      if (receipt.duplicate) setMessage('This task note was already recorded.');
      else setMessage(`Task note added by ${receipt.note.engineerName}.`);
      setContent(''); setNoteEngineerId('');
      onChanged?.(); await load();
    } catch (e) { if (alive.current) setError(safeError(e, 'Unable to add task note. Retry the same note.')); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  };
  const acknowledge = async (noteId: string) => {
    if (saving.current || !ackEngineerId || !notes?.some(n => n.id === noteId)) return;
    saving.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const command = pendingAck?.noteId === noteId ? pendingAck : { noteId, engineerId: ackEngineerId, correlationId: `rem-note-ack:${crypto.randomUUID()}` };
      if (pendingAck?.noteId !== noteId) setPendingAck(command);
      const receipt = await acknowledgeNote({ kind, recordId, ...command });
      if (!alive.current) return;
      setPendingAck(null);
      setNotes(prev => sortNotes((prev ?? []).map(n => n.id === receipt.note.id ? receipt.note : n)));
      setMessage(`Task note acknowledged by ${receipt.note.acknowledgedBy}.`);
      setAckEngineerId(''); onChanged?.(); await load();
    } catch (e) {
      if (!alive.current) return;
      const text = safeError(e, 'Unable to acknowledge task note');
      if (/already acknowledged/i.test(text)) { setPendingAck(null); setError(`${text} Reload notes to see the latest state.`); }
      else setError(`${text} Retry the same acknowledgment.`);
    } finally { saving.current = false; if (alive.current) setBusy(false); }
  };
  const locked = busy || loading || !!pendingAdd || !!pendingAck;
  const canAdd = canWrite && !!stage && !!content.trim() && !!noteEngineerId && !locked;
  return <section aria-label="Task notes" className="space-y-3">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Task notes</h3><button type="button" className="min-h-11 px-3 rounded-lg underline text-sm disabled:opacity-40" disabled={busy || loading} onClick={()=>void load()}>Reload notes</button></div>
    {loading && <p role="status" className="text-sm text-slate-400">Loading task notes…</p>}
    {(error || pendingAdd || pendingAck) && <div role={error ? "alert" : "status"} className="rounded-lg border border-red-500 p-3 text-sm">{error}
      <div className="flex flex-wrap gap-2 mt-2">
        {pendingAdd && <button type="button" className="min-h-11 px-3 rounded-lg underline disabled:opacity-40" disabled={busy} onClick={() => void add()}>Retry note</button>}
        {pendingAck && <button type="button" className="min-h-11 px-3 rounded-lg underline disabled:opacity-40" disabled={busy} onClick={() => void acknowledge(pendingAck.noteId)}>Retry acknowledgment</button>}
        {pendingAdd && <button type="button" className="min-h-11 px-3 rounded-lg underline" disabled={busy} onClick={()=>{setPendingAdd(null);setError('');}}>Edit note request</button>}
      </div>
    </div>}
    {message && <p role="status" className="text-sm text-emerald-400">{message}</p>}
    {notes && canWrite && <div className="space-y-3"><fieldset disabled={locked} className="space-y-3 disabled:opacity-70">
      <label className="block text-sm font-semibold">Task<select aria-label="Task" className="block w-full rounded-lg p-3 mt-1 min-h-11" style={inputStyle} value={stage} onChange={e => setStage(e.target.value)}>{stageOptions.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
      <label className="block text-sm font-semibold">New task note<textarea aria-label="New task note" className="w-full rounded-lg p-3 mt-1 min-h-24" style={inputStyle} value={content} maxLength={4000} onChange={e => setContent(e.target.value)} /></label>
      <label className="block text-sm font-semibold">Note engineer<select aria-label="Note engineer" className="block w-full rounded-lg p-3 mt-1 min-h-11" style={inputStyle} value={noteEngineerId} onChange={e => setNoteEngineerId(e.target.value)}><option value="">Select engineer…</option>{engineers.map(e => <option key={e.id} value={e.id}>{e.name} ({e.initials})</option>)}</select></label>
      </fieldset><button type="button" className="min-h-11 px-4 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-40" disabled={!canAdd} onClick={() => void add()}>Add task note</button>
    </div>}
    {canWrite && notes?.some(n=>!n.acknowledgedAt) && <label className="block text-sm font-semibold">Acknowledging engineer<select disabled={locked} aria-label="Acknowledging engineer" className="block w-full rounded-lg p-3 mt-1 min-h-11" style={inputStyle} value={ackEngineerId} onChange={e => setAckEngineerId(e.target.value)}><option value="">Select engineer…</option>{engineers.map(e => <option key={e.id} value={e.id}>{e.name} ({e.initials})</option>)}</select></label>}
    {!loading && !error && !canWrite && <p className="text-sm text-slate-400">Read-only access. Your role cannot write task notes.</p>}
    {notes && (notes.length === 0
      ? <p className="text-sm text-slate-400">No task notes for this record.</p>
      : <ul className="space-y-2">{notes.map(note => <li key={note.id} className="rounded-lg border border-slate-600 p-3" style={{ backgroundColor: theme.cardBg }}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-semibold min-w-0" style={{ color: note.acknowledgedAt ? theme.textMuted : theme.warning }}>{note.stage} · {note.acknowledgedAt ? 'Acknowledged' : 'Pending'}</span>
          {canWrite && !note.acknowledgedAt && <button type="button" className="min-h-11 px-3 rounded-lg text-xs font-semibold disabled:opacity-40 shrink-0" disabled={!ackEngineerId || locked} onClick={() => void acknowledge(note.id)}>Acknowledge</button>}
        </div>
        <p className="text-sm whitespace-pre-wrap break-words mt-1">{note.content}</p>
        <p className="text-xs text-slate-400 mt-1">{note.engineerName} · {stamp(note.createdAt)}</p>
        {note.acknowledgedAt && <p className="text-xs mt-1" style={{ color: theme.statusOk }}>Acknowledged by {note.acknowledgedBy} · {stamp(note.acknowledgedAt)}</p>}
      </li>)}</ul>)}
  </section>;
}
