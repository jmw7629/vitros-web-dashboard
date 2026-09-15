import {v} from "convex/values";

export const AI_DEFAULTS = {
  enabled: true, assistantEnabled: true, receivingEnabled: true, dhrEnabled: true, pdfEnabled: true,
  textModel: "big-pickle", imageModel: "muse-spark-1.3-contributor-free", pdfModel: "muse-spark-1.3-contributor-free",
  maxOutputTokens: 3000, timeoutSeconds: 90, requestsPerMinute: 10, requestsPerDay: 500,
};
export type AiSettings = typeof AI_DEFAULTS;
export const aiSettingsValidator = v.object({
  enabled:v.boolean(), assistantEnabled:v.boolean(), receivingEnabled:v.boolean(), dhrEnabled:v.boolean(), pdfEnabled:v.boolean(),
  textModel:v.string(),imageModel:v.string(),pdfModel:v.string(),
  maxOutputTokens:v.number(),timeoutSeconds:v.number(),requestsPerMinute:v.number(),requestsPerDay:v.number(),
});
export const aiPurposeValidator=v.union(v.literal("assistant"),v.literal("connection"),v.literal("receiving"),v.literal("dhr"),v.literal("pdf"));
export type AiPurpose="assistant"|"connection"|"receiving"|"dhr"|"pdf";
export type FreeModel={id:string;name:string;inputs:string[];api:"chat"|"responses";maxOutput:number;privacy:string};
export const aiModelValidator=v.object({id:v.string(),name:v.string(),inputs:v.array(v.string()),api:v.union(v.literal("chat"),v.literal("responses")),maxOutput:v.number(),privacy:v.string()});
export const CATALOG_TTL=5*60_000;
export function validateAiSettings(settings:AiSettings) {
  const bounds={maxOutputTokens:[256,8192],timeoutSeconds:[10,120],requestsPerMinute:[1,60],requestsPerDay:[1,5000]};
  for(const [key,[min,max]] of Object.entries(bounds)){
    const value=settings[key as keyof typeof bounds];
    if(!Number.isSafeInteger(value)||value<min||value>max)throw Error(key+" must be a whole number from "+min+" to "+max);
  }
  for(const key of ["textModel","imageModel","pdfModel"] as const)
    if(!/^[a-z0-9][a-z0-9.-]{0,95}$/.test(settings[key]))throw Error("Choose a valid free Zen model");
}
export function selectFreeModels(payload:any):FreeModel[] {
  const provider=payload?.opencode;
  if(provider?.api!=="https://opencode.ai/zen/v1"||!provider.models)throw Error("Zen model catalog is invalid");
  return Object.values(provider.models).flatMap((value:any):FreeModel[]=>{
    if(!value||typeof value.id!=="string")return [];
    const cost=value.cost, inputs=value.modalities?.input, npm=value.provider?.npm??provider.npm;
    if(value.status==="deprecated"||!cost||cost.input!==0||cost.output!==0||
      Object.entries(cost).some(([key,n])=>/cache|input|output/.test(key)&&n!==0)||
      !Array.isArray(inputs)||!inputs.includes("text")||!["big-pickle"].includes(value.id)&&!value.id.endsWith("-free")||
      !["@ai-sdk/openai-compatible","@ai-sdk/openai"].includes(npm)||
      !/^[a-z0-9][a-z0-9.-]{0,95}$/.test(value.id))return [];
    return [{id:value.id,name:String(value.name??value.id).slice(0,120),inputs:inputs.filter((x:any)=>["text","image","pdf","audio","video"].includes(x)),
      api:npm==="@ai-sdk/openai"?"responses":"chat",maxOutput:Number.isSafeInteger(value.limit?.output)&&value.limit.output>0?Math.min(8192,value.limit.output):3000,
      privacy:value.id.startsWith("nemotron")?"Trial use only: do not submit personal or confidential data.":
        value.id.startsWith("muse-")?"Prompts and completions may be used to train Meta models.":
        "During the free period, submitted data may be used to improve the model."}];
  }).sort((a,b)=>a.name.localeCompare(b.name));
}
export function modelForPurpose(settings:AiSettings,purpose:AiPurpose){
  return purpose==="pdf"?settings.pdfModel:purpose==="receiving"||purpose==="dhr"?settings.imageModel:settings.textModel;
}
export function requiredInput(purpose:AiPurpose){return purpose==="pdf"?"pdf":purpose==="receiving"||purpose==="dhr"?"image":"text";}
export function requireFreeModel(models:FreeModel[],id:string,input:string) {
  const model=models.find(m=>m.id===id&&m.inputs.includes(input)&&(input!=="pdf"||m.api==="responses"));
  if(!model)throw Error("Selected model is not currently free or does not support "+input+". Refresh models and update AI settings.");
  return model;
}
export function assertFeature(settings:AiSettings,purpose:AiPurpose){
  if(purpose==="connection")return;
  if(!settings.enabled)throw Error("Dashboard AI is paused by Superuser.");
  const flag=purpose==="assistant"?"assistantEnabled":purpose==="pdf"?"pdfEnabled":purpose==="dhr"?"dhrEnabled":"receivingEnabled";
  if(!settings[flag])throw Error("This AI feature is disabled by Superuser.");
}
