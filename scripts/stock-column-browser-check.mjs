import fs from "node:fs";import path from "node:path";import os from "node:os";import http from "node:http";import assert from "node:assert/strict";import react from "@vitejs/plugin-react";import tailwind from "@tailwindcss/vite";import{build}from"vite";import{chromium}from"playwright";
const root=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),"rem-stock-columns-")),artifacts=process.env.STOCK_BROWSER_ARTIFACT_DIR??path.join(dir,"artifacts");
fs.mkdirSync(artifacts,{recursive:true});fs.symlinkSync(path.join(root,"node_modules"),path.join(dir,"node_modules"));
const write=(n,s)=>fs.writeFileSync(path.join(dir,n),s);
write("package.json",'{"type":"module"}');
write("index.html",'<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
write("style.css",'@import '+JSON.stringify(path.join(root,"src/index.css"))+';\n@source '+JSON.stringify(path.join(root,"src"))+';\nbody{margin:0;background:#0c111b;color:#f1f5f9}');
write("entry.tsx",'import React from"react";import{createRoot}from"react-dom/client";import{StockSummary}from"'+(process.env.STOCK_SOURCE_FILE??root+'/src/pages/inventory/StockSummary')+'";import"./style.css";createRoot(document.getElementById("root")!).render(<main style={{maxWidth:1200,margin:"auto",padding:16}}><StockSummary/></main>);');
write("convex-fixture.ts","export const useAction=()=>async()=>({});");
write("fixture.ts","import {TABLE_DEFAULTS} from \"__ROOT__/convex/configDefaults\";\nconst mode=new URLSearchParams(location.search).get(\"columns\")??\"all\";\nconst columns=mode===\"reordered\"?[...TABLE_DEFAULTS.stockSummaryColumns].reverse().filter(c=>![\"onPlan\",\"module\"].includes(c.key)).map(c=>({...c,label:c.key===\"description\"?\"Detailed inventory description\":c.label})):mode===\"compact\"?TABLE_DEFAULTS.stockSummaryColumns.filter(c=>[\"partNumber\",\"qoh\",\"type\"].includes(c.key)):TABLE_DEFAULTS.stockSummaryColumns;\nconst parts=[{_id:\"one\",partNumber:\"180030\",description:\"WASHER, PRECISION INSTRUMENT MOUNTING HARDWARE WITH LONG DESCRIPTION\",type:\"Not on BOM\",qoh:56,minQty:0,maxQty:0,onPlan:false,binLocation:\"A1\",module:\"Chassis\"},\n{_id:\"two\",partNumber:\"192418\",description:\"PUMPASSEMBLYWITHAVERYLONGUNBROKENDESCRIPTIONANDADDITIONALDETAILS\",type:\"Unclassified\",qoh:170,minQty:1,maxQty:2,onPlan:true,binLocation:\"Long bin location with multiple words\",module:\"Fluid systems\"},\n{_id:\"three\",partNumber:\"1C2082\",description:\"Hardware\",type:\"Required\",qoh:0,minQty:1,maxQty:1,onPlan:true,binLocation:\"\",module:\"\"}];\nexport const useConvexData=()=>({parts,transactions:[],kits:[]});\nconst getStockSummaryColumns=()=>columns;\nexport const useConfig=()=>({getStockSummaryColumns,get:key=>key===\"forms.partMasterFields\"?[]:key===\"defaults.partType\"?\"Required\":null});\nexport const useRole=()=>({role:\"superuser\"});\nexport const useFormatDate=()=>value=>String(value);\n".replaceAll("__ROOT__",root));
let browser,server;const report={checks:[],errors:[]};
try{
await build({configFile:false,root:dir,plugins:[{name:"stock-test-boundaries",enforce:"pre",resolveId(id){
if(id==="convex/react")return path.join(dir,"convex-fixture.ts");
if(["/hooks/useConvexData","/hooks/useConfig","/hooks/useRole","/hooks/useFormatters"].some(s=>id.endsWith(s)))return path.join(dir,"fixture.ts");
if(id.endsWith("/components/vitros/SharedComponents"))return path.join(root,"src/components/vitros/SharedComponents.tsx");
}},react(),tailwind()],resolve:{alias:{"@":path.join(root,"src")}},build:{outDir:path.join(dir,"dist")}});
const dist=path.join(dir,"dist");server=http.createServer((req,res)=>{const url=new URL(req.url,"http://localhost"),file=path.resolve(dist,"."+url.pathname+(url.pathname.endsWith("/")?"index.html":""));if(path.relative(dist,file).startsWith("..")||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader("Content-Type",({".js":"text/javascript",".css":"text/css",".html":"text/html"})[path.extname(file)]??"application/octet-stream");res.end(fs.readFileSync(file))});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const base="http://127.0.0.1:"+server.address().port;
browser=await chromium.launch({headless:true,...(process.env.STOCK_BROWSER_EXECUTABLE_PATH?{executablePath:process.env.STOCK_BROWSER_EXECUTABLE_PATH}:{})});
for(const width of [390,320,1440])for(const mode of ["all","reordered","compact"]){
const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(10000);
page.on("pageerror",e=>report.errors.push(String(e)));page.on("console",m=>{if(m.type()==="error")report.errors.push(m.text())});
await page.goto(base+"/?columns="+mode);const grids=page.locator('div[style*="grid-template-columns"]');
assert.equal(await grids.count(),4);
const checkGeometry=async()=>{
 const geometry=await grids.evaluateAll(rows=>rows.map(row=>[...row.children].map(cell=>{const r=cell.getBoundingClientRect();return{x:r.x,width:r.width,text:cell.textContent}})));
 const header=geometry[0];for(const row of geometry.slice(1)){assert.equal(row.length,header.length);row.forEach((cell,i)=>{assert(Math.abs(cell.x-header[i].x)<1,"Header/body x mismatch at "+header[i].text+": "+JSON.stringify({header:header[i],cell}));assert(Math.abs(cell.width-header[i].width)<1,"Column width mismatch at "+header[i].text)})}
 const d=header.findIndex(c=>c.text.includes("Description")||c.text.includes("description"));if(d>=0){assert(header[d].width>=240,"Description must retain readable width");assert(geometry[1][d].width>=240)}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,"Only table should scroll");
};
await checkGeometry();
const scroll=page.locator("div.overflow-x-auto").last();
if(mode!=="compact"){if(width<640)assert(await scroll.evaluate(e=>e.scrollWidth>e.clientWidth));await scroll.evaluate(e=>{e.scrollLeft=310});await checkGeometry();await page.screenshot({path:path.join(artifacts,mode+"-"+width+"-middle.png"),fullPage:true});await scroll.evaluate(e=>{e.scrollLeft=e.scrollWidth});await checkGeometry()}
await scroll.evaluate(e=>{e.scrollLeft=0});
await page.screenshot({path:path.join(artifacts,mode+"-"+width+".png"),fullPage:true});
if(mode==="all"){await page.getByRole("button",{name:"QOH",exact:true}).click();await checkGeometry();assert((await grids.nth(1).innerText()).includes("1C2082"));await page.getByPlaceholder("Search part # or description...").fill("WASHER");assert.equal(await grids.count(),2);await checkGeometry()}
report.checks.push({width,mode,aligned:true,scroll:true,descriptionWidth:true});await context.close();
}
assert.deepEqual(report.errors,[]);report.passed=true;console.log("STOCK_COLUMN_GEOMETRY=PASS default/reordered/hidden columns at phone and desktop widths, scrolling, sorting and search");
}catch(e){report.passed=false;report.failure=String(e.stack);const p=browser?.contexts()[0]?.pages()[0];if(p)await p.screenshot({path:path.join(artifacts,"failure.png"),fullPage:true});console.error(e);process.exitCode=1}finally{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));fs.writeFileSync(path.join(artifacts,"report.json"),JSON.stringify(report,null,2))}
