import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
const cache = new Map();
const references = new Proxy({}, {get: (_, name) => new Proxy({}, {get: (_, key) => String(name) + "." + String(key)})});
let env = {}, network = async () => { throw Error("Unexpected network"); };
const guards = async ctx => { if (!ctx.allowed) throw Error("Forbidden"); return "users:admin"; };
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const out = {exports: {}};
  const source = ts.transpileModule(fs.readFileSync("convex/" + name + ".ts", "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source, {exports: out.exports, module: out, require(id) {
    if (id === "./_generated/server") return {query: x=>x, mutation:x=>x, action:x=>x, internalQuery:x=>x, internalMutation:x=>x};
    if (id === "./_generated/api") return {internal: references};
    if (id === "./authGuard") return {requireCapability: guards};
    if (id.startsWith("./")) return load(id.slice(2));
    return require(id);
  }, process: {get env() {return env}}, Date, setTimeout, clearTimeout, AbortController, fetch: (...args)=>network(...args), console}, {filename:name+".ts"});
  cache.set(name,out.exports); return out.exports;
}
const c = load("aiContract"), runtime = load("zenRuntime"), control = load("aiControl"), admin = load("aiAdminActions");
const plain = value => JSON.parse(JSON.stringify(value));
const fixture = (id, overrides={})=>({id,name:id,cost:{input:0,output:0,cache_read:0},modalities:{input:["text"]},limit:{output:4096},...overrides});
const catalog = {opencode:{api:"https://opencode.ai/zen/v1",npm:"@ai-sdk/openai-compatible",models:{
 good:fixture("big-pickle"), image:fixture("image-free",{modalities:{input:["text","image"]}}),
 pdf:fixture("pdf-free",{modalities:{input:["text","image","pdf"]},provider:{npm:"@ai-sdk/openai"}}),
 paid:fixture("paid-free",{cost:{input:1,output:0}}), cache:fixture("cached-free",{cost:{input:0,output:0,cache_read:1}}),
 old:fixture("old-free",{status:"deprecated"}), unknown:fixture("unverified"), missing:{}, null:null,
 other:fixture("other-free",{provider:{npm:"@ai-sdk/anthropic"}})
}}};
const models = c.selectFreeModels(catalog);
assert.deepEqual(plain(models.map(m=>m.id).sort()), ["big-pickle","image-free","pdf-free"]);
assert.throws(()=>c.selectFreeModels({opencode:{...catalog.opencode,api:"https://untrusted.example"}}), /invalid/);
assert.throws(()=>c.requireFreeModel(models,"big-pickle","image"),/does not support/);
assert.throws(()=>c.requireFreeModel([{...models[0],inputs:["text","pdf"],api:"chat"}],models[0].id,"pdf"), /does not support/);
for (const [key,value] of [["requestsPerDay",0],["requestsPerMinute",61],["maxOutputTokens",Infinity],["timeoutSeconds",10.5]]) assert.throws(()=>c.validateAiSettings({...c.AI_DEFAULTS,[key]:value}));
assert.throws(()=>c.assertFeature({...c.AI_DEFAULTS,enabled:false},"assistant"),/paused/);
c.assertFeature({...c.AI_DEFAULTS,enabled:false},"connection");
const pdf = models.find(m=>m.id==="pdf-free");
const body = runtime.zenRequestBody(pdf,"system","prompt",{pdf:"JVBERi0=" ,filename:"test.pdf"},3000);
assert.equal(body.input[0].content[1].type,"input_file"); assert.equal(body.store,false);
assert.equal(body.input[0].content[1].file_data,"data:application/pdf;base64,JVBERi0=");
assert(!/reasoning|variant|effort/.test(JSON.stringify(body)));
assert.equal(runtime.zenRequestBody(pdf,"s","p",{image:"data:image/png;base64,eA=="},3000).input[0].content[1].type,"input_image");
assert.throws(()=>runtime.zenRequestBody(models[0],"s","p",{pdf:"x"},3000),/does not support/);
assert.throws(()=>runtime.responseText({choices:[{message:{content:"partial"},finish_reason:"length"}]},"chat"),/output limit/);
assert.throws(()=>runtime.responseText({status:"incomplete",output_text:"partial"},"responses"),/output limit/);
assert.equal(runtime.responseText({output:[{type:"message",content:[{type:"output_text",text:"READY"}]}]},"responses"),"READY");
assert.throws(()=>runtime.responseText({},"chat"),/no usable text/);
function memoryDb() {
 const rows = new Map(); let seq = 0;
 return { rows, query(table) {
   let predicates=[], desc=false;
   const query={withIndex(name, fn) {
     const range={eq(k,v){predicates.push(row=>row[k]===v);return range},gte(k,v){predicates.push(row=>row[k]>=v);return range}};
     fn?.(range);return query;
   },order(value){desc=value==="desc";return query},async unique(){const values=await query.take(2);assert(values.length<2);return values[0]??null},async take(n){return [...rows.values()].filter(row=>row._table===table&&predicates.every(p=>p(row))).sort((a,b)=>desc?(b.startedAt??b.createdAt??0)-(a.startedAt??a.createdAt??0):0).slice(0,n).map(plain)}};
   return query;
 },async insert(table,value){const id=table+":"+(++seq);rows.set(id,{...plain(value),_id:id,_table:table});return id},
 async get(id){return rows.has(id)?plain(rows.get(id)):null},
 async replace(id,value){rows.set(id,{...plain(value),_id:id,_table:rows.get(id)._table})},
 async patch(id,value){rows.set(id,{...rows.get(id),...plain(value)})}};
}
const db=memoryDb(), ctx={allowed:true,db};
await control.storeCatalog.handler(ctx,{models});
const settings={...c.AI_DEFAULTS,imageModel:"image-free",pdfModel:"pdf-free",requestsPerMinute:2,requestsPerDay:3};
const change={value:settings,expectedVersion:0,correlationId:"11111111-1111-4111-8111-111111111111",reason:"Fixture"};
assert.equal((await control.saveSettings.handler(ctx,change)).version,1);
assert.equal((await control.saveSettings.handler(ctx,change)).duplicate,true);
await assert.rejects(control.saveSettings.handler(ctx,{...change,value:{...settings,requestsPerDay:4}}),/reused/);
await assert.rejects(control.saveSettings.handler(ctx,{...change,correlationId:"22222222-2222-4222-8222-222222222222"}),/another window/);
await assert.rejects(control.dashboard.handler({allowed:false,db}),/Forbidden/);
await assert.rejects(admin.askModel.handler({allowed:false},{prompt:"test"}),/Forbidden/);
await assert.rejects(admin.connectionStatus.handler({allowed:false}),/Forbidden/);
await assert.rejects(control.saveSettings.handler({allowed:false,db},change),/Forbidden/);
const r1=await control.reserve.handler(ctx,{actor:"users:engineer",purpose:"dhr"});
assert.equal(r1.model.id,"image-free");
await control.finish.handler(ctx,{id:r1.id,status:"succeeded",inputTokens:10,outputTokens:20});
await control.finish.handler(ctx,{id:r1.id,status:"failed"});
assert.equal((await control.dashboard.handler(ctx)).daily.succeeded,1);
await control.reserve.handler(ctx,{actor:"users:admin",purpose:"assistant"});
await assert.rejects(control.reserve.handler(ctx,{actor:"users:admin",purpose:"assistant"}),/minute limit/);
for(const row of db.rows.values())if(row._table==="aiRequests")row.startedAt-=60000;
await control.reserve.handler(ctx,{actor:"users:admin",purpose:"assistant"});
await assert.rejects(control.reserve.handler(ctx,{actor:"users:admin",purpose:"assistant"}),/daily limit/);
for(const row of db.rows.values())if(row._table==="aiCatalog")row.fetchedAt=0;
await control.saveSettings.handler(ctx,{...change,value:{...settings,enabled:false},expectedVersion:1,correlationId:"33333333-3333-4333-8333-333333333333"});
await assert.rejects(control.reserve.handler(ctx,{actor:"users:admin",purpose:"assistant"}),/paused/);
let calls=[], finishes=[];
const gatewayCtx = {runQuery:async()=>({models,fetchedAt:Date.now()}),runMutation:async(ref,args)=>{
 if(ref==="aiControl.reserve")return {id:"aiRequests:test",settings:c.AI_DEFAULTS,model:models.find(m=>m.id==="big-pickle")};
 if(ref==="aiControl.finish"){finishes.push(args);return null} throw Error("Unexpected mutation");
}};
env={OPENAI_API_KEY:"synthetic-openai",OPENCODE_GO_API_KEY:"synthetic-go"};
await assert.rejects(runtime.runZen(gatewayCtx,{actor:"users:admin",purpose:"assistant",system:"s",prompt:"p"}),/OPENCODE_ZEN_API_KEY/);
assert.equal(calls.length,0);env.OPENCODE_ZEN_API_KEY="synthetic-zen";
for(const [status,text,code] of [[402,"private provider detail","free_access_exhausted"],[403,"MissingSessionID secret","provider_restricted"],[429,"secret rate details","provider_rate_limit"],[500,"sensitive upstream response","provider_error"]]){
 calls=[];finishes=[]; network=async(url,options)=>{calls.push({url,options});return {ok:false,status,text:async()=>text}};
 await assert.rejects(runtime.runZen(gatewayCtx,{actor:"users:admin",purpose:"assistant",system:"s",prompt:"p"}),e=>e.code===code&&!e.message.includes(text));
 assert.equal(calls.length,1);assert.equal(calls[0].url,"https://opencode.ai/zen/v1/chat/completions");
 assert.equal(calls[0].options.headers.Authorization,"Bearer synthetic-zen");
 assert.equal(finishes[0].status,"failed");assert.equal(finishes[0].errorCode,code);
 assert(!/reasoning|variant|effort|synthetic-go|synthetic-openai/.test(calls[0].options.body));
}
network=async()=>({ok:true,json:async()=>({choices:[{message:{content:"READY"},finish_reason:"stop"}],usage:{prompt_tokens:2,completion_tokens:1}})});
assert.equal((await runtime.runZen(gatewayCtx,{actor:"users:admin",purpose:"assistant",system:"s",prompt:"p"})).text,"READY");
console.log("ZEN_ADMIN_BEHAVIOR=PASS free filtering, modalities, defaults, RBAC, CAS, exact retry, pause, budgets, usage, no paid fallback, provider error containment");

const ocr=load("aiGateway"), pdfOcr=load("incomingStockPdfOcr"); let purposes=[];
const ocrCtx={...gatewayCtx,allowed:true,runMutation:async(ref,args)=>{
 if(ref==="aiControl.reserve"){purposes.push(args.purpose);return{id:"aiRequests:ocr",settings:c.AI_DEFAULTS,model:args.purpose==="pdf"?pdf:models.find(m=>m.id==="image-free")}}
 return gatewayCtx.runMutation(ref,args);
}};
network=async(url,options)=>({ok:true,json:async()=>url.endsWith("/responses")?{output_text:"[]",status:"completed"}:{choices:[{message:{content:"[]"},finish_reason:"stop"}]}});
assert.equal(await ocr.ocrPackingList.handler(ocrCtx,{imageBase64:"eA==",prompt:"Synthetic",partList:["PART-1"]}),"[]");
assert.equal(await ocr.ocrDhrPage.handler(ocrCtx,{imageBase64:"eA==",prompt:"Synthetic",partList:["PART-1"]}),"[]");
assert.equal(await pdfOcr.ocrPackingListPdf.handler(ocrCtx,{pdfBase64:"JVBERi0=",prompt:"Synthetic",filename:"test.pdf",partList:["PART-1"]}),"[]");
assert.deepEqual(purposes,["receiving","dhr","pdf"]);
await assert.rejects(ocr.ocrPackingList.handler({...ocrCtx,allowed:false},{imageBase64:"eA==",prompt:"Synthetic"}),/Forbidden/);
await assert.rejects(pdfOcr.ocrPackingListPdf.handler({...ocrCtx,allowed:false},{pdfBase64:"JVBERi0=",prompt:"Synthetic"}),/Forbidden/);
console.log("Actual receiving image, DHR image and receiving PDF gateway delegation and authorization PASS");
