import { useState, type ReactNode, type CSSProperties } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { RemProgressDialog } from './RemProgressDialog';
import { WebCard, theme } from './SharedComponents';
const label=(s:string)=>s.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
function Values({value}:{value:unknown}) {
 if(value===null||value===undefined)return <span className="text-slate-400">Unreported</span>;
 if(typeof value==='boolean')return <span>{value?'Yes':'No'}</span>;
 if(Array.isArray(value))return value.length?<div className="space-y-2">{value.map((v,i)=><div key={i}><Values value={v}/></div>)}</div>:<span>No entries</span>;
 if(typeof value==='object')return <dl className="grid gap-2">{Object.entries(value).filter(([k])=>k!=='_id').map(([k,v])=><div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3"><dt className="text-slate-400 break-words">{label(k)}</dt><dd className="whitespace-pre-wrap break-words min-w-0"><Values value={v}/></dd></div>)}</dl>;
 return <span>{String(value)}</span>;
}
export function useRemInspection(){
 const [detail,setDetail]=useState<{title:string;rows:unknown[]}|null>(null);
 const [record,setRecord]=useState<{id:string;title:string;kind:'analyzer'|'lvcc'}|null>(null);
 const inspect=(title:string,rows:unknown)=>setDetail({title,rows:Array.isArray(rows)?rows:[rows]});
 const dialog=<>{detail&&<Dialog open onOpenChange={o=>{if(!o)setDetail(null);}}><DialogContent className="sm:max-w-3xl max-h-[85dvh] overflow-y-auto" style={{backgroundColor:theme.pageBg,color:theme.textPrimary}}><DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>Current loaded source records. Expand an entry for its data; select an instrument to update progress.</DialogDescription></DialogHeader>{detail.rows.length===0?<p>No records for this selection.</p>:detail.rows.map((value,index)=>{const r=(value&&typeof value==='object'?value:{value}) as Record<string,unknown>;const serial=r.serialNumber;return <details key={String(r._id??index)} className="rounded-lg border border-slate-600 p-3" open={detail.rows.length===1}><summary className="cursor-pointer font-semibold">{String(serial??r.name??r.product??r.weekStart??r.stage??`Record ${index+1}`)}</summary><div className="mt-3 text-sm"><Values value={r}/></div>{serial&&r._id?<button className="rounded-lg bg-indigo-600 text-white px-3 py-2 mt-3" onClick={()=>{setDetail(null);setRecord({id:String(r._id),title:String(serial),kind:'analyzerType' in r?'analyzer':'lvcc'});}}>Update percentages & history</button>:null}</details>;})}</DialogContent></Dialog>}{record&&<RemProgressDialog key={record.id} kind={record.kind} recordId={record.id} title={record.title} onClose={()=>setRecord(null)}/>}</>;
 return {inspect,dialog};
}
export function RemInfoCard({title,data,children,className,style}:{title:string;data:unknown;children:ReactNode;className?:string;style?:CSSProperties}){
 const {inspect,dialog}=useRemInspection();
 return <><WebCard className={className} style={style}><button type="button" onClick={()=>inspect(title,data)} className="text-xs font-semibold text-indigo-300 underline underline-offset-4 mb-3">View {title.toLowerCase()} details ↗</button>{children}</WebCard>{dialog}</>;
}
