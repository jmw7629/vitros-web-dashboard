import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import http from "node:http"; import assert from "node:assert/strict";
import react from "@vitejs/plugin-react"; import tailwind from "@tailwindcss/vite"; import {build} from "vite"; import {chromium} from "playwright";
const root=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),"rem-ai-browser-")),artifacts=process.env.AI_BROWSER_ARTIFACT_DIR??path.join(dir,"artifacts");
fs.mkdirSync(artifacts,{recursive:true});fs.symlinkSync(path.join(root,"node_modules"),path.join(dir,"node_modules"));
const write=(n,s)=>fs.writeFileSync(path.join(dir,n),s);
write("package.json",'{"type":"module"}');
write("index.html",'<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
write("style.css",'@import '+JSON.stringify(path.join(root,"src/index.css"))+';\n@source '+JSON.stringify(path.join(root,"src"))+';\nbody{margin:0;background:#0c111b;color:#f1f5f9}');
write("entry.tsx",'import React from "react";import{createRoot}from"react-dom/client";import{AiAdministration}from"'+root+'/src/pages/AiAdministration";import"./style.css";createRoot(document.getElementById("root")!).render(<main style={{padding:16,maxWidth:800,margin:"auto"}}><AiAdministration/></main>);');
write("api.ts",'export const api=new Proxy({},{get:()=>new Proxy({},{get:(_,key)=>key})});');
write("role.ts",'export function useRole(){return {role:location.search.includes("engineer")?"engineer":"superuser"}}');
write("convex.ts","\nimport {useSyncExternalStore} from \"react\";\nimport {AI_DEFAULTS} from \"__ROOT__/convex/aiContract\";\nconst models=[\n{id:\"big-pickle\",name:\"Big Pickle\",inputs:[\"text\"],api:\"chat\",maxOutput:8192,privacy:\"Data may improve the model.\"},\n{id:\"image-free\",name:\"Image Free\",inputs:[\"text\",\"image\"],api:\"chat\",maxOutput:8192,privacy:\"Fixture policy\"},\n{id:\"pdf-free\",name:\"PDF Free\",inputs:[\"text\",\"image\",\"pdf\"],api:\"responses\",maxOutput:8192,privacy:\"Fixture policy\"}];\nlet data={settings:{...AI_DEFAULTS,imageModel:\"image-free\",pdfModel:\"pdf-free\"},version:0,catalog:{models,fetchedAt:Date.now()},daily:{requests:0,succeeded:0,failed:0,inputTokens:0,outputTokens:0},requests:[],audit:[]};\nconst f=window.fixture={calls:[],key:false,loseResponse:true};\nconst listeners=new Set(), notify=()=>listeners.forEach(fn=>fn()),subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};\nf.activity=()=>{data={...data,daily:{...data.daily,requests:1}};notify()};\nconst actions=new Map();\nexport function useQuery(ref){return useSyncExternalStore(subscribe,()=>data)}\nexport function useMutation(ref){return useAction(ref)}\nexport function useAction(ref){if(!actions.has(ref))actions.set(ref,async args=>{\nf.calls.push({ref,args:structuredClone(args)});\nif(ref===\"connectionStatus\")return{keyConfigured:f.key};\nif(ref===\"refreshModels\"){data={...data,catalog:{models,fetchedAt:Date.now()}};notify();return models}\nif(ref===\"testConnection\")return{text:\"READY\",model:data.settings.textModel};\nif(ref===\"askModel\")return{text:\"Synthetic model response\",model:args.modelId};\nif(ref===\"saveSettings\"){\n if(f.saved?.correlationId===args.correlationId){if(JSON.stringify(f.saved)!==JSON.stringify(args))throw Error(\"Different retry\");return{version:data.version,duplicate:true}}\n if(args.expectedVersion!==data.version)throw Error(\"AI settings changed in another window. Reload before saving.\");\n await new Promise(resolve=>{f.release=resolve});\n f.saved=structuredClone(args);const previous=data.settings;\n data={...data,settings:args.value,version:data.version+1,audit:[{_id:\"audit-\"+(data.version+1),version:data.version+1,createdAt:Date.now(),reason:args.reason,previous,value:args.value},...data.audit]};notify();\n if(f.loseResponse){f.loseResponse=false;throw Error(\"Lost response\")}\n return{version:data.version,duplicate:false};\n}\nthrow Error(\"Unexpected \"+ref);\n});return actions.get(ref)}\n".replaceAll("__ROOT__",root));
let browser,server;const report={checks:[],errors:[],external:[]};
try{
 await build({configFile:false,root:dir,plugins:[{name:"ai-test-boundaries",enforce:"pre",resolveId(id){
 if(id==="convex/react")return path.join(dir,"convex.ts");if(id.endsWith("/_generated/api"))return path.join(dir,"api.ts");if(id.endsWith("/hooks/useRole"))return path.join(dir,"role.ts");
 }},react(),tailwind()],build:{outDir:path.join(dir,"dist")}});
 const dist=path.join(dir,"dist");
 server=http.createServer((req,res)=>{const url=new URL(req.url,"http://localhost"),file=path.resolve(dist,"."+url.pathname+(url.pathname.endsWith("/")?"index.html":""));if(path.relative(dist,file).startsWith("..")||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader("Content-Type",({".js":"text/javascript",".css":"text/css",".html":"text/html"})[path.extname(file)]??"application/octet-stream");res.end(fs.readFileSync(file))});
 await new Promise(r=>server.listen(0,"127.0.0.1",r));const base="http://127.0.0.1:"+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.AI_BROWSER_EXECUTABLE_PATH?{executablePath:process.env.AI_BROWSER_EXECUTABLE_PATH}:{})});
 for(const width of [1440,390,320]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
 page.on("pageerror",e=>report.errors.push(String(e)));page.on("console",m=>{if(m.type()==="error")report.errors.push(m.text())});
 await page.route("**/*",route=>{if(route.request().url().startsWith(base))return route.continue();report.external.push(route.request().url());return route.abort()});
 await page.goto(base);await page.getByRole("heading",{name:"AI Administration",exact:true}).waitFor();
 assert(await page.getByRole("button",{name:"Run prompt",exact:true}).isDisabled());
 assert.deepEqual(await page.getByLabel("Image model",{exact:true}).locator("option").evaluateAll(els=>els.map(e=>e.value)),["image-free","pdf-free"]);
 await page.getByLabel("Requests per UTC day",{exact:true}).fill("700");await page.evaluate(()=>window.fixture.activity());
 assert.equal(await page.getByLabel("Requests per UTC day",{exact:true}).inputValue(),"700");
 await page.getByLabel("Reason for change").fill("Synthetic reviewed update");
 await page.getByRole("button",{name:"Review changes",exact:true}).click();
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.ref==="saveSettings").length),0);
 await page.getByRole("button",{name:"Apply changes",exact:true}).click();
 await page.waitForFunction(()=>!!window.fixture.release);
 assert(await page.getByRole("button",{name:"Retry same change",exact:true}).isDisabled());
 await page.evaluate(()=>window.fixture.release());
 await page.getByRole("alert").waitFor();
 await page.getByRole("button",{name:"Retry same change",exact:true}).click();
 await page.getByText("AI settings saved as version 1.",{exact:true}).waitFor();
 const saves=await page.evaluate(()=>window.fixture.calls.filter(c=>c.ref==="saveSettings").map(c=>c.args));
 assert.equal(saves.length,2);assert.deepEqual(saves[0],saves[1]);
 await page.getByRole("button",{name:"Load previous settings for review",exact:true}).click();
 assert.equal(await page.getByLabel("Requests per UTC day",{exact:true}).inputValue(),"500");
 await page.getByRole("button",{name:"Review changes",exact:true}).click();
 await page.getByRole("button",{name:"Apply changes",exact:true}).click();
 await page.waitForFunction(()=>window.fixture.calls.filter(c=>c.ref==="saveSettings").length===3);
 await page.evaluate(()=>window.fixture.release());await page.getByText("AI settings saved as version 2.",{exact:true}).waitFor();
 await page.evaluate(()=>{window.fixture.key=true});await page.getByRole("button",{name:"Refresh status",exact:true}).click();
 await page.getByRole("button",{name:"Test saved text model",exact:true}).click();
 await page.getByText("Connection succeeded using big-pickle: READY",{exact:true}).waitFor();
 await page.getByLabel("Prompt",{exact:true}).fill("Synthetic prompt");
 await page.getByRole("button",{name:"Run prompt",exact:true}).click();
 await page.getByLabel("Model response",{exact:true}).waitFor();
 assert.equal(await page.getByLabel("Model response",{exact:true}).innerText(),"Synthetic model response");
 await page.screenshot({path:path.join(artifacts,"ai-admin-"+width+".png"),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.goto(base+"/?engineer");await page.getByText("Superuser access is required.",{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);
 report.checks.push({width,dirtyEditsPreserved:true,reviewBeforeWrite:true,lostResponseRetry:true,rollback:true,prompt:true,engineerBlocked:true,noOverflow:true});await context.close();
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);report.passed=true;console.log("ZEN_AI_ADMIN_BROWSER=PASS desktop, mobile, review, exact retry, rollback, role boundary and model workspace");
}catch(e){report.passed=false;report.failure=String(e.stack);console.error(e);process.exitCode=1}
finally{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));fs.writeFileSync(path.join(artifacts,"report.json"),JSON.stringify(report,null,2))}
