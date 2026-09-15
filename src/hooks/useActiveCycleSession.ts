import {useAction} from "convex/react";
import {useEffect,useRef,useState} from "react";
import {api} from "../../convex/_generated/api";
import type {CycleSchedule} from "./useConvexData";
import type {CycleSession,CycleLineInput,CycleWip,CountSort} from "../../convex/cycleCountContract";
import {parseCount} from "../lib/cycleCountState";
type SaveKind="save"|"pause"|"confirm";
export type CountReview = {adjustmentBasis:"counted"|"counted_wip_incoming";lines:CycleLineInput[];wipFingerprint:string};
type Receipt={sessionId:string;revision:number;status:CycleSession["status"];savedAt:string};
export function useActiveCycleSession(wip:CycleWip,onWip:(wip:CycleWip)=>void) {
 const startAction=useAction(api.cycleCountActions.startSession),saveAction=useAction(api.cycleCountActions.saveSession);
 const [session,setSession]=useState<CycleSession|null>(null),[schedule,setSchedule]=useState<CycleSchedule|null>(null);
 const [inputs,setInputs]=useState<CycleLineInput[]>([]),[sortMode,setSortMode]=useState<CountSort>("alpha");
 const [saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null),[savedAt,setSavedAt]=useState<string|null>(null);
 const latest=useRef({session,inputs,sortMode,wip});latest.current={session,inputs,sortMode,wip};
 const mounted=useRef(true),busy=useRef<Promise<boolean>|null>(null);
 const pending=useRef<Parameters<typeof saveAction>[0]|null>(null);
 const starting=useRef(false);
 const startPending=useRef<Parameters<typeof startAction>[0]|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function start(next:CycleSchedule) {
  if(busy.current||starting.current)return false;
  if(latest.current.session) {
   if(latest.current.session.schedule_id===next._id)return true;
   setError("Save and Exit the current count before starting another.");return false;
  }
  starting.current=true;setSaving(true);setError(null);
  try {
   if(!startPending.current||startPending.current.id!==next._id)startPending.current={id:next._id,scopeMode:("countType" in next&&next.countType==="w2w")||/^w2w\b/i.test(next.name.trim())?"w2w":"standard",correlationId:crypto.randomUUID()};
   const result=await startAction(startPending.current) as {session:CycleSession;wip:CycleWip};
   if(!mounted.current)return false;
   startPending.current=null;pending.current=null;
   latest.current={session:result.session,inputs:result.session.lines,sortMode:result.session.sort_mode,wip:result.wip};
   setSession(result.session);setInputs(result.session.lines);setSchedule(next);setSortMode(result.session.sort_mode);onWip(result.wip);setSavedAt(result.session.saved_at);
   return true;
  }catch(err){if(mounted.current)setError(err instanceof Error?err.message:"Could not start count");return false;}
  finally{starting.current=false;if(mounted.current)setSaving(false);}
 }
 function save(kind:SaveKind,review?:CountReview):Promise<boolean> {
  if(!latest.current.session)return Promise.resolve(false);
  if(busy.current)return kind==="save"?busy.current:busy.current.then(ok=>ok?save(kind,review):false);
  if(pending.current&&pending.current.operation!=="save"&&kind!==pending.current.operation)return Promise.resolve(false);
  const work=async()=>{
   setSaving(true);setError(null);
   try{
    const send=async()=>{
     const operation=pending.current!;const receipt=await saveAction(operation) as Receipt;
     pending.current=null;
     const current=latest.current.session;
     if(!current||current.id!==receipt.sessionId)return;
     const next={...current,revision:receipt.revision,status:receipt.status,saved_at:receipt.savedAt};
     latest.current.session=next;
     if(mounted.current){setSession(next);setSavedAt(receipt.savedAt);}
    };
    // A failed checkpoint must retain its exact correlation and payload. Its
    // acknowledgement advances the revision without replacing newer local edits.
    if(pending.current) {
     const previousKind=pending.current.operation;await send();
     if(previousKind==="confirm"||previousKind==="pause"){
      latest.current.session=null;
      if(mounted.current){setSession(null);setSchedule(null);setInputs([]);}
      return true;
     }
    }
    const current=latest.current;
    if(!current.session)return false;
    pending.current={operation:kind,sessionId:current.session.id,expectedRevision:current.session.revision,
     lines:structuredClone(review?.lines??current.inputs),sortMode:current.sortMode,correlationId:crypto.randomUUID(),
     ...(kind==="confirm"?{wipFingerprint:review?.wipFingerprint,adjustmentBasis:review?.adjustmentBasis}:{})};
    await send();
    if(kind!=="save"){latest.current.session=null;if(mounted.current){setSession(null);setSchedule(null);setInputs([]);}}
    return true;
   }catch(err){
    const message=err instanceof Error?err.message:"Save failed. Your entries are preserved.";
    if(/Stock changed during count|DHR WIP changed|Counts must|Cycle count conflict|Cycle count session is not active/.test(message))pending.current=null;
    if(mounted.current)setError(message);return false;
   }
   finally{if(mounted.current)setSaving(false);}
  };
  const promise=work();busy.current=promise;void promise.finally(()=>{if(busy.current===promise)busy.current=null;});return promise;
 }
 const saveRef=useRef(save);saveRef.current=save;
 useEffect(()=>{
  if(!session||session.status!=="active")return;
  const timer=setInterval(()=>{void saveRef.current("save");},30000);
  return()=>clearInterval(timer);
 },[session?.id,session?.status]);
 function update(partNumber:string,field:string,value:string) {
  if(pending.current&&pending.current.operation!=="save"){setError("Retry the pending "+(pending.current.operation==="pause"?"Save and Exit":"confirmation")+" before changing counts.");return;}
  try{
   const number=parseCount(value),stock=latest.current.wip.parts.find(p=>p.partNumber===partNumber);
   const rows=latest.current.inputs;
   const row=rows.find(p=>p.partNumber===partNumber)??{partNumber,countedQty:null,incomingQty:null,stockToken:null};
   const next=field==="counted"?{...row,countedQty:number,stockToken:number===null?null:stock?.stockToken??null}:{...row,incomingQty:number};
   const result=[...rows.filter(p=>p.partNumber!==partNumber),next];latest.current.inputs=result;setInputs(result);setError(null);
  }catch(err){setError(err instanceof Error?err.message:"Invalid count");}
 }
 async function reload() {
  if(busy.current||!schedule)return false;
  const previous=schedule;pending.current=null;startPending.current=null;latest.current.session=null;
  setSession(null);setInputs([]);setSchedule(null);return start(previous);
 }
 return {session,schedule,inputs,sortMode,reload,setSortMode:(mode:CountSort)=>{latest.current.sortMode=mode;setSortMode(mode);},
  start,save,update,saving,error,setError,savedAt};
}
