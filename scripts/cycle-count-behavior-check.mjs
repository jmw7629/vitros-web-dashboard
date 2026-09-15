import fs from "node:fs";import path from "node:path";import vm from "node:vm";import assert from "node:assert/strict";import {createRequire} from "node:module";import {randomUUID} from "node:crypto";
const root=path.resolve(new URL("..",import.meta.url).pathname);
const req=createRequire(process.env.VITROS_TEST_NODE_MODULES?path.join(process.env.VITROS_TEST_NODE_MODULES,"entry.cjs"):import.meta.url);
const projectRequire=createRequire(path.join(root,"package.json")),React=req("react"),{create,act}=req("react-test-renderer"),ts=req("typescript");
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const text=n=>typeof n==="string"?n:(n?.children??[]).map(text).join("");
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(){
 const f={role:"superuser",calls:[],timers:new Map(),nextTimer:0,revision:0,wip:{serials:["SN1"],fingerprint:"wip-1",loadedAt:Date.now(),unmatchedParts:0,parts:[
  {partNumber:"R10",description:"Required ten",type:"Required",systemQty:5,stockToken:"stock-1",minQty:1,maxQty:9,onPlan:true,wipEntries:{SN1:2}},
  {partNumber:"R2",description:"Required two",type:"required",systemQty:2,stockToken:"stock-2",minQty:1,maxQty:9,onPlan:true,wipEntries:{SN1:0}},
  {partNumber:"A1",description:"Optional",type:"Optional",systemQty:0,stockToken:"stock-3",minQty:1,maxQty:9,onPlan:false,wipEntries:{SN1:0}},
  {partNumber:"Z1",description:"Consumable",type:"Consumable",systemQty:3,stockToken:"stock-4",minQty:1,maxQty:9,onPlan:false,wipEntries:{SN1:1}},
 ]},schedule:{_id:"11111111-1111-4111-8111-111111111111",name:"W2W",frequency:"Weekly",assignedTo:"Fixture",nextDue:Date.now(),status:"active",parts:["R10"],countType:"standard"}};
 f.session={id:"22222222-2222-4222-8222-222222222222",schedule_id:f.schedule._id,status:"active",scope_mode:"w2w",scope_parts:["R10","R2","A1","Z1"],revision:0,lines:[],sort_mode:"w2w",saved_at:new Date().toISOString()};
 const actions=new Map(),cache=new Map();
 function load(relative){
  let file=path.resolve(root,relative);if(!fs.existsSync(file))file=[".ts",".tsx",".mjs"].map(ext=>file+ext).find(fs.existsSync);assert(file,relative);
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const scoped=name=>{
   if(name==="react")return React;if(name==="react/jsx-runtime")return req(name);
   if(name==="convex/react")return{useAction:ref=>{
    if(!actions.has(ref))actions.set(ref,async args=>{
     f.calls.push({ref,args:structuredClone(args)});
     if(ref==="startSession")return{session:structuredClone(f.session),wip:structuredClone(f.wip)};
     if(ref==="saveSession"){if(f.save)return f.save(args);f.session={...f.session,lines:structuredClone(args.lines),revision:++f.revision,status:args.operation==="pause"?"paused":args.operation==="confirm"?"completed":"active"};return{sessionId:f.session.id,revision:f.revision,status:f.session.status,savedAt:new Date().toISOString()};}
     throw new Error("Unexpected mutation "+ref);
    });return actions.get(ref);
   }};
   if(name.endsWith("/_generated/api"))return{api:new Proxy({},{get:()=>new Proxy({},{get:(_,name)=>name})})};
   if(name.endsWith("/hooks/useRole"))return{useRole:()=>({role:f.role})};
   if(name.endsWith("/hooks/useConvexData"))return{useConvexData:()=>({parts:f.wip.parts.map(p=>({...p,_id:p.partNumber,qoh:p.systemQty})),refresh:async()=>{},updatePart:()=>{throw new Error("Direct stock update forbidden");}})};
   if(name.endsWith("/hooks/useCycleCountData"))return{useCycleCountData:()=>({schedules:[f.schedule],results:[],wip:f.wip,error:null,loading:false,refresh:async()=>{},setWip:()=>{}}),useCycleScheduleMutation:()=>()=>{throw new Error("Unexpected schedule mutation");}};
   if(name.endsWith("/vitros/SharedComponents"))return{WebCard:p=>React.createElement("div",p),DashCard:p=>React.createElement("div",null,p.label),ProgressBar:()=>null,StatusBadge:()=>null,EmptyState:()=>null,Pill:()=>null,theme:{},formatDate:()=>""};
   if(name.endsWith("/ui/dialog"))return{Dialog:({open,children})=>open?children:null,DialogContent:p=>React.createElement("section",{...p,role:"dialog"}),DialogTitle:p=>React.createElement("h2",p),DialogDescription:p=>React.createElement("p",p)};
   if(name==="xlsx")return{};if(name==="file-saver")return{saveAs(){}};
   if(name.startsWith("."))return load(path.relative(root,path.resolve(path.dirname(file),name)));
   try{return req(name);}catch{return projectRequire(name);}
  };
  const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:scoped,console,Date,Math,Map,Set,JSON,Number,String,Object,Error,Promise,structuredClone,crypto:{randomUUID},
   setInterval:(fn,ms)=>{const id=++f.nextTimer;f.timers.set(id,{fn,ms});return id;},clearInterval:id=>f.timers.delete(id),window:{confirm:()=>false}},{filename:file});
  return module.exports;
 }
 f.load=load;return f;
}
async function hook(){
 const f=fixture(),{useActiveCycleSession}=f.load("src/hooks/useActiveCycleSession.ts");
 function Probe(){f.hook=useActiveCycleSession(f.wip,()=>{});return null;}
 let renderer;await act(async()=>{renderer=create(React.createElement(Probe));});
 f.start=()=>act(async()=>{assert.equal(await f.hook.start(f.schedule),true);});
 f.update=(part,field,value)=>act(async()=>f.hook.update(part,field,value));
 f.tick=()=>act(async()=>{for(const timer of [...f.timers.values()])if(timer.ms===30000)await timer.fn();});
 f.close=()=>act(async()=>renderer.unmount());return f;
}
let passed=0;
async function test(name,fn){await fn();console.log("PASS "+name);passed++;}
await test("No timer before Play; exactly 30 seconds after start; timer survives edits",async()=>{
 const f=await hook();assert.equal(f.timers.size,0);await f.start();assert.deepEqual([...f.timers.values()].map(x=>x.ms),[30000]);
 const timer=[...f.timers.keys()][0];await f.update("R10","counted","0");assert.equal([...f.timers.keys()][0],timer);
 await f.tick();const saves=f.calls.filter(x=>x.ref==="saveSession");assert.equal(saves.length,1);assert.equal(saves[0].args.lines[0].countedQty,0);
 assert.equal(saves[0].args.lines[0].incomingQty,null);assert.equal(saves[0].args.operation,"save");await f.close();assert.equal(f.timers.size,0);
});
await test("Save and Exit waits for a durable pause and removes the active timer",async()=>{
 const f=await hook();await f.start();await f.update("R10","counted","4");
 const waiting=deferred();f.save=()=>waiting.promise;let result;await act(async()=>{result=f.hook.save("pause");});
 assert(f.hook.session);assert(f.hook.saving);
 await act(async()=>{waiting.resolve({sessionId:f.session.id,revision:1,status:"paused",savedAt:new Date().toISOString()});await result;});
 assert.equal(f.hook.session,null);assert.equal(f.timers.size,0);assert.equal(f.calls.at(-1).args.operation,"pause");await f.close();
});
await test("A failed Save and Exit preserves entries and retries the exact request",async()=>{
 const f=await hook();await f.start();await f.update("R10","counted","4");f.save=async()=>{throw new Error("Network unavailable");};
 await act(async()=>{assert.equal(await f.hook.save("pause"),false);});const first=f.calls.at(-1).args;
 assert(f.hook.session);assert.equal(f.hook.inputs[0].countedQty,4);
 f.save=async()=>({sessionId:f.session.id,revision:1,status:"paused",savedAt:new Date().toISOString()});
 await act(async()=>{assert.equal(await f.hook.save("pause"),true);});
 assert.deepEqual(f.calls.at(-1).args,first);assert.equal(f.hook.session,null);await f.close();
});
await test("An autosave acknowledgement does not overwrite newer input",async()=>{
 const f=await hook();await f.start();await f.update("R10","counted","4");
 const wait=deferred();f.save=()=>wait.promise;let result;await act(async()=>{result=f.hook.save("save");});
 await f.update("R10","counted","7");
 await act(async()=>{wait.resolve({sessionId:f.session.id,revision:1,status:"active",savedAt:new Date().toISOString()});await result;});
 assert.equal(f.hook.inputs[0].countedQty,7);assert.equal(f.hook.session.revision,1);await f.close();
});
await test("W2W contains every stock type in Required-first natural order; WIP follows current DHR values",async()=>{
 const f=fixture(),state=f.load("src/lib/cycleCountState.ts");const scope=state.scopeParts(f.session,f.wip,"w2w");
 const lines=state.displayCountLines(scope,[{partNumber:"R10",countedQty:4,incomingQty:0,stockToken:"stock-1"}],f.wip);
 assert.deepEqual(Array.from(state.sortCountLines(lines,"w2w"),x=>x.partNumber),["R2","R10","A1","Z1"]);
 assert.equal(lines.find(x=>x.partNumber==="R10").wipEntries.SN1,"2");
 f.wip.parts[0].wipEntries.SN1=5;f.wip.parts[0].stockToken="changed";f.wip.serials.push("SN2");
 const updated=state.displayCountLines(scope,[{partNumber:"R10",countedQty:4,incomingQty:0,stockToken:"stock-1"}],f.wip);
 assert.equal(updated[0].wipEntries.SN1,"5");assert.equal(updated[0].wipEntries.SN2,"0");assert.equal(updated[0].stockChanged,true);assert.equal(updated[0].countedQty,"4");
 f.wip.serials=[];assert.equal(Object.keys(state.displayCountLines(scope,[],f.wip)[0].wipEntries).length,0);
});
await test("A definitive stock conflict allows recount; an uncertain confirmation cannot be silently retried by autosave",async()=>{
 const f=await hook();await f.start();await f.update("R10","counted","4");
 const review={adjustmentBasis:"counted",lines:structuredClone(f.hook.inputs),wipFingerprint:"wip-1"};
 f.save=async()=>{throw new Error("Stock changed during count for R10");};await act(async()=>f.hook.save("confirm",review));
 await f.update("R10","counted","3");assert.equal(f.hook.inputs[0].countedQty,3);
 f.save=async()=>{throw new Error("Network unavailable");};await act(async()=>f.hook.save("confirm",{...review,lines:structuredClone(f.hook.inputs)}));
 const count=f.calls.length;await f.tick();assert.equal(f.calls.length,count);await f.close();
});
await test("Actual Cycle Count page starts W2W, shows read-only DHR WIP and Save and Exit",async()=>{
 const f=fixture(),{CycleCount}=f.load("src/pages/inventory/CycleCount.tsx");let renderer;
 await act(async()=>{renderer=create(React.createElement(CycleCount));});
 const play=renderer.root.findAllByType("button").find(x=>text(x).includes("▶"));assert(play);await act(async()=>play.props.onClick());
 const counted=renderer.root.findAllByType("input").filter(x=>String(x.props["aria-label"]).startsWith("Counted "));
 assert.equal(counted.length,4);assert.deepEqual(counted.map(x=>x.props["aria-label"]),["Counted R2","Counted R10","Counted A1","Counted Z1"]);
 const wip=renderer.root.findAllByType("input").filter(x=>String(x.props["aria-label"]).startsWith("WIP "));assert.equal(wip.length,4);assert(wip.every(x=>x.props.readOnly));
 const save=renderer.root.findAllByType("button").find(x=>text(x).includes("Save & Exit"));await act(async()=>save.props.onClick());
 assert.equal(f.calls.at(-1).args.operation,"pause");assert.equal(renderer.root.findAllByProps({"aria-label":"Counted R10"}).length,0);
 await act(async()=>renderer.unmount());
});
console.log("CYCLE_COUNT_BEHAVIOR="+passed+" passed (actual modules; synthetic transport and virtual timers)");
