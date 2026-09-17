// Exercises shipped components with synthetic API boundaries. No production writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { build, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { chromium } from 'playwright';
const root=process.cwd();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rem-progress-browser-'));
fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'junction');
fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');
fs.writeFileSync(path.join(dir,'index.html'),'<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
fs.writeFileSync(path.join(dir,'entry.tsx'),`import React from 'react';import{createRoot}from'react-dom/client';import{RemWorkboard}from'${normalizePath(path.join(root,'src/components/vitros/RemWorkboard.tsx'))}';import'./style.css';createRoot(document.getElementById('root')!).render(<main><RemWorkboard kiosk/></main>);`);
fs.writeFileSync(path.join(dir,'style.css'),`@import ${JSON.stringify(normalizePath(path.join(root,'src/index.css')))};@source ${JSON.stringify(normalizePath(path.join(root,'src')))};body{background:#0c111b;color:#f1f5f9;margin:0}main{max-width:1200px;padding:20px;margin:auto}`);
fs.writeFileSync(path.join(dir,'mock.tsx'),`
import React,{useState}from'react';
const stages=['procurementPct','cleaningPct','servicePct','finalLinePct','packagingPct','releaseTestingPct','qaReleasePct','sapReleasePct'];
let progress=Object.fromEntries(stages.map(k=>[k,k==='servicePct'?25:0]));let revision=0;let saved=[];let history=[];
let record={id:'unit-1',serialNumber:'SYNTHETIC-5600',itemType:'5600',currentStage:'Service',revision,notes:'',progress,updatedAt:null,engineerName:null};
let lvcc=[];
window.__remTest={saved,history};
const directory=[{id:'engineer-1',name:'Test Engineer',initials:'TE'}];
const actions={getDetail:async()=>({record:{...record,revision,progress:{...progress}},engineers:directory,history:[...history],canWrite:true}),listEngineers:async()=>directory,updateProgress:async(a)=>{
 saved.push(a);if(window.__remTest.failOnce){window.__remTest.failOnce=false;throw Error('Network response lost; retry same update');}
 if(window.__remTest.conflict){throw Error('REM revision conflict');}
 if(!a.engineerId)throw Error('Choose an active engineer');
 revision++;progress={...a.progress};record={...record,currentStage:a.stage,notes:a.notes,progress,revision,engineerName:'Test Engineer',updatedAt:'2026-09-17T12:00:00Z'};
 history.unshift({id:'event-'+revision,engineerName:'Test Engineer',createdAt:'2026-09-17T12:00:00Z',stage:a.stage,progress,notes:a.notes});
 return {duplicate:false,record,createdAt:'2026-09-17T12:00:00Z',eventId:'event-'+revision};
 },createLvcc:async(a)=>{saved.push(a);const r={_id:'lvcc-1',serialNumber:a.serialNumber,itemType:a.itemType,currentStage:'Build',isComplete:false,buildPct:0,testPct:0,packagingPct:0,qaReleasePct:0,sapReleasePct:0};lvcc=[r];return{record:{id:r._id,serialNumber:r.serialNumber}};}};
export const api={remProgressActions:{getDetail:'getDetail',updateProgress:'updateProgress',listEngineers:'listEngineers',createLvcc:'createLvcc'}};
export const useAction=(name)=>actions[name];
export function useRemCoreData(){const[,refresh]=useState(0);return{analyzers:[{_id:'unit-1',serialNumber:'SYNTHETIC-5600',analyzerType:'5600',currentStage:record.currentStage,isComplete:false,overallPct:25,daysInStage:2,slaDays:30,...progress}],lvccItems:lvcc,weeklyNotes:[],isLoading:false,error:null,refresh:async()=>refresh(x=>x+1)}};
export function RemOperationalRecords(){return <p>Source review records</p>}
`);
await build({root:dir,configFile:false,logLevel:'warn',plugins:[{name:'mock-rem-boundaries',enforce:'pre',resolveId(source){if(source==='convex/react'||source.endsWith('/_generated/api')||source.endsWith('/hooks/useRemCoreData')||source.endsWith('/RemOperationalRecords')||source==='./RemOperationalRecords')return path.join(dir,'mock.tsx');}},react(),tailwind()],resolve:{alias:{'@':path.join(root,'src')}},build:{outDir:path.join(dir,'dist'),emptyOutDir:true}});
const server=http.createServer((req,res)=>{const f=path.join(dir,'dist',req.url==='/'?'index.html':req.url.split('?')[0]);if(!fs.existsSync(f)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(f));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.REM_BROWSER_EXECUTABLE_PATH?{executablePath:process.env.REM_BROWSER_EXECUTABLE_PATH}:{})});
const artifacts=path.resolve(process.env.REM_BROWSER_ARTIFACT_DIR??'.verification/rem-progress');fs.mkdirSync(artifacts,{recursive:true});
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:/SYNTHETIC-5600.*Open progress/}).click();
  const modal=page.getByRole('dialog');await modal.getByRole('combobox',{name:'Engineer',exact:true}).waitFor();
  await modal.getByRole('spinbutton',{name:'Service percentage',exact:true}).fill('50');
  assert.equal(await modal.getByRole('button',{name:'Save progress',exact:true}).isDisabled(),true);
  await modal.getByRole('combobox',{name:'Engineer',exact:true}).selectOption('engineer-1');
  await modal.getByRole('spinbutton',{name:'Service percentage',exact:true}).fill('101');
  await modal.getByRole('button',{name:'Save progress',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'whole numbers from 0 to 100'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__remTest.saved.length),0);
  await modal.getByRole('spinbutton',{name:'Service percentage',exact:true}).fill('50');
  await page.evaluate(()=>window.__remTest.failOnce=true);
  await modal.getByRole('button',{name:'Save progress',exact:true}).click();
  await modal.getByRole('button',{name:'Retry same update',exact:true}).click();
  await modal.getByRole('status').filter({hasText:'Saved by Test Engineer'}).waitFor();
  const requests=await page.evaluate(()=>window.__remTest.saved);assert.equal(requests.length,2);assert.equal(requests[0].correlationId,requests[1].correlationId);assert.equal(requests[0].progress.servicePct,50);
  assert.equal(await modal.getByRole('combobox',{name:'Engineer',exact:true}).inputValue(),'');
  await page.screenshot({path:path.join(artifacts,`progress-${width}.png`),fullPage:true});
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Kanban',exact:true}).click();
  await page.getByRole('button',{name:/SYNTHETIC-5600.*Open progress/}).click();await modal.getByRole('combobox',{name:'Engineer',exact:true}).waitFor();assert.equal(await modal.getByRole('spinbutton',{name:'Service percentage',exact:true}).inputValue(),'50');
  await modal.getByRole('combobox',{name:'Engineer',exact:true}).selectOption('engineer-1');await modal.getByRole('spinbutton',{name:'Service percentage',exact:true}).fill('75');await page.evaluate(()=>window.__remTest.conflict=true);await modal.getByRole('button',{name:'Save progress',exact:true}).click();await modal.getByRole('alert').filter({hasText:'revision conflict'}).waitFor();assert.equal(await modal.getByRole('spinbutton',{name:'Service percentage',exact:true}).inputValue(),'75');
  await modal.getByRole('button',{name:'Reload latest record and discard draft'}).click();assert.equal(await modal.getByRole('spinbutton',{name:'Service percentage',exact:true}).inputValue(),'50');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'LVCC / 450',exact:true}).click();await page.getByRole('region',{name:'LVCC whiteboard'}).waitFor();await page.screenshot({path:path.join(artifacts,`lvcc-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Register LVCC unit'}).click();await modal.getByRole('combobox',{name:'Engineer',exact:true}).waitFor();assert.equal(await modal.getByRole('button',{name:'Register unit',exact:true}).isDisabled(),true);
  await modal.getByLabel('Serial / unit identifier').fill('SYNTHETIC-LVCC');await modal.getByRole('combobox',{name:'Engineer',exact:true}).selectOption('engineer-1');await modal.getByRole('button',{name:'Register unit',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.__remTest.saved)).at(-1).engineerId,'engineer-1');assert.deepEqual(errors,[]);
  await page.close();console.log(`REM progress browser ${width}px: percentage validation, engineer gate, stable retry, history, Kanban parity, conflicts, LVCC registration passed.`);
 }
}finally{await browser.close();server.close();}
