import {query,mutation,internalQuery,internalMutation} from "./_generated/server";
import {v} from "convex/values";
import {requireCapability} from "./authGuard";
import {AI_DEFAULTS,aiSettingsValidator,aiModelValidator,aiPurposeValidator,validateAiSettings,assertFeature,requireFreeModel,modelForPurpose,requiredInput,CATALOG_TTL} from "./aiContract";

async function settingsRow(ctx:any){
  return ctx.db.query("aiSettings").withIndex("by_key",(q:any)=>q.eq("key","zen")).unique();
}
export const getRuntime = internalQuery({args:{},returns:v.any(),handler:async ctx=>{
  const row=await settingsRow(ctx);
  return {settings:row?.value??AI_DEFAULTS,version:row?.version??0};
}});
export const getCatalog = internalQuery({args:{},returns:v.any(),handler:async ctx=>
  ctx.db.query("aiCatalog").withIndex("by_key",q=>q.eq("key","zen")).unique()
});
export const storeCatalog=internalMutation({args:{models:v.array(aiModelValidator)},returns:v.null(),handler:async(ctx,args)=>{
  if(!args.models.length||args.models.length>100)throw Error("Invalid free-model catalog");
  const row=await ctx.db.query("aiCatalog").withIndex("by_key",q=>q.eq("key","zen")).unique();
  const data={key:"zen" as const,models:args.models,fetchedAt:Date.now()};
  if(row)await ctx.db.replace(row._id,data);else await ctx.db.insert("aiCatalog",data);
  return null;
}});
export const dashboard=query({args:{},returns:v.any(),handler:async ctx=>{
  await requireCapability(ctx,"admin.system_settings.manage");
  const row=await settingsRow(ctx),day=new Date().toISOString().slice(0,10);
  const [catalog,daily,requests,audit]=await Promise.all([
    ctx.db.query("aiCatalog").withIndex("by_key",q=>q.eq("key","zen")).unique(),
    ctx.db.query("aiUsageDaily").withIndex("by_day",q=>q.eq("day",day)).unique(),
    ctx.db.query("aiRequests").withIndex("by_startedAt").order("desc").take(50),
    ctx.db.query("aiSettingsAudit").withIndex("by_createdAt").order("desc").take(10),
  ]);
  return {settings:row?.value??AI_DEFAULTS,version:row?.version??0,catalog:catalog??null,daily:daily??{day,requests:0,succeeded:0,failed:0,inputTokens:0,outputTokens:0},requests,audit};
}});
export const saveSettings=mutation({
  args:{value:aiSettingsValidator,expectedVersion:v.number(),correlationId:v.string(),reason:v.string()},returns:v.object({version:v.number(),duplicate:v.boolean()}),
  handler:async(ctx,args)=>{
    const actor=await requireCapability(ctx,"admin.system_settings.manage");validateAiSettings(args.value);
    if(!/^[0-9a-f-]{36}$/i.test(args.correlationId)||!Number.isSafeInteger(args.expectedVersion)||args.expectedVersion<0||args.reason.length>500)throw Error("Invalid settings change");
    const previous=await ctx.db.query("aiSettingsAudit").withIndex("by_correlationId",q=>q.eq("correlationId",args.correlationId)).unique();
    const request=JSON.stringify({value:args.value,expectedVersion:args.expectedVersion,reason:args.reason});
    if(previous){
      if(previous.actor!==actor||previous.request!==request)throw Error("Settings operation ID was reused for different data");
      return {version:previous.version,duplicate:true};
    }
    const row=await settingsRow(ctx);
    if((row?.version??0)!==args.expectedVersion)throw Error("AI settings changed in another window. Reload before saving.");
    if(args.value.enabled){
      const catalog=await ctx.db.query("aiCatalog").withIndex("by_key",q=>q.eq("key","zen")).unique();
      if(!catalog||Date.now()-catalog.fetchedAt>CATALOG_TTL)throw Error("Refresh the free-model catalog before saving.");
      if(args.value.assistantEnabled)requireFreeModel(catalog.models,args.value.textModel,"text");
      if(args.value.receivingEnabled||args.value.dhrEnabled)requireFreeModel(catalog.models,args.value.imageModel,"image");
      if(args.value.pdfEnabled)requireFreeModel(catalog.models,args.value.pdfModel,"pdf");
    }
    const version=(row?.version??0)+1,now=Date.now();
    const data={key:"zen" as const,value:args.value,version,updatedAt:now,updatedBy:actor};
    if(row)await ctx.db.replace(row._id,data);else await ctx.db.insert("aiSettings",data);
    await ctx.db.insert("aiSettingsAudit",{version,actor,createdAt:now,correlationId:args.correlationId,request,reason:args.reason,previous:row?.value??AI_DEFAULTS,value:args.value});
    return {version,duplicate:false};
  }
});
export const reserve=internalMutation({
  args:{actor:v.id("users"),purpose:aiPurposeValidator,modelId:v.optional(v.string())},returns:v.any(),
  handler:async(ctx,args)=>{
    const row=await settingsRow(ctx),settings=row?.value??AI_DEFAULTS;assertFeature(settings,args.purpose);
    const catalog=await ctx.db.query("aiCatalog").withIndex("by_key",q=>q.eq("key","zen")).unique();
    const now=Date.now();
    if(!catalog||now-catalog.fetchedAt>CATALOG_TTL)throw Error("Free-model catalog needs a refresh.");
    const model=requireFreeModel(catalog.models,args.modelId??modelForPurpose(settings,args.purpose),requiredInput(args.purpose));
    const day=new Date(now).toISOString().slice(0,10),minute=Math.floor(now/60000);
    const daily=await ctx.db.query("aiUsageDaily").withIndex("by_day",q=>q.eq("day",day)).unique();
    const recent=await ctx.db.query("aiRequests").withIndex("by_startedAt",q=>q.gte("startedAt",minute*60000)).take(61);
    if(recent.length>=settings.requestsPerMinute)throw Error("Dashboard AI minute limit reached. Try again next minute.");
    if((daily?.requests??0)>=settings.requestsPerDay)throw Error("Dashboard AI daily limit reached. Superuser can adjust the limit.");
    if(daily)await ctx.db.patch(daily._id,{requests:daily.requests+1});
    else await ctx.db.insert("aiUsageDaily",{day,requests:1,succeeded:0,failed:0,inputTokens:0,outputTokens:0});
    const id=await ctx.db.insert("aiRequests",{actor:args.actor,purpose:args.purpose,model:model.id,settingsVersion:row?.version??0,status:"running",startedAt:now,day});
    return {id,settings,model};
  }
});
export const finish=internalMutation({
  args:{id:v.id("aiRequests"),status:v.union(v.literal("succeeded"),v.literal("failed")),inputTokens:v.optional(v.number()),outputTokens:v.optional(v.number()),errorCode:v.optional(v.string())},returns:v.null(),
  handler:async(ctx,args)=>{
    const row=await ctx.db.get(args.id);if(!row||row.status!=="running")return null;
    const token=(n:number|undefined)=>n!==undefined&&Number.isSafeInteger(n)&&n>=0?Math.min(n,10000000):undefined;
    const inputTokens=token(args.inputTokens),outputTokens=token(args.outputTokens);
    await ctx.db.patch(row._id,{status:args.status,finishedAt:Date.now(),...(inputTokens!==undefined?{inputTokens}:{}),...(outputTokens!==undefined?{outputTokens}:{}),...(args.errorCode?{errorCode:args.errorCode.slice(0,80)}:{})});
    const daily=await ctx.db.query("aiUsageDaily").withIndex("by_day",q=>q.eq("day",row.day)).unique();
    if(daily)await ctx.db.patch(daily._id,{succeeded:daily.succeeded+(args.status==="succeeded"?1:0),failed:daily.failed+(args.status==="failed"?1:0),inputTokens:daily.inputTokens+(inputTokens??0),outputTokens:daily.outputTokens+(outputTokens??0)});
    return null;
  }
});
