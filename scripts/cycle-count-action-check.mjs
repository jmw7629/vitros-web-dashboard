import fs from "node:fs";import vm from "node:vm";import assert from "node:assert/strict";import {createRequire} from "node:module";import path from "node:path";
const req=createRequire(process.env.VITROS_TEST_NODE_MODULES?path.join(process.env.VITROS_TEST_NODE_MODULES,"entry.cjs"):import.meta.url),ts=req("typescript");
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",cid="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function fixture({allowed=true,enabled=true,status=200,message="internal database detail"}={}){
 const f={calls:[],caps:[],pulses:0},cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const deps={"./_generated/server":{action:x=>x},"./_generated/api":{internal:{configActions:{getConfigValueInternal:"enabled"}}},
   "convex/values":{v:new Proxy({},{get:()=>()=>({})})},
   "./authGuard":{requireCapability:async(_,cap)=>{f.caps.push(cap);if(!allowed)throw Error("Denied");return "trusted-user";}},
   "./supabaseGateway":{getSupabaseConfig:()=>({url:"https://synthetic.invalid",serviceKey:"server-only"})},
   "./realtimePulsePublisher":{publishRealtimePulse:async()=>{f.pulses++;}},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   exports,require:n=>n==="./cycleCountContract"?load("convex/cycleCountContract.ts"):deps[n],Number,String,Object,Array,Set,Error,JSON,
   fetch:async(url,options)=>{f.calls.push({url,...options});return{ok:status===200,status,json:async()=>status===200?{sessionId:id,revision:1,status:"active"}:{message}};}
  });return exports;
 }
 const actions=load("convex/cycleCountActions.ts"),ctx={runQuery:async()=>enabled};
 f.run=(changes={})=>actions.saveSession.handler(ctx,{operation:"save",sessionId:id,correlationId:cid,expectedRevision:0,sortMode:"alpha",lines:[{partNumber:"R1",countedQty:0,incomingQty:null,stockToken:"stock-token"}],...changes});
 f.read=()=>actions.loadData.handler(ctx,{});return f;
}
let passed=0;async function test(name,fn){await fn();passed++;console.log("PASS "+name);}
await test("Unauthenticated writes and reads stop before storage",async()=>{for(const call of ["run","read"]){const f=fixture({allowed:false});await assert.rejects(f[call](),/Denied/);assert.equal(f.calls.length,0);}});
await test("Saving uses inventory.write, confirmation uses inventory.admin, actor is trusted",async()=>{for(const operation of ["save","pause","confirm"]){const f=fixture();await f.run({operation,...(operation==="confirm"?{adjustmentBasis:"counted",wipFingerprint:"fingerprint"}:{})});assert.equal(f.caps[0],operation==="confirm"?"inventory.admin":"inventory.write");const body=JSON.parse(f.calls[0].body);assert.equal(body.p_actor,"trusted-user");assert.equal(body.p_operation,operation);assert.equal(f.calls.length,1);assert.equal(f.pulses,operation==="save"?0:1);assert.equal(body.p_payload.lines[0].countedQty,0);}});
await test("Disabled feature blocks mutation",async()=>{const f=fixture({enabled:false});await assert.rejects(f.run(),/disabled/);assert.equal(f.calls.length,0);});
await test("Invalid quantities, duplicates, stale revision format and missing review basis never reach database",async()=>{for(const changes of [{sessionId:"bad"},{correlationId:"bad"},{expectedRevision:-1},{expectedRevision:0.5},{operation:"confirm"},{lines:[{partNumber:"R1",countedQty:-1,incomingQty:null,stockToken:"x"}]},{lines:[{partNumber:"R1",countedQty:1.2,incomingQty:null,stockToken:"x"}]},{lines:[{partNumber:"R1",countedQty:1,incomingQty:null,stockToken:null}]},{lines:[{partNumber:"R1",countedQty:null,incomingQty:null,stockToken:null},{partNumber:"r1",countedQty:null,incomingQty:null,stockToken:null}]}]){const f=fixture();await assert.rejects(f.run(changes));assert.equal(f.calls.length,0);}});
await test("Business conflicts are visible; internal database errors are sanitized",async()=>{const f=fixture({status:409,message:"Stock changed during count for R1"});await assert.rejects(f.run(),/Stock changed/);assert.equal(f.pulses,0);const g=fixture({status:500,message:"private SQL schema details"});await assert.rejects(g.run(),e=>e.message.includes("request failed")&&!e.message.includes("private"));});
console.log("CYCLE_COUNT_ACTIONS="+passed+" passed");
