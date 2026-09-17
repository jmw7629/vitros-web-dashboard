import { v } from 'convex/values';
import { action } from './_generated/server';
import { requireCapability } from './authGuard';
import { publishRealtimePulse } from './realtimePulsePublisher';
import { LVCC_TYPES, recordSnapshot, validateProgress } from './remProgressContract';

declare const process: { env: Record<string, string | undefined> };
const kind = v.union(v.literal('analyzer'), v.literal('lvcc'));
const progress = v.record(v.string(), v.union(v.number(), v.null()));
const record = v.object({id:v.string(),serialNumber:v.string(),itemType:v.string(),currentStage:v.string(),revision:v.number(),notes:v.string(),progress,updatedAt:v.union(v.string(),v.null()),engineerName:v.union(v.string(),v.null())});
const engineer = v.object({id:v.string(),name:v.string(),initials:v.string()});
const receipt = v.object({duplicate:v.boolean(),record,eventId:v.string(),createdAt:v.string()});
function uuid(value:string) { if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid record or engineer ID'); }
async function request(resource:string, body?:unknown) {
  const url=process.env.SUPABASE_URL; const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error('REM progress service is unavailable');
  const response=await fetch(`${url.replace(/\/$/,'')}/rest/v1/${resource}`,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok) {
    const raw=await response.text();
    const safe=['revision conflict','idempotency conflict','Choose an active engineer','already exists','Complete requires','Invalid REM stage','REM record not found'];
    const match=safe.find(s=>raw.includes(s));
    throw new Error(match ? `REM ${match}. Reload the record if needed.` : `REM progress request failed (${response.status})`);
  }
  return await response.json();
}
async function engineers() {
  const rows=await request('convex_employees?select=id,name,initials&active=is.true&order=name.asc&limit=500');
  if(!Array.isArray(rows)) throw new Error('Engineer directory unavailable');
  return rows.map(r=>({id:String(r.id),name:String(r.name),initials:String(r.initials??'')}));
}
export const listEngineers = action({args:{},returns:v.array(engineer),handler:async(ctx)=>{await requireCapability(ctx,'rem.read'); return engineers();}});
export const getDetail = action({
  args:{kind,recordId:v.string()},
  returns:v.object({record,engineers:v.array(engineer),canWrite:v.boolean(),history:v.array(v.object({id:v.string(),engineerName:v.string(),createdAt:v.string(),stage:v.string(),progress,notes:v.string()}))}),
  handler:async(ctx,args)=>{
    await requireCapability(ctx,'rem.read'); uuid(args.recordId);
    let canWrite=true; try { await requireCapability(ctx,'rem.write'); } catch(e) { if(!/capability|role policy/i.test(String(e))) throw e; canWrite=false; }
    const table=args.kind==='analyzer'?'rem_analyzers':'rem_lvcc';
    const [rows,staff,events]=await Promise.all([request(`${table}?id=eq.${args.recordId}&select=*&limit=1`),engineers(),request(`rem_progress_events?kind=eq.${args.kind}&record_id=eq.${args.recordId}&select=id,engineer_name,created_at,after_value&order=revision.desc&limit=50`)]);
    if(!Array.isArray(rows)||rows.length!==1||!Array.isArray(events)) throw new Error('REM record not found');
    return {record:recordSnapshot(args.kind,rows[0]),engineers:staff,canWrite,history:events.map(e=>({id:String(e.id),engineerName:String(e.engineer_name),createdAt:String(e.created_at),stage:String(e.after_value.currentStage),progress:e.after_value.progress,notes:String(e.after_value.notes??'')}))};
  }
});
export const updateProgress=action({
  args:{kind,recordId:v.string(),expectedRevision:v.number(),engineerId:v.string(),stage:v.string(),progress,notes:v.string(),correlationId:v.string()},returns:receipt,
  handler:async(ctx,args)=>{
    const actor=await requireCapability(ctx,'rem.write'); uuid(args.recordId); uuid(args.engineerId);
    if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<0) throw new Error('Invalid revision');
    if(args.notes.length>4000||! /^[A-Za-z0-9:._-]{1,180}$/.test(args.correlationId)) throw new Error('Invalid notes or request identifier');
    validateProgress(args.kind,args.progress,args.stage);
    const result=await request('rpc/apply_rem_progress_update',{p_kind:args.kind,p_record_id:args.recordId,p_expected_revision:args.expectedRevision,p_engineer_id:args.engineerId,p_stage:args.stage,p_progress:args.progress,p_notes:args.notes,p_actor:actor,p_correlation_id:args.correlationId});
    await publishRealtimePulse(ctx); return result;
  }
});
export const createLvcc=action({
  args:{serialNumber:v.string(),itemType:v.string(),batchNumber:v.string(),engineerId:v.string(),notes:v.string(),correlationId:v.string()},returns:receipt,
  handler:async(ctx,args)=>{
    const actor=await requireCapability(ctx,'rem.write'); uuid(args.engineerId);
    if(!args.serialNumber.trim()||args.serialNumber.length>120||args.batchNumber.length>120||args.notes.length>4000||!(LVCC_TYPES as readonly string[]).includes(args.itemType)||! /^[A-Za-z0-9:._-]{1,180}$/.test(args.correlationId)) throw new Error('Invalid LVCC record');
    const result=await request('rpc/create_rem_lvcc_record',{p_serial:args.serialNumber.trim(),p_type:args.itemType,p_batch:args.batchNumber.trim(),p_engineer_id:args.engineerId,p_notes:args.notes,p_actor:actor,p_correlation_id:args.correlationId});
    await publishRealtimePulse(ctx);return result;
  }
});
