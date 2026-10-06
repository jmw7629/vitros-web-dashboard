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
const root=process.cwd();const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'rem-progress-browser-'));
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
let lvcc=[];let registered=[];
let taskNotes=[{id:'note-existing',stage:'Service',content:'Existing task note',engineerName:'Test Engineer',createdAt:'2026-10-06T12:00:00Z',acknowledgedAt:null,acknowledgedBy:null},{id:'note-cleaning',stage:'Cleaning',content:'Other task note',engineerName:'Test Engineer',createdAt:'2026-10-06T12:01:00Z',acknowledgedAt:null,acknowledgedBy:null}];
const noteCalls=[],ackCalls=[],receipts=new Map();
function pendingNotes(){const counts={};for(const n of taskNotes)if(!n.acknowledgedAt)counts[n.stage]=(counts[n.stage]??0)+1;return Object.entries(counts).map(([stage,count])=>({stage,count}));}

const visionKeys=['servicePct','finalLinePct','packagingPct','releaseTestingPct','qaReleasePct','sapReleasePct'];
const visionExisting={_id:'vision-existing',serialNumber:'SYNTHETIC-VISION',analyzerType:'VISION',currentStage:'Service',isComplete:false,stageProgress:Object.fromEntries(visionKeys.map(k=>[k,k==='servicePct'?25:null]))};
window.__remTest={saved,history,noteCalls,ackCalls,readNotes:()=>taskNotes};
const directory=[{id:'engineer-1',name:'Test Engineer',initials:'TE'},{id:'engineer-2',name:'Acknowledging Engineer',initials:'AE'}];
const actions={listTaskNotes:async()=>{if(window.__remTest.readFail)throw Error('Notes temporarily unavailable');return{notes:structuredClone(taskNotes),engineers:directory,canWrite:!window.__remTest.readOnly};},
addTaskNote:async(a)=>{noteCalls.push(a);if(receipts.has(a.correlationId))return{...receipts.get(a.correlationId),duplicate:true};const note={id:'new-note',stage:a.stage,content:a.content,engineerName:directory.find(e=>e.id===a.engineerId).name,createdAt:'2026-10-06T13:00:00Z',acknowledgedAt:null,acknowledgedBy:null};taskNotes=[...taskNotes,note];const receipt={duplicate:false,note};receipts.set(a.correlationId,receipt);if(window.__remTest.failAdd){window.__remTest.failAdd=false;throw Error('Note response lost');}return receipt;},
acknowledgeTaskNote:async(a)=>{ackCalls.push(a);if(window.__remTest.inactiveAck){window.__remTest.inactiveAck=false;throw Error('Choose an active engineer');}if(receipts.has(a.correlationId))return{...receipts.get(a.correlationId),duplicate:true};const original=taskNotes.find(n=>n.id===a.noteId);if(original.acknowledgedAt)throw Error('Note already acknowledged');const note={...original,acknowledgedAt:'2026-10-06T14:00:00Z',acknowledgedBy:directory.find(e=>e.id===a.engineerId).name};taskNotes=taskNotes.map(n=>n.id===note.id?note:n);const receipt={duplicate:false,note};receipts.set(a.correlationId,receipt);if(window.__remTest.failAck){window.__remTest.failAck=false;taskNotes=[...taskNotes,{...note,id:'concurrent-note',content:'Newer concurrent task note',engineerName:'Test Engineer',acknowledgedAt:null,acknowledgedBy:null}];throw Error('Acknowledgment response lost');}return receipt;},
getDetail:async(a)=>({record:a.recordId==='unit-1'?{...record,revision,progress:{...progress}}:{id:a.recordId,serialNumber:registered.find(r=>r._id===a.recordId)?.serialNumber??'SYNTHETIC-VISION',itemType:a.kind==='vision'?'VISION':'5600',currentStage:'Unassigned',revision:0,notes:'',progress:Object.fromEntries((a.kind==='vision'?visionKeys:stages).map(k=>[k,null])),updatedAt:'2026-10-06T17:00:00Z',engineerName:'Test Engineer'},engineers:directory,history:a.recordId==='unit-1'?[...history]:[],canWrite:true}),listEngineers:async()=>directory,updateProgress:async(a)=>{
 saved.push(a);if(window.__remTest.failOnce){window.__remTest.failOnce=false;throw Error('Network response lost; retry same update');}
 if(window.__remTest.conflict){throw Error('REM revision conflict');}
 if(!a.engineerId)throw Error('Choose an active engineer');
 revision++;progress={...a.progress};record={...record,currentStage:a.stage,notes:a.notes,progress,revision,engineerName:'Test Engineer',updatedAt:'2026-09-17T12:00:00Z'};
 history.unshift({id:'event-'+revision,engineerName:'Test Engineer',createdAt:'2026-09-17T12:00:00Z',stage:a.stage,progress,notes:a.notes});
 return {duplicate:false,record,createdAt:'2026-09-17T12:00:00Z',eventId:'event-'+revision};
 },createAnalyzer:async(a)=>{saved.push(a);if(window.__remTest.registrationFailOnce){window.__remTest.registrationFailOnce=false;throw Error('Registration response lost');}const r={_id:'registered-'+a.serialNumber,serialNumber:a.serialNumber,analyzerType:a.analyzerType,currentStage:'Unassigned',isComplete:false,stageProgress:Object.fromEntries((a.family==='VISION'?visionKeys:stages).map(k=>[k,null]))};registered=[...registered,r];return{record:{id:r._id,serialNumber:r.serialNumber}};},createLvcc:async(a)=>{saved.push(a);const r={_id:'lvcc-1',serialNumber:a.serialNumber,itemType:a.itemType,currentStage:'Build',isComplete:false,buildPct:0,testPct:0,packagingPct:0,qaReleasePct:0,sapReleasePct:0};lvcc=[r];return{record:{id:r._id,serialNumber:r.serialNumber}};}};
export const api={remProgressActions:{getDetail:'getDetail',updateProgress:'updateProgress',listEngineers:'listEngineers',createLvcc:'createLvcc',createAnalyzer:'createAnalyzer',listTaskNotes:'listTaskNotes',addTaskNote:'addTaskNote',acknowledgeTaskNote:'acknowledgeTaskNote'}};
export const useAction=(name)=>actions[name];
export function useRemCoreData(){const[,refresh]=useState(0);return{analyzers:[{_id:'unit-1',serialNumber:'SYNTHETIC-5600',analyzerType:'5600',pendingNotes:pendingNotes(),currentStage:record.currentStage,isComplete:false,overallPct:null,daysInStage:null,slaDays:null,stageProgress:progress,...progress},visionExisting,...registered],lvccItems:lvcc,weeklyNotes:[],isLoading:false,error:null,refresh:async()=>refresh(x=>x+1)}};
export function RemOperationalRecords(){return <p>Source review records</p>}
`);
await build({root:dir,configFile:false,logLevel:'warn',plugins:[{name:'mock-rem-boundaries',enforce:'pre',resolveId(source){if(source==='convex/react'||source.endsWith('/_generated/api')||source.endsWith('/hooks/useRemCoreData')||source.endsWith('/RemOperationalRecords')||source==='./RemOperationalRecords')return path.join(dir,'mock.tsx');}},react(),tailwind()],resolve:{alias:{'@':path.join(root,'src')}},build:{outDir:path.join(dir,'dist'),emptyOutDir:true}});
const server=http.createServer((req,res)=>{const f=path.join(dir,'dist',req.url==='/'?'index.html':req.url.split('?')[0]);if(!fs.existsSync(f)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(f));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.REM_BROWSER_EXECUTABLE_PATH?{executablePath:process.env.REM_BROWSER_EXECUTABLE_PATH}:{})});
const artifacts=path.resolve(process.env.REM_NOTES_BROWSER_ARTIFACT_DIR??'.verification/rem-task-notes');fs.mkdirSync(artifacts,{recursive:true});
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.locator('button button').count(),0);
  await page.getByRole('button',{name:'1 note · Service',exact:true}).click();
  const modal=page.getByRole('dialog');
  await modal.getByRole('combobox',{name:'Task',exact:true}).waitFor();
  assert.equal(await modal.getByRole('combobox',{name:'Task',exact:true}).inputValue(),'Service');
  await modal.getByLabel('New task note',{exact:true}).fill('New task observation');
  assert.equal(await modal.getByRole('button',{name:'Add task note',exact:true}).isDisabled(),true);
  await modal.getByRole('combobox',{name:'Note engineer',exact:true}).selectOption('engineer-1');
  await page.evaluate(()=>window.__remTest.failAdd=true);
  await modal.getByRole('button',{name:'Add task note',exact:true}).click();
  await modal.getByRole('button',{name:'Retry note',exact:true}).waitFor();
  assert.equal(await modal.getByLabel('New task note',{exact:true}).isDisabled(),true);
  await page.evaluate(()=>window.__remTest.readFail=true);
  await modal.getByRole('button',{name:'Reload notes',exact:true}).click();
  await modal.getByRole('alert').filter({hasText:'Notes temporarily unavailable'}).waitFor();
  assert.equal(await modal.getByLabel('New task note',{exact:true}).inputValue(),'New task observation');
  await page.evaluate(()=>window.__remTest.readFail=false);
  await modal.getByRole('button',{name:'Retry note',exact:true}).click();
  await modal.getByText('This task note was already recorded.',{exact:true}).waitFor();
  assert.equal(await modal.getByLabel('New task note',{exact:true}).inputValue(),'');
  const noteCalls=await page.evaluate(()=>window.__remTest.noteCalls);assert.equal(noteCalls.length,2);assert.equal(noteCalls[0].correlationId,noteCalls[1].correlationId);
  const original=modal.getByRole('listitem').filter({hasText:'Existing task note'});
  assert.equal(await original.getByRole('button',{name:'Acknowledge',exact:true}).isDisabled(),true);
  await modal.getByRole('combobox',{name:'Acknowledging engineer',exact:true}).selectOption('engineer-2');
  await page.evaluate(()=>window.__remTest.failAck=true);
  await original.getByRole('button',{name:'Acknowledge',exact:true}).click();
  await modal.getByRole('button',{name:'Retry acknowledgment',exact:true}).waitFor();
  assert.equal(await modal.getByRole('combobox',{name:'Acknowledging engineer',exact:true}).isDisabled(),true);
  await modal.getByRole('button',{name:'Retry acknowledgment',exact:true}).click();
  await original.getByText(/Acknowledged by Acknowledging Engineer/).waitFor();
  await modal.getByText('Newer concurrent task note',{exact:true}).waitFor();
  assert((await original.innerText()).includes('Test Engineer'));
  const ackCalls=await page.evaluate(()=>window.__remTest.ackCalls);assert.equal(ackCalls.length,2);assert.equal(ackCalls[0].correlationId,ackCalls[1].correlationId);assert.equal(ackCalls[0].noteId,'note-existing');
  await original.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`notes-history-${width}.png`)});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'2 notes · Service',exact:true}).waitFor();
  await page.getByRole('button',{name:'1 note · Cleaning',exact:true}).waitFor();
  await page.screenshot({path:path.join(artifacts,`notes-tracker-${width}.png`)});
  await page.getByRole('button',{name:'Kanban',exact:true}).click();
  await page.getByRole('button',{name:'2 notes · Service',exact:true}).click();
  await modal.getByRole('combobox',{name:'Acknowledging engineer',exact:true}).selectOption('engineer-2');
  await modal.getByRole('listitem').filter({hasText:'New task observation'}).getByRole('button',{name:'Acknowledge',exact:true}).click();
  await modal.getByRole('listitem').filter({hasText:'New task observation'}).getByText(/Acknowledged by Acknowledging Engineer/).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'1 note · Service',exact:true}).waitFor();
  await page.getByRole('button',{name:'1 note · Cleaning',exact:true}).waitFor();
  await page.screenshot({path:path.join(artifacts,`notes-kanban-${width}.png`)});
  await page.getByRole('button',{name:'Tracker',exact:true}).click();
  await page.getByRole('button',{name:/^Cleaning/}).filter({hasText:'1 note'}).click();
  assert.equal(await modal.getByRole('combobox',{name:'Task',exact:true}).inputValue(),'Cleaning');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'1 note · Service',exact:true}).click();
  await modal.getByRole('combobox',{name:'Acknowledging engineer',exact:true}).selectOption('engineer-1');
  await page.evaluate(()=>window.__remTest.inactiveAck=true);
  await modal.getByRole('listitem').filter({hasText:'Newer concurrent task note'}).getByRole('button',{name:'Acknowledge',exact:true}).click();
  await modal.getByRole('alert').filter({hasText:'Choose an active engineer'}).waitFor();
  assert.equal(await modal.getByRole('combobox',{name:'Acknowledging engineer',exact:true}).isDisabled(),false);
  assert.equal(await modal.getByRole('combobox',{name:'Acknowledging engineer',exact:true}).inputValue(),'');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.__remTest.readOnly=true);
  await page.getByRole('button',{name:'1 note · Cleaning',exact:true}).click();
  await modal.getByText('Read-only access. Your role cannot write task notes.',{exact:true}).waitFor();
  assert.equal(await modal.getByRole('combobox',{name:'Acknowledging engineer',exact:true}).count(),0);
  assert.equal(await modal.getByRole('button',{name:'Add task note',exact:true}).count(),0);
  assert.deepEqual(errors,[]);await page.close();
  console.log(`REM task notes ${width}px: task flags in both views, engineer-gated notes/acknowledgment, stable retries, draft preservation, exact-note clearing, concurrent-note retention, history and read-only access PASS`);
 }
}catch(e){const p=browser.contexts()[0]?.pages()[0];if(p){console.error(await p.locator('body').innerText());await p.screenshot({path:path.join(artifacts,'failure.png')});}throw e;}finally{await browser.close();server.close();}
