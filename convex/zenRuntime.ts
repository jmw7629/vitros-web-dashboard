// Existing OCR and the admin playground share this server-only gateway.
// No OpenAI/Go credential fallback, client-selected URL, paid model, or reasoning variant.
import type {ActionCtx} from "./_generated/server";
import type {Id} from "./_generated/dataModel";
import {internal} from "./_generated/api";
import {CATALOG_TTL,selectFreeModels,type AiPurpose,type FreeModel} from "./aiContract";

declare const process: { env: Record<string, string | undefined> };
const CATALOG_URL="https://models.dev/api.json";
const ZEN_URL="https://opencode.ai/zen/v1";
export function zenKey(){const key=process.env.OPENCODE_ZEN_API_KEY?.trim();if(!key)throw Error("OpenCode Zen key is not configured. Add OPENCODE_ZEN_API_KEY in the server environment.");return key;}
export async function refreshCatalog(ctx:ActionCtx,force=false):Promise<FreeModel[]> {
  const cached=await ctx.runQuery(internal.aiControl.getCatalog,{});
  if(!force&&cached&&Date.now()-cached.fetchedAt<CATALOG_TTL)return cached.models;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(CATALOG_URL,{signal:controller.signal});
    if(!response.ok)throw Error("Free-model catalog is unavailable.");
    const text=await response.text();if(text.length>20_000_000)throw Error("Free-model catalog is too large.");
    const models=selectFreeModels(JSON.parse(text));
    if(!models.length)throw Error("No supported free Zen models are currently listed.");
    await ctx.runMutation(internal.aiControl.storeCatalog,{models});return models;
  }catch(e){throw Error(e instanceof Error&&/^Free-model|^No supported/.test(e.message)?e.message:"Could not refresh free models. AI requests remain blocked until the catalog is current.");}
  finally{clearTimeout(timer);}
}
export class ZenError extends Error { code:string; constructor(code:string,message:string){super(message);this.code=code;}}
export function responseText(payload:any,api:"chat"|"responses"){
  let text=api==="chat"?payload?.choices?.[0]?.message?.content:payload?.output_text;
  if(api==="responses"&&!text)text=(payload?.output??[]).flatMap((x:any)=>x.type==="message"?(x.content??[]).filter((c:any)=>c.type==="output_text").map((c:any)=>c.text):[]).join("\n");
  if(typeof text!=="string"||!text.trim()||text.length>500_000)throw new ZenError("invalid_response","Zen returned no usable text. No inventory changes were made.");
  if(api==="chat"&&payload.choices?.[0]?.finish_reason==="length"||api==="responses"&&payload.status==="incomplete")throw new ZenError("output_limit","The model reached the output limit. Increase the limit or use a smaller document.");
  return text;
}
export function zenRequestBody(model:FreeModel,system:string,prompt:string,attachment:{image?:string;pdf?:string;filename?:string}|undefined,maxTokens:number) {
  if(model.api==="responses")return {
    model:model.id,store:false,instructions:system,
    input:[{role:"user",content:[{type:"input_text",text:prompt},
      ...(attachment?.image?[{type:"input_image",image_url:attachment.image}]:[]),
      ...(attachment?.pdf?[{type:"input_file",filename:attachment.filename??"document.pdf",file_data:"data:application/pdf;base64,"+attachment.pdf}]:[])]}],
    max_output_tokens:Math.min(maxTokens,model.maxOutput),
  };
  if(attachment?.pdf)throw new ZenError("unsupported_input","The selected free model does not support inline PDF requests.");
  return {model:model.id,messages:[{role:"system",content:system},{role:"user",content:attachment?.image?[{type:"text",text:prompt},{type:"image_url",image_url:{url:attachment.image}}]:prompt}],max_tokens:Math.min(maxTokens,model.maxOutput)};
}
export async function runZen(ctx:ActionCtx,args:{actor:Id<"users">;purpose:AiPurpose;system:string;prompt:string;modelId?:string;attachment?:{image?:string;pdf?:string;filename?:string}}):Promise<{text:string;model:string;requestId:Id<"aiRequests">}> {
  const key=zenKey();await refreshCatalog(ctx);
  const reservation=await ctx.runMutation(internal.aiControl.reserve,{actor:args.actor,purpose:args.purpose,...(args.modelId?{modelId:args.modelId}:{})});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),reservation.settings.timeoutSeconds*1000);
  try{
    const response=await fetch(ZEN_URL+(reservation.model.api==="responses"?"/responses":"/chat/completions"),{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},signal:controller.signal,
      body:JSON.stringify(zenRequestBody(reservation.model,args.system,args.prompt,args.attachment,reservation.settings.maxOutputTokens)),
    });
    if(!response.ok){
      const raw=await response.text();
      if(/free tier can only be used in OpenCode|MissingSessionID|only.*OpenCode/i.test(raw))
        throw new ZenError("provider_restricted","Zen restricted this free model to supported OpenCode clients. No paid fallback was used.");
      const code=response.status===429?"provider_rate_limit":response.status===401||response.status===403?"provider_auth":response.status===402?"free_access_exhausted":"provider_error";
      throw new ZenError(code,response.status===429?"Zen is rate limiting requests. Try later; no paid fallback was used.":response.status===402?"Free access is exhausted or unavailable. No paid fallback was used.":response.status===401||response.status===403?"Zen rejected the credential or model access. Check the Zen key and workspace model permissions.":"Zen request failed (HTTP "+response.status+").");
    }
    const payload=await response.json(),text=responseText(payload,reservation.model.api),usage=payload.usage??{};
    await ctx.runMutation(internal.aiControl.finish,{id:reservation.id,status:"succeeded",
      ...(Number.isFinite(usage.prompt_tokens??usage.input_tokens)?{inputTokens:usage.prompt_tokens??usage.input_tokens}:{}),
      ...(Number.isFinite(usage.completion_tokens??usage.output_tokens)?{outputTokens:usage.completion_tokens??usage.output_tokens}:{}),
    });
    return {text,model:reservation.model.id,requestId:reservation.id};
  }catch(e){
    const error=e instanceof ZenError?e:new ZenError(e instanceof Error&&e.name==="AbortError"?"timeout":"request_failed",e instanceof Error&&e.name==="AbortError"?"Zen request timed out. No paid fallback was used.":"Zen request failed. Check AI administration for status.");
    await ctx.runMutation(internal.aiControl.finish,{id:reservation.id,status:"failed",errorCode:error.code});
    throw error;
  }finally{clearTimeout(timer);}
}
