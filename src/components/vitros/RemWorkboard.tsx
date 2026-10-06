import { RemProgressSummary } from './RemProgressSummary';
import { CreateAnalyzerDialog } from './CreateAnalyzerDialog';
import { useAction } from 'convex/react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import { analyzerKind, boardStage, LVCC_TYPES, progressStages, type RemKind } from '../../../convex/remProgressContract';
import { useRemCoreData } from '../../hooks/useRemCoreData';
import type { REMAnalyzer, LVCCItem } from '../../hooks/useConvexData';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { theme } from './SharedComponents';
import { RemProgressDialog, remInputStyle } from './RemProgressDialog';
import { RemOperationalRecords } from './RemOperationalRecords';

type Row = REMAnalyzer | LVCCItem;
type View = 'tracker' | 'kanban';

const PRODUCTS: { value: RemKind; label: string }[] = [
  { value: 'analyzer', label: 'VITROS' },
  { value: 'vision', label: 'VISION' },
  { value: 'lvcc', label: 'LVCC / 450' },
];
const VIEWS: { value: View; label: string }[] = [
  { value: 'tracker', label: 'Tracker' },
  { value: 'kanban', label: 'Kanban' },
];

function typeOf(row: Row) { return 'analyzerType' in row ? row.analyzerType : row.itemType ?? 'LVCC'; }
function pct(row: Row, key: string) { const value = row.stageProgress?.[key] ?? null; return value === null ? 'Unreported' : `${value}%`; }

function SegmentedControl<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return <div className={label === 'Product' ? 'min-w-0 flex-1' : 'min-w-0 sm:w-56'}><div className="text-xs font-semibold text-slate-400 mb-1.5">{label}</div><div role="group" aria-label={label} className="grid gap-1 rounded-lg border border-slate-600 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map(o => <button key={o.value} type="button" aria-pressed={value === o.value} className={`rounded-md min-h-11 px-2 py-1.5 text-sm whitespace-nowrap ${value === o.value ? 'border border-indigo-400 bg-indigo-500/20' : 'border border-slate-600 hover:border-indigo-400'}`} onClick={() => onChange(o.value)}>{o.label}</button>)}
  </div></div>;
}

export function RemWorkboard({ initialKind = 'analyzer', initialView = 'tracker', kiosk = false, lvccOnly = false }: { initialKind?: RemKind; initialView?: View; kiosk?: boolean; lvccOnly?: boolean }) {
  const data = useRemCoreData();
  const [kind, setKind] = useState<RemKind>(initialKind);
  const [view, setView] = useState<View>(initialView);
  const [search, setSearch] = useState('');
  const [model, setModel] = useState('');
  const [includeComplete, setIncludeComplete] = useState(!kiosk);
  const [selected, setSelected] = useState<{ id: string; title: string } | null>(null);
  const [roster, setRoster] = useState<{ title: string; ids: string[] } | null>(null);
  const [createLvcc, setCreateLvcc] = useState(false);
  const [createAnalyzer, setCreateAnalyzer] = useState<'VITROS' | 'VISION' | null>(null);

  const stages = progressStages(kind);
  const all: Row[] = kind === 'lvcc' ? data.lvccItems : data.analyzers.filter(r => analyzerKind(r.analyzerType) === kind);
  const rows = all.filter(r => (includeComplete || !r.isComplete) && (!model || typeOf(r) === model) && `${r.serialNumber} ${typeOf(r)}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));
  const stageOf = (r: Row) => boardStage(r.currentStage, !!r.isComplete, kind);
  const known = [...stages.map(s => s.label), 'Complete'];
  const columns = [...known, ...new Set(rows.map(stageOf).filter(s => !known.includes(s)))];
  const registerLabel = kind === 'lvcc' ? 'Register LVCC unit' : kind === 'vision' ? 'Register VISION analyzer' : 'Register VITROS analyzer';
  const emptyLabel = kind === 'lvcc' ? 'LVCC units' : kind === 'vision' ? 'VISION analyzers' : 'VITROS analyzers';

  const switchProduct = (next: RemKind) => { setKind(next); setRoster(null); setSelected(null); setSearch(''); setModel(''); };
  const open = (r: Row) => { setRoster(null); setSelected({ id: r._id, title: r.serialNumber }); };
  const show = (title: string, list: Row[]) => setRoster({ title, ids: list.map(r => r._id) });
  const register = () => { if (kind === 'lvcc') setCreateLvcc(true); else setCreateAnalyzer(kind === 'vision' ? 'VISION' : 'VITROS'); };
  const itemCard = (r: Row) => <button type="button" key={r._id} onClick={() => open(r)} className="w-full text-left rounded-xl p-3 border border-slate-600 hover:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-400" style={{ backgroundColor: theme.cardBg }}><div className="font-semibold">{r.serialNumber}</div><div className="text-xs text-slate-400 mb-2">{typeOf(r)} · {stageOf(r)}</div>{'assignedTo' in r && r.assignedTo && <div className="text-xs text-slate-400 mb-2">Assigned to {r.assignedTo}</div>}<RemProgressSummary kind={kind} progress={r.stageProgress} /><div className="text-xs text-slate-400 mt-2">Open progress & history →</div></button>;

  const counters = <div className="grid grid-cols-3 gap-2">{[{ label: 'Total records', list: all }, { label: 'Active', list: all.filter(r => !r.isComplete) }, { label: 'Complete', list: all.filter(r => r.isComplete) }].map(c => <button key={c.label} className="rounded-xl border border-slate-600 p-3 text-left hover:border-indigo-400" style={{ backgroundColor: theme.cardBg }} onClick={() => show(c.label, c.list)}><div className="text-sm text-slate-400">{c.label}</div><strong className="text-2xl">{c.list.length}</strong></button>)}</div>;

  const lvccWhiteboard = kind === 'lvcc' && <section className="grid md:grid-cols-2 gap-4" aria-label="LVCC whiteboard"><h3 className="sr-only">LVCC whiteboard</h3>{['Electrometer', 'IR Wash'].map(group => { const units = rows.filter(r => typeOf(r).toLowerCase().includes(group.toLowerCase())); return <div key={group} className="rounded-xl border border-slate-600 p-4"><button className="text-lg font-bold underline decoration-indigo-400 underline-offset-4" onClick={() => show(group, units)}>{group}</button><div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">{stages.map(s => <button key={s.key} className="rounded-lg border border-slate-600 p-2 hover:border-indigo-400" onClick={() => show(`${group} · ${s.label}`, units.filter(r => stageOf(r) === s.label))}><span className="block text-xs text-slate-400">{s.label.replace('Packaging', 'Pack').replace('SAP Release', 'SAP').replace('QA Release', 'QA')}</span><strong>{units.filter(r => stageOf(r) === s.label).length}</strong></button>)}</div>{group === 'IR Wash' && <div className="flex gap-3 mt-3">{['Pump', 'Module'].map(sub => <button key={sub} className="text-sm underline" onClick={() => show(`IR Wash · ${sub}`, units.filter(r => typeOf(r).includes(sub)))}>{sub} ({units.filter(r => typeOf(r).includes(sub)).length})</button>)}</div>}</div>; })}</section>;

  const board = view === 'kanban'
    ? <div className="overflow-x-auto pb-3"><div className="flex gap-3 min-w-max">{columns.map(s => { const list = rows.filter(r => stageOf(r) === s); return <section key={s} className="w-64 rounded-xl border border-slate-600 p-3"><button className="w-full text-left font-semibold mb-3" onClick={() => show(s, list)}>{s} <span className="float-right text-slate-400">{list.length}</span></button><div className="space-y-2">{list.map(itemCard)}{list.length === 0 && <button className="w-full text-sm text-slate-400 py-5" onClick={() => show(s, [])}>No units in this stage</button>}</div></section>; })}</div></div>
    : <div className="space-y-3">{rows.map(r => <section key={r._id} className="rounded-xl border border-slate-600 p-3">{itemCard(r)}<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">{stages.map(s => <button key={s.key} onClick={() => open(r)} className="rounded-lg border border-slate-600 p-2 text-left hover:border-indigo-400"><span className="block text-xs text-slate-400">{s.label}</span><span className="font-semibold">{pct(r, s.key)}</span></button>)}</div></section>)}{rows.length === 0 && <p className="py-8 text-center text-slate-400">No matching {emptyLabel}. Register an actual unit to start tracking.</p>}</div>;

  return <div className="space-y-4" style={{ color: theme.textPrimary }}>
    <div className="flex flex-wrap justify-between items-center gap-3"><div><h2 className="text-xl font-bold">{kiosk ? 'Engineer Kiosk' : lvccOnly ? 'LVCC / 450' : view === 'kanban' ? 'REM Kanban' : 'REM Tracker'}</h2><p className="text-sm text-slate-400">Select a unit or stage to review and update progress.</p></div><button className="rounded-lg bg-indigo-600 text-white px-4 py-2" onClick={register}>{registerLabel}</button></div>
    <div className="flex flex-col sm:flex-row sm:items-end gap-3">{!lvccOnly && <SegmentedControl label="Product" options={PRODUCTS} value={kind} onChange={switchProduct} />}<SegmentedControl label="View" options={VIEWS} value={view} onChange={setView} /></div>
    <div className="flex flex-col sm:flex-row sm:items-center gap-3"><input aria-label="Search units" className="w-full sm:flex-1 sm:min-w-48 rounded-lg px-3 py-2" style={remInputStyle} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search serial, type or module…" />{kind === 'analyzer' && <select aria-label="Filter model" value={model} onChange={e => setModel(e.target.value)} className="rounded-lg min-h-11 px-3 py-2" style={remInputStyle}><option value="">All models</option>{['3600', '5600', '7600'].map(m => <option key={m} value={m}>{m}</option>)}</select>}<label className="text-sm flex items-center gap-2"><input type="checkbox" checked={includeComplete} onChange={e => setIncludeComplete(e.target.checked)} />Include completed</label></div>
    {data.error && <div role="alert" className="border border-red-500 rounded-lg p-3">Progress data unavailable. {data.error}<button onClick={() => void data.refresh()} className="ml-3 underline">Retry</button></div>}
    {data.isLoading ? <p role="status">Loading production records…</p> : data.error ? null : <>{counters}{lvccWhiteboard}{board}</>}
    {lvccOnly && <RemOperationalRecords dataset="lvcc_reviews" title="LVCC DHR Reviews" />}
    {roster && <Dialog open onOpenChange={o => { if (!o) setRoster(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto" style={{ backgroundColor: theme.pageBg, color: theme.textPrimary }}><DialogHeader><DialogTitle>{roster.title}</DialogTitle><DialogDescription>{roster.ids.length} records. Select a unit for percentages and update history.</DialogDescription></DialogHeader><div className="space-y-2">{all.filter(r => roster.ids.includes(r._id)).map(itemCard)}{roster.ids.length === 0 && <p>No units recorded for this selection.</p>}</div></DialogContent></Dialog>}
    {selected && <RemProgressDialog key={`${kind}:${selected.id}`} kind={kind} recordId={selected.id} title={selected.title} onClose={() => setSelected(null)} onSaved={() => void data.refresh()} />}
    {createLvcc && <CreateLvccDialog onClose={() => setCreateLvcc(false)} onSaved={r => { setCreateLvcc(false); void data.refresh(); setSelected(r); }} />}
    {createAnalyzer && <CreateAnalyzerDialog family={createAnalyzer} onClose={() => setCreateAnalyzer(null)} onSaved={r => { setCreateAnalyzer(null); void data.refresh(); setSelected(r); }} />}
  </div>;
}

function CreateLvccDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (r: { id: string; title: string }) => void }) {
  const directory = useAction(api.remProgressActions.listEngineers); const create = useAction(api.remProgressActions.createLvcc);
  const [engineers, setEngineers] = useState<{ id: string; name: string; initials: string }[]>([]); const [engineerId, setEngineer] = useState(''); const [serialNumber, setSerial] = useState(''); const [itemType, setType] = useState<string>(LVCC_TYPES[0]); const [batchNumber, setBatch] = useState(''); const [notes, setNotes] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const pending = useRef<Parameters<typeof create>[0] | null>(null); const saving = useRef(false);
  useEffect(() => { let alive = true; void directory().then(r => { if (alive) setEngineers(r); }).catch(() => { if (alive) setError('Unable to load active engineers'); }); return () => { alive = false; }; }, [directory]);
  async function save() { if (saving.current) return; saving.current = true; setBusy(true); setError(''); try { pending.current ??= { serialNumber: serialNumber.trim(), itemType, batchNumber: batchNumber.trim(), notes, engineerId, correlationId: `lvcc-create:${crypto.randomUUID()}` }; const result = await create(pending.current); onSaved({ id: result.record.id, title: result.record.serialNumber }); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to register unit'); } finally { saving.current = false; setBusy(false); } }
  return <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}><DialogContent style={{ backgroundColor: theme.pageBg, color: theme.textPrimary }}><DialogHeader><DialogTitle>Register LVCC unit</DialogTitle><DialogDescription>One record per actual serial or unique unit identifier. No quantities are imported from the photos.</DialogDescription></DialogHeader><fieldset disabled={busy || !!pending.current} className="space-y-3">{[{ label: 'Serial / unit identifier', value: serialNumber, set: setSerial }, { label: 'Batch (optional)', value: batchNumber, set: setBatch }].map(f => <label key={f.label} className="block text-sm">{f.label}<input maxLength={120} value={f.value} onChange={e => f.set(e.target.value)} className="block p-2 w-full rounded-lg mt-1" style={remInputStyle} /></label>)}<label className="block text-sm">Type<select value={itemType} onChange={e => setType(e.target.value)} className="block p-2 w-full rounded-lg mt-1" style={remInputStyle}>{LVCC_TYPES.map(t => <option key={t}>{t}</option>)}</select></label><label className="block text-sm">Engineer (required)<select aria-label="Engineer" value={engineerId} onChange={e => setEngineer(e.target.value)} className="block p-2 w-full rounded-lg mt-1" style={remInputStyle}><option value="">Select engineer…</option>{engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label className="block text-sm">Notes<textarea maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} className="block p-2 w-full rounded-lg mt-1" style={remInputStyle} /></label></fieldset>{error && <div role="alert">{error}<button className="block underline" onClick={() => { pending.current = null; setError(''); }}>Edit request</button></div>}<button className="rounded-lg bg-indigo-600 text-white p-3 disabled:opacity-40" disabled={busy || !serialNumber.trim() || !engineerId} onClick={() => void save()}>{busy ? 'Registering…' : pending.current ? 'Retry registration' : 'Register unit'}</button></DialogContent></Dialog>;
}
