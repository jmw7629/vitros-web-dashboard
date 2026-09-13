import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireCapability } from "./authGuard";
import { publishRealtimePulse } from "./realtimePulsePublisher";
import { validateDhrBindingManifest, validateDhrDocumentState, validateDigitalDhrEvent, validateDigitalDhrReceipt } from "../src/lib/dhrDocumentContract";
import type { DhrBridgeErrorCode } from "../src/lib/dhrDocumentContract";

declare const process: { env: Record<string,string|undefined> };
const nullableText=v.union(v.string(),v.null());
const nullableNumber=v.union(v.number(),v.null());
const binding=v.object({fieldId:v.string(),sectionId:v.string(),partNumber:v.string(),kind:v.union(v.literal("consumable_part"),v.literal("tool")),quantityMode:v.literal("integer"),stepReference:v.optional(v.string())});
const manifest=v.object({schemaVersion:v.literal(1),templateId:v.string(),documentRevision:v.string(),analyzerModel:v.string(),artifactSha256:v.string(),bindings:v.array(binding)});
const eventFields={eventId:v.string(),idempotencyKey:v.string(),documentInstanceId:v.string(),documentTemplateId:v.string(),documentRevision:v.string(),fieldId:v.string(),fieldVersion:v.number(),sectionId:v.string(),partNumber:v.string(),previousQuantity:v.number(),quantity:v.number(),instrumentSn:v.string(),woNumber:v.optional(v.string()),occurredAt:v.string()};
const receipt=v.object({...eventFields,woNumber:nullableText,status:v.union(v.literal("consumed"),v.literal("returned"),v.literal("unchanged"),v.literal("ignored")),duplicate:v.boolean(),delta:v.number(),inventoryPartNumber:nullableText,stockId:nullableText,stockBefore:nullableNumber,stockAfter:nullableNumber,auditId:nullableText,sapStagingId:nullableText,correlationId:v.string(),operatorId:v.string(),operatorInitials:v.string(),actor:v.string(),processedAt:v.string()});
const state=v.object({documentInstanceId:v.string(),sessionId:v.string(),documentTemplateId:v.string(),documentRevision:v.string(),instrumentSn:v.string(),woNumber:nullableText,status:v.string(),manifest,fields:v.array(v.object({fieldId:v.string(),fieldVersion:v.number(),quantity:v.number(),conflict:v.boolean()}))});
const messages: Record<DhrBridgeErrorCode,string>={
  disabled:"Digital DHR consumption is not enabled. The manual scanner remains available.",
  not_found:"The document, approved binding, or inventory part was not found.",
  validation:"The digital DHR event or binding is invalid. Review it before retrying.",
  conflict:"This field or its scanner quantity changed. Reload and review the accepted state before another edit.",
  insufficient_stock:"There is not enough available stock for this quantity.",
  identity_unavailable:"An active employee identity and initials are required for digital DHR consumption.",
  unavailable:"Digital DHR consumption could not be confirmed. Keep the pending event and retry the same event.",
};
function failure(code:DhrBridgeErrorCode):never{throw new ConvexError({code,message:messages[code]});}
function enabled(){if(process.env.DIGITAL_DHR_ENABLED!=="true")failure("disabled");}
function uuid(value:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))failure("validation");}
function bounded(value:string,max:number){if(!value || value!==value.trim() || value.length>max || /[\u0000-\u001f\u007f]/.test(value))failure("validation");}
function config(){
  const url=process.env.SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !key)failure("unavailable");
  return {url:url.replace(/\/$/,""),headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"}};
}
const providerCodes:Record<string,DhrBridgeErrorCode>={
  digital_dhr_disabled:"disabled",digital_dhr_not_found:"not_found",digital_dhr_validation:"validation",digital_dhr_binding_not_configured:"validation",digital_dhr_conflict:"conflict",digital_dhr_fresh_session_required:"conflict",digital_dhr_insufficient_stock:"insufficient_stock",digital_dhr_identity_unavailable:"identity_unavailable",
};
async function provider(path:string,body?:Record<string,unknown>):Promise<unknown>{
  const c=config();let response:Response;
  try{response=await fetch(`${c.url}/rest/v1/${path}`,{method:body?"POST":"GET",headers:c.headers,...(body?{body:JSON.stringify(body)}:{})});}catch{failure("unavailable");}
  const payload:unknown=await response.json().catch(()=>null);
  if(!response.ok){
    const marker=payload && typeof payload==="object" && "message" in payload && typeof payload.message==="string"?payload.message:"";
    if(marker==="digital_dhr_fresh_session_required")throw new ConvexError({code:"conflict",message:"Start a fresh scanner session for this digital document. Existing scanner quantities cannot be adopted automatically."});
    failure(Object.prototype.hasOwnProperty.call(providerCodes,marker)?providerCodes[marker]:"unavailable");
  }
  return payload;
}
async function employeeIdentity(ctx:ActionCtx,userId:Id<"users">):Promise<string>{
  const profile=await ctx.runQuery(internal.users.getUserAuditIdentity,{userId});
  if(!profile.employeeId)failure("identity_unavailable");
  uuid(profile.employeeId);
  // SQL rechecks canonical active employee name/initials in the same transaction.
  return profile.employeeId;
}
export const getBridgeStatus=action({args:{},returns:v.object({enabled:v.boolean()}),handler:async(ctx)=>{
  await requireCapability(ctx,"inventory.read");
  if(process.env.DIGITAL_DHR_ENABLED!=="true")return {enabled:false};
  const status=await provider("rpc/get_digital_dhr_bridge_status",{});
  if(typeof status!=="boolean")failure("unavailable");
  return {enabled:status};
}});
export const getTemplate=action({args:{templateId:v.string(),documentRevision:v.string()},returns:manifest,handler:async(ctx,args)=>{
  await requireCapability(ctx,"inventory.read");enabled();bounded(args.templateId,160);bounded(args.documentRevision,40);
  const rows=await provider(`digital_dhr_manifests?select=manifest&template_id=eq.${encodeURIComponent(args.templateId)}&document_revision=eq.${encodeURIComponent(args.documentRevision)}&limit=2`);
  if(!Array.isArray(rows) || rows.length!==1)failure("not_found");
  const result:unknown=rows[0]?.manifest;
  try{validateDhrBindingManifest(result);}catch{failure("unavailable");}
  if(result.templateId!==args.templateId || result.documentRevision!==args.documentRevision)failure("unavailable");
  return result;
}});
export const createDocumentInstance=action({args:{documentInstanceId:v.string(),sessionId:v.string(),templateId:v.string(),documentRevision:v.string()},returns:state,handler:async(ctx,args)=>{
  const userId=await requireCapability(ctx,"inventory.write");enabled();uuid(args.documentInstanceId);uuid(args.sessionId);bounded(args.templateId,160);bounded(args.documentRevision,40);
  const employeeId=await employeeIdentity(ctx,userId);
  const result=await provider("rpc/create_digital_dhr_document",{p_instance_id:args.documentInstanceId,p_session_id:args.sessionId,p_template_id:args.templateId,p_document_revision:args.documentRevision,p_operator_id:String(userId),p_employee_id:employeeId});
  try{validateDhrDocumentState(result);}catch{failure("unavailable");}
  if(result.documentInstanceId!==args.documentInstanceId || result.sessionId!==args.sessionId || result.documentTemplateId!==args.templateId || result.documentRevision!==args.documentRevision)failure("unavailable");
  return result;
}});
export const getDocumentState=action({args:{documentInstanceId:v.string()},returns:state,handler:async(ctx,args)=>{
  await requireCapability(ctx,"inventory.read");enabled();uuid(args.documentInstanceId);
  const result=await provider("rpc/get_digital_dhr_document",{p_instance_id:args.documentInstanceId});
  try{validateDhrDocumentState(result);}catch{failure("unavailable");}
  if(result.documentInstanceId!==args.documentInstanceId)failure("unavailable");
  return result;
}});
export const applyFieldConsumption=action({args:{event:v.object(eventFields)},returns:receipt,handler:async(ctx,args)=>{
  const started=Date.now();
  try{
    const userId=await requireCapability(ctx,"inventory.write");enabled();
    try{validateDigitalDhrEvent(args.event);}catch{failure("validation");}
    const employeeId=await employeeIdentity(ctx,userId);
    const result=await provider("rpc/apply_digital_dhr_field_event",{p_event:args.event,p_operator_id:String(userId),p_employee_id:employeeId});
    try{
      validateDigitalDhrReceipt(result);
      for(const [key,value] of Object.entries(args.event))if(result[key as keyof typeof result]!==value)throw new Error("Receipt mismatch");
      if((args.event.woNumber??null)!==result.woNumber || result.operatorId!==String(userId))throw new Error("Receipt identity mismatch");
    }catch{failure("unavailable");}
    console.info(JSON.stringify({event:"digital_dhr_consumption",outcome:result.duplicate?"duplicate":"accepted",status:result.status,elapsedMs:Date.now()-started}));
    await publishRealtimePulse(ctx);return result;
  }catch(error){
    const candidate=error instanceof ConvexError && error.data && typeof error.data==="object" && "code" in error.data?String(error.data.code):"unavailable";
    const code=Object.prototype.hasOwnProperty.call(messages,candidate)?candidate:"unavailable";
    console.info(JSON.stringify({event:"digital_dhr_consumption",outcome:"rejected",code,elapsedMs:Date.now()-started}));
    throw error;
  }
}});
