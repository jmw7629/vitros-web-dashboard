import { useAction } from 'convex/react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import { progressStages, validateProgress, type RemKind } from '../../../convex/remProgressContract';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { theme } from './SharedComponents';

export type ProgressRecord = {id:string;serialNumber:string;itemType:string;currentStage:string;revision:number;notes:string;progress:Record<string,number|null>;updatedAt:string|null;engineerName:string|null};
type Detail = {record:ProgressRecord;engineers:{id:string;name:string;initials:string}[];canWrite:boolean;history:{id:string;engineerName:string;createdAt:string;stage:string;progress:Record<string,number|null>;notes:string}[]};
export const remInputStyle = {backgroundColor:theme.cardBg,color:theme.textPrimary,border:`1px solid ${theme.cardBorder}`};
const stamp = (s:string|null) => s ? new Date(s).toLocaleString() : 'No progress update yet';
export function RemProgressDialog({kind,recordId,title,onClose,onSaved}:{kind:RemKind;recordId:string;title?:string;onClose:()=>void;onSaved?:()=>void}) {
  const getDetail=useAction(api.remProgressActions.getDetail);
  const update=useAction(api.remProgressActions.updateProgress);
  const [detail,setDetail]=useState<Detail|null>(null);
  const [progress,setProgress]=useState<Record<string,number|null>>({});
  const [stage,setStage]=useState('');const [notes,setNotes]=useState('');const [engineerId,setEngineerId]=useState('');
  const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [message,setMessage]=useState('');
  const [pending,setPending]=useState<Parameters<typeof update>[0]|null>(null);
  const alive=useRef(true); const saving=useRef(false);
  const stages=progressStages(kind);
  const load=async()=>{
    setLoading(true);setError('');
    try {const d=await getDetail({kind,recordId});if(!alive.current)return;setDetail(d);setProgress(d.record.progress);setStage(d.record.currentStage);setNotes(d.record.notes);setEngineerId('');}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:'Unable to load progress');}
    finally{if(alive.current)setLoading(false);}
  };
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[kind,recordId]);
  const save=async()=>{
    if(!detail||saving.current||!engineerId)return;
    saving.current=true;setBusy(true);setError('');setMessage('');
    try {
      validateProgress(kind,progress,stage);
      const command=pending??{kind,recordId,expectedRevision:detail.record.revision,engineerId,stage,progress,notes,correlationId:`rem-progress:${crypto.randomUUID()}`};
      setPending(command);
      const receipt=await update(command);
      if(!alive.current)return;
      setPending(null);setMessage(`Saved by ${receipt.record.engineerName} · ${stamp(receipt.createdAt)}`);
      await load();onSaved?.();
    } catch(e){if(alive.current)setError(e instanceof Error?e.message:'Save failed. Retry the same update.');}
    finally {saving.current=false;if(alive.current)setBusy(false);}
  };
  const changed=detail && (stage!==detail.record.currentStage||notes!==detail.record.notes||JSON.stringify(progress)!==JSON.stringify(detail.record.progress));
  const canEdit=!!detail?.canWrite&&!busy&&!loading&&!pending;
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="sm:max-w-3xl max-h-[90dvh] overflow-y-auto" style={{backgroundColor:theme.pageBg,color:theme.textPrimary}}>
    <DialogHeader><DialogTitle>{title??detail?.record.serialNumber??'REM progress'}</DialogTitle><DialogDescription>Update each stage independently. Select the engineer making this update. SAP progress is tracking only.</DialogDescription></DialogHeader>
    {loading&&<p role="status">Loading current progress…</p>}
    {error&&<div role="alert" className="rounded-lg border border-red-500 p-3 text-sm">{error}<button className="block mt-2 underline" disabled={busy} onClick={()=>{setPending(null);void load();}}>Reload latest record and discard draft</button></div>}
    {message&&<p role="status" className="text-emerald-400">{message}</p>}
    {detail&&<>
      <p className="text-sm text-slate-400">{detail.record.itemType} · Revision {detail.record.revision}<br/>{detail.record.engineerName??'Imported record'} · {stamp(detail.record.updatedAt)}</p>
      <fieldset disabled={!canEdit} className="space-y-4 disabled:opacity-70">
        <label className="block text-sm font-semibold">Engineer (required)<select aria-label="Engineer" required className="block w-full rounded-lg p-3 mt-1" style={remInputStyle} value={engineerId} onChange={e=>setEngineerId(e.target.value)}><option value="">Select engineer…</option>{detail.engineers.map(e=><option key={e.id} value={e.id}>{e.name} ({e.initials})</option>)}</select></label>
        {detail.engineers.length===0&&<p role="alert">No active engineers are available. An administrator must activate an engineer.</p>}
        <label className="block text-sm font-semibold">Current stage<select aria-label="Current stage" className="block w-full rounded-lg p-3 mt-1" style={remInputStyle} value={stage} onChange={e=>setStage(e.target.value)}>{!stages.some(s=>s.label===stage)&&stage!=='Complete'&&<option value={stage}>{stage||'Unassigned'}</option>}{stages.map(s=><option key={s.key} value={s.label}>{kind==='lvcc'?s.label.replace('Packaging','Pack').replace('SAP Release','SAP'):s.label}</option>)}<option>Complete</option></select></label>
        <div className="grid sm:grid-cols-2 gap-3">{stages.map(s=><label key={s.key} className="block rounded-xl border border-slate-600 p-3"><span className="text-sm font-semibold">{s.label}</span><div className="flex items-center gap-2 mt-2"><input aria-label={`${s.label} percentage`} type="number" min={0} max={100} step={1} placeholder="Unreported" value={progress[s.key]??''} onChange={e=>setProgress(p=>({...p,[s.key]:e.target.value===''?null:Number(e.target.value)}))} className="w-24 p-2 rounded-lg" style={remInputStyle}/><span>%</span></div><input aria-label={`${s.label} progress slider`} className="w-full mt-3 accent-indigo-500" type="range" min={0} max={100} step={1} value={progress[s.key]??0} onChange={e=>setProgress(p=>({...p,[s.key]:Number(e.target.value)}))}/></label>)}</div>
        <p className="text-xs text-slate-400">Blank means unreported. Choosing a stage does not change its percentage. Complete requires all stages at 100%.</p>
        <label className="block text-sm font-semibold">Operator notes<textarea aria-label="Operator notes" className="w-full rounded-lg p-3 mt-1 min-h-24" style={remInputStyle} value={notes} maxLength={4000} onChange={e=>setNotes(e.target.value)}/></label>
      </fieldset>
      {detail.canWrite&&<button type="button" className="rounded-lg px-4 py-3 bg-indigo-600 text-white font-semibold disabled:opacity-40" disabled={busy||loading||!engineerId||(!changed&&!pending)} onClick={()=>void save()}>{busy?'Saving…':pending?'Retry same update':'Save progress'}</button>}
      {!detail.canWrite&&<p>Read-only access. Your role cannot update REM progress.</p>}
      <section><h3 className="font-semibold mb-2">Update history <span className="text-xs text-slate-400">(latest 50)</span></h3>{detail.history.length===0?<p className="text-sm text-slate-400">No attributed progress updates yet.</p>:detail.history.map(event=><details key={event.id} className="border-t border-slate-600 py-3"><summary className="cursor-pointer text-sm">{event.engineerName} · {stamp(event.createdAt)} · {event.stage}</summary><dl className="grid grid-cols-2 gap-2 text-xs mt-2">{stages.map(s=><div key={s.key}><dt>{s.label}</dt><dd>{event.progress[s.key]===null?'Unreported':`${event.progress[s.key]}%`}</dd></div>)}</dl>{event.notes&&<p className="text-sm whitespace-pre-wrap mt-2">{event.notes}</p>}</details>)}</section>
      <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-500 p-3">Close</button>
    </>}
  </DialogContent></Dialog>;
}
