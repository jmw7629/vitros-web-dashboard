import fs from "node:fs";import path from "node:path";import os from "node:os";import http from "node:http";import assert from "node:assert/strict";import react from "@vitejs/plugin-react";import tailwind from "@tailwindcss/vite";import {build} from "vite";import {chromium} from "playwright";
const root=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),"vitros-cycle-browser-")),artifacts=process.env.CYCLE_BROWSER_ARTIFACT_DIR??path.join(dir,"artifacts");
fs.mkdirSync(artifacts,{recursive:true});fs.symlinkSync(path.join(root,"node_modules"),path.join(dir,"node_modules"));
const write=(n,s)=>fs.writeFileSync(path.join(dir,n),s);
write("package.json",'{"type":"module"}');
write("index.html",'<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
write("style.css",'@import '+JSON.stringify(path.join(root,"src/index.css"))+';\n@source '+JSON.stringify(path.join(root,"src"))+';\nbody{margin:0;background:#0c111b;color:#f1f5f9}');
write("entry.tsx",'import React from "react";import{createRoot}from"react-dom/client";import{BrowserRouter}from"react-router-dom";import{CycleCount}from"'+root+'/src/pages/inventory/CycleCount";import"./style.css";createRoot(document.getElementById("root")!).render(<BrowserRouter><main style={{padding:16}}><CycleCount/></main></BrowserRouter>);');
write("api.ts",'export const api=new Proxy({},{get:()=>new Proxy({},{get:(_,key)=>key})});');
write("role.ts",'export function useRole(){return {role:"superuser"}}');
write("data.ts",'export function useConvexData(){return {parts:window.fixture.wip.parts.map(p=>({...p,_id:p.partNumber,qoh:p.systemQty})),refresh:async()=>{},updatePart:()=>{throw Error("Direct stock mutation forbidden")}}}');
write("convex.ts",`
import{useSyncExternalStore}from"react";
const id="11111111-1111-4111-8111-111111111111",sid="22222222-2222-4222-8222-222222222222";
const parts=[["R10","Required",5,2],["R2","Required",2,0],["A1","Optional",0,0],["C1","Consumable",3,1],["N1","Not on BOM",0,0],["U1","Unclassified",0,0]].map(([partNumber,type,systemQty,qty])=>({partNumber,type,description:type,systemQty,stockToken:"token-"+partNumber,minQty:1,maxQty:10,onPlan:true,wipEntries:{SN1:qty}}));
const f=window.fixture={calls:[],wip:{serials:["SN1"],parts,fingerprint:"wip-1",loadedAt:Date.now(),unmatchedParts:0}};
const schedule={_id:id,name:"W2W",frequency:"Weekly",assignedTo:"Fixture",nextDue:Date.now(),status:"active",parts:["R10"],countType:"standard"};
let listeners=new Set(),version=0;
f.changeWip=()=>{f.wip.parts[0].wipEntries.SN1=5;f.wip.serials=["SN1","SN2"];f.wip.fingerprint="wip-2";version++;listeners.forEach(fn=>fn());};
const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};
const user={_id:"fixture-user"},actions=new Map();
export const useConvexAuth=()=>({isAuthenticated:true});
export function useQuery(ref,args){const n=useSyncExternalStore(subscribe,()=>version);return ref==="currentUser"?user:{version:n};}
export function useAction(ref){if(!actions.has(ref))actions.set(ref,async args=>{
 f.calls.push({ref,args:structuredClone(args)});
 if(ref==="loadData")return {schedules:[schedule],results:[],wip:structuredClone(f.wip),moreHistory:false};
 let saved=JSON.parse(localStorage.getItem("cycle-session")??"null");
 if(ref==="startSession"){
  if(!saved||saved.status==="completed")saved={id:sid,schedule_id:id,status:"active",revision:0,scope_mode:"w2w",scope_parts:parts.map(p=>p.partNumber),lines:[],sort_mode:"w2w",saved_at:new Date().toISOString()};
  else {saved.status="active";saved.revision++;}
  localStorage.setItem("cycle-session",JSON.stringify(saved));return {session:saved,wip:structuredClone(f.wip)};
 }
 if(ref==="saveSession"){
  if(saved.revision!==args.expectedRevision)throw Error("Cycle count conflict");
  saved={...saved,lines:args.lines,revision:saved.revision+1,status:args.operation==="pause"?"paused":args.operation==="confirm"?"completed":"active",saved_at:new Date().toISOString()};
  localStorage.setItem("cycle-session",JSON.stringify(saved));return{sessionId:sid,status:saved.status,revision:saved.revision,savedAt:saved.saved_at};
 }
 throw Error("Unexpected action "+ref);
});return actions.get(ref)}
`);
let browser,server;const report={checks:[],errors:[],external:[]};
try{
 await build({configFile:false,root:dir,plugins:[{name:"cycle-boundaries",enforce:"pre",resolveId(id){
 if(id==="convex/react")return path.join(dir,"convex.ts");if(id.endsWith("/_generated/api"))return path.join(dir,"api.ts");if(id.endsWith("/hooks/useRole"))return path.join(dir,"role.ts");if(id.endsWith("/hooks/useConvexData"))return path.join(dir,"data.ts");
 }},react(),tailwind()],resolve:{alias:{"@":path.join(root,"src")}},build:{outDir:path.join(dir,"dist")}});
 const dist=path.join(dir,"dist");server=http.createServer((req,res)=>{const url=new URL(req.url,"http://localhost"),file=path.resolve(dist,"."+url.pathname+(url.pathname.endsWith("/")?"index.html":""));if(path.relative(dist,file).startsWith("..")||!fs.existsSync(file)){res.writeHead(404).end();return;}res.setHeader("Content-Type",({".js":"text/javascript",".css":"text/css",".html":"text/html"})[path.extname(file)]??"application/octet-stream");res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,"127.0.0.1",r));const base="http://127.0.0.1:"+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.CYCLE_BROWSER_EXECUTABLE_PATH?{executablePath:process.env.CYCLE_BROWSER_EXECUTABLE_PATH}:{})});
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  page.on("pageerror",e=>report.errors.push(String(e)));page.on("console",m=>{if(m.type()==="error")report.errors.push(m.text())});
  await page.route("**/*",route=>{if(route.request().url().startsWith(base))return route.continue();report.external.push(route.request().url());return route.abort();});
  await page.clock.install();await page.goto(base);await page.getByRole("button",{name:"▶"}).click();
  const counted=page.locator('input[aria-label^="Counted "]');
  await counted.first().waitFor();assert.deepEqual(await counted.evaluateAll(els=>els.map(e=>e.getAttribute("aria-label"))),["Counted R2","Counted R10","Counted A1","Counted C1","Counted N1","Counted U1"]);
  assert.equal(await page.getByLabel("WIP SN1 R10",{exact:true}).inputValue(),"2");
  assert(await page.getByLabel("WIP SN1 R10",{exact:true}).evaluate(e=>e.readOnly));
  await page.getByLabel("Counted R10",{exact:true}).fill("4");
  await page.clock.fastForward(31000);
  await page.waitForFunction(()=>window.fixture.calls.some(c=>c.ref==="saveSession"&&c.args.operation==="save"));
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("cycle-session")).lines[0].countedQty),4);
  await page.evaluate(()=>window.fixture.changeWip());
  await page.waitForFunction(()=>document.querySelector('input[aria-label="WIP SN1 R10"]').value==="5");
  assert.equal(await page.getByLabel("Counted R10",{exact:true}).inputValue(),"4");
  assert.equal(await page.getByLabel("WIP SN2 R10",{exact:true}).inputValue(),"0");
  await page.getByRole("button",{name:"Save & Exit"}).click();await counted.first().waitFor({state:"detached"});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("cycle-session")).status),"paused");
  await page.reload();await page.getByRole("button",{name:"▶"}).click();await counted.first().waitFor();
  assert.equal(await page.getByLabel("Counted R10",{exact:true}).inputValue(),"4");
  await page.getByRole("button",{name:"Confirm & Close"}).click();
  await page.getByRole("dialog").waitFor();assert(await page.getByRole("button",{name:"Apply adjustments and close"}).isDisabled());
  await page.getByLabel("Stock adjustment basis").selectOption("counted");assert(await page.getByRole("button",{name:"Apply adjustments and close"}).isEnabled());
  await page.screenshot({path:path.join(artifacts,"cycle-review-"+width+".png"),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole("button",{name:"Apply adjustments and close"}).click();await page.getByRole("dialog").waitFor({state:"detached"});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("cycle-session")).status),"completed");
  report.checks.push({width,autosave30Seconds:true,saveExit:true,reloadRestores:true,allPartTypesOrdered:true,liveWip:true,reviewAndConfirm:true});
  await context.close();
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);report.passed=true;console.log("CYCLE_COUNT_BROWSER=PASS desktop/mobile actual page and hooks, synthetic authenticated transport");
}catch(e){report.passed=false;report.failure=String(e.stack);console.error(e);process.exitCode=1;}finally{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));fs.writeFileSync(path.join(artifacts,"report.json"),JSON.stringify(report,null,2));}
