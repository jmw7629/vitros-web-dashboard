import type { CycleLineInput, CycleSession, CycleWip, CountSort } from "../../convex/cycleCountContract";
export interface CountLine {
 partNumber: string; description: string; systemQty: number; countedQty: string; incomingQty: string;
 wipEntries: Record<string,string>; type: string; onPlan: boolean; minQty: number; maxQty: number;
 counted: boolean; incomingCounted: boolean; allCounted: boolean; stockToken: string | null; stockChanged: boolean;
}
export function scopeParts(session: CycleSession, wip: CycleWip, sort: CountSort) {
 return session.scope_mode === "w2w" || sort === "w2w" ? wip.parts.map(p=>p.partNumber) : session.scope_parts;
}
export function displayCountLines(partNumbers: string[], inputs: CycleLineInput[], wip: CycleWip): CountLine[] {
 const counts=new Map(inputs.map(row=>[row.partNumber,row]));const stock=new Map(wip.parts.map(row=>[row.partNumber,row]));
 return partNumbers.map(partNumber=>{
  const p=stock.get(partNumber);const input=counts.get(partNumber);const counted=input?.countedQty!==null && input?.countedQty!==undefined;
  const incoming=input?.incomingQty!==null && input?.incomingQty!==undefined;
  return {partNumber,description:p?.description??"Part no longer in stock",type:p?.type??"Unclassified",onPlan:p?.onPlan??false,
   systemQty:p?.systemQty??0,minQty:p?.minQty??0,maxQty:p?.maxQty??0,countedQty:counted?String(input!.countedQty):"",
   incomingQty:incoming?String(input!.incomingQty):"",wipEntries:Object.fromEntries(wip.serials.map(sn=>[sn,String(p?.wipEntries[sn]??0)])),
   counted,incomingCounted:incoming,allCounted:counted&&incoming,stockToken:input?.stockToken??null,
   stockChanged:counted && (!p || input?.stockToken!==p.stockToken)};
 });
}
export function sortCountLines<T extends {partNumber:string;type:string}>(lines:T[],mode:CountSort):T[] {
 return [...lines].sort((a,b)=>{
  const group=mode==="w2w"?Number(b.type.trim().toLowerCase()==="required")-Number(a.type.trim().toLowerCase()==="required"):0;
  return group || a.partNumber.localeCompare(b.partNumber,"en",{numeric:true,sensitivity:"base"});
 });
}
export function parseCount(value:string):number|null {
 if(value==="")return null;
 if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>2147483647)throw new Error("Enter a non-negative whole number");
 return Number(value);
}
