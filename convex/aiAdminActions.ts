import {action} from "./_generated/server";
import {v} from "convex/values";
import {requireCapability} from "./authGuard";
import {refreshCatalog,runZen} from "./zenRuntime";
declare const process: { env: Record<string, string | undefined> };
export const connectionStatus=action({args:{},returns:v.object({provider:v.string(),keyConfigured:v.boolean(),variant:v.string(),paidFallback:v.boolean()}),handler:async ctx=>{
  await requireCapability(ctx,"admin.system_settings.manage");
  return {provider:"OpenCode Zen Free",keyConfigured:Boolean(process.env.OPENCODE_ZEN_API_KEY?.trim()),variant:"default",paidFallback:false};
}});
export const refreshModels=action({args:{},returns:v.any(),handler:async ctx=>{
  await requireCapability(ctx,"admin.system_settings.manage");return refreshCatalog(ctx,true);
}});
export const testConnection=action({args:{modelId:v.optional(v.string())},returns:v.any(),handler:async(ctx,args)=>{
  const actor=await requireCapability(ctx,"admin.system_settings.manage");
  return runZen(ctx,{actor,purpose:"connection",system:"This is a connection test. Reply with READY only.",prompt:"Reply READY.",...args});
}});
export const askModel=action({args:{prompt:v.string(),modelId:v.optional(v.string())},returns:v.any(),handler:async(ctx,args)=>{
  const actor=await requireCapability(ctx,"admin.system_settings.manage");
  if(!args.prompt.trim()||args.prompt.length>10000)throw Error("Enter a prompt of 1–10000 characters.");
  return runZen(ctx,{actor,purpose:"assistant",system:"You assist the REM Command Center administrator. Answer the supplied question. You have no live database access and cannot change inventory, DHR, SAP, or settings. Do not claim that an action was executed.",prompt:args.prompt,...(args.modelId?{modelId:args.modelId}:{})});
}});
