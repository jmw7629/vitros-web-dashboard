import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as XLSX from 'xlsx';
const v = new Proxy({}, { get: () => () => ({}) });
function load(path, dependencies, extra={}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, TextEncoder, Date, ...extra, require: name => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }});
  return exports;
}
const validation = load('convex/remOperationalImportValidation.ts', { 'convex/values': {v} });
const record = (dataset, data, year=2026) => ({ dataset, data, sourceKey: validation.operationalSourceKey(year,dataset,data),sourceSheet:'Synthetic',sourceRow:2 });
const good = [
  record('field_status',{product:'VITROS',batch:'BATCH:Á /1',orderReference:'2026-01',finalLine:1,release:2,partsNotCertified:'J001,J002',sourceNumericText:{finalLine:'1'}}),
  record('lvcc_reviews',{partNumber:'J123',weekNumber:2,weekStart:'2026-01-05',sourceWeekStart:'2025-01-05',reviewIds:[{slot:1,value:'REVIEW-1',sourceCell:'F2'}],listedCount:1,recordedTotal:2,totalDifference:-1}),
  record('install_parts',{serviceOrder:'SO-1',equipmentNumber:'EQ-1',partNumber:'J123',completedAt:'2026-01-02T13:14:15',equipmentPartKey:'EQ-1_J123',yearMonth:'2026-01',quantity:-1,costUsd:-4.5,partCostUsd:-3.5}),
  record('certified_parts',{serviceOrder:'SO-1',partLineNumber:'1',laborLineNumber:'0',partNumber:'J123',lineType:'PART',equipmentNumber:'EQ-1',equipmentPartKey:'EQ-1_J123',quantity:1,partCostUsd:3.5,allCostUsd:4.5}),
  record('summary_targets',{product:'VITROS',quarter:'Q1',targetValue:10,annualTargetValue:40,trackerPlanValue:11,planVariance:1}),
];
for (const r of good) validation.validateOperationalRecord(r,2026);
for (const [index, mutate] of [
  [0,r=>r.sourceKey='forged'],[0,r=>r.data.product='FAKE'],[0,r=>r.data.unknown='field'],[0,r=>r.data.finalLine=1.5],
  [0,r=>r.data.releaseFpyPct=101],[1,r=>r.data.reviewIds[0].sourceCell='F3'],[1,r=>r.data.weekStart='2025-01-05'],
  [1,r=>r.data.totalDifference=0],[2,r=>r.data.completedAt='2026-02-30T13:14:15'],[3,r=>r.data.partLineNumber=''],
  [4,r=>r.data.planVariance=9],
]) {
  const r=structuredClone(good[index]); mutate(r); assert.throws(()=>validation.validateOperationalRecord(r,2026));
}
const parser = load('src/lib/remOperationalWorkbook.ts', {'xlsx':XLSX});
if (process.env.REM_WORKBOOK_PATH) {
  const workbook=XLSX.read(fs.readFileSync(process.env.REM_WORKBOOK_PATH),{type:'buffer',cellDates:true,cellFormula:true});
  const preview=parser.parseRemOperationalWorkbook(workbook,2026);
  for (const r of preview.records) validation.validateOperationalRecord(r,2026);
  console.log(`REAL_WORKBOOK_SERVER_VALIDATION=PASS rows=${preview.records.length}`);
}
console.log('REM_OPERATIONAL_TYPED_BOUNDS_KEYS_DATES_PROVENANCE=PASS');

// Execute the actual registered action handlers with isolated provider/identity
// boundaries. These assertions cover actor binding and response containment.
let nextReceipt;
let errorStatus=0;
let readFailureBody=false;
const requests=[];
const actions=load('convex/remOperationalImportActions.ts', {
  'convex/values':{v}, './_generated/server':{action:x=>x},
  './remOperationalImportValidation':validation,
  './authGuard':{requireCapability:async(ctx,capability)=>{
    if(!ctx.allowed.includes(capability))throw new Error('capability denied');
    return 'canonical-server-actor';
  }},
}, {
  process:{env:{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-only'}},
  fetch:async(url,options)=>{
    requests.push({url,payload:JSON.parse(options.body)});
    return {ok:!errorStatus,status:errorStatus||200,json:async()=>{
      if(errorStatus){readFailureBody=true;return {message:'must never reach caller'};}
      return typeof nextReceipt==='function'?nextReceipt(url):nextReceipt;
    }};
  },
});
const importId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const baseProgress={importId,planYear:2026,expectedRows:1,receivedRows:0,nextBatchIndex:0,status:'staging'};
const beginArgs={fileHash:'a'.repeat(64),planYear:2026,expectedRows:1,actor:'caller-must-not-win'};
await assert.rejects(actions.beginOperationalImport.handler({allowed:[]},beginArgs),/capability denied/);
assert.equal(requests.length,0);
nextReceipt=baseProgress;
await actions.beginOperationalImport.handler({allowed:['rem.write']},beginArgs);
assert.equal(requests.at(-1).payload.p_actor,'canonical-server-actor');
for(const bad of [
  {...baseProgress,nextBatchIndex:-1}, {...baseProgress,receivedRows:1,nextBatchIndex:0},
  {...baseProgress,status:'applied'}, {...baseProgress,nextBatchIndex:2},
]) {
  nextReceipt=bad;
  await assert.rejects(actions.beginOperationalImport.handler({allowed:['rem.write']},beginArgs),/Invalid REM import receipt/);
}
nextReceipt=url=>url.includes('get_rem_')?baseProgress:{...baseProgress,receivedRows:1,nextBatchIndex:1,duplicate:false};
await actions.stageOperationalImport.handler({allowed:['rem.write']},{importId,batchIndex:0,records:[good[0]]});
assert.equal(requests.at(-1).payload.p_actor,'canonical-server-actor');
nextReceipt={records:[],total:0,offset:0,limit:50,hasMore:false};
await actions.listOperationalRecords.handler({allowed:['rem.read']},{dataset:'field_status',planYear:2026,offset:0,limit:50,query:' Synthetic ',product:' vitros '});
assert.equal(requests.at(-1).payload.p_plan_year,2026);
assert.equal(requests.at(-1).payload.p_product,'VITROS');
errorStatus=400;
await assert.rejects(actions.beginOperationalImport.handler({allowed:['rem.write']},beginArgs),/validation or retry conflict/);
assert.equal(readFailureBody,false);
console.log('REM_OPERATIONAL_ACTION_AUTH_ACTOR_PROGRESS_ERROR_CONTAINMENT=PASS');

// The real combined finalize action preserves its existing core validation and
// only translates the one actionable, exact database error marker. No arbitrary
// provider text may be reflected even when a response body is valid JSON.
let coreFailure;
let coreStatus=400;
let pulses=0;
const coreRequests=[];
const coreActions=load('convex/remWorkbookActions.ts', {
  'convex/values':{v}, './_generated/server':{action:x=>x},
  './authGuard':{requireCapability:async(ctx,capability)=>{
    if(!ctx.allowed.includes(capability))throw new Error('capability denied');
    return 'canonical-server-actor';
  }},
  './realtimePulsePublisher':{publishRealtimePulse:async()=>{pulses++;}},
}, {
  process:{env:{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-only'}},
  fetch:async(url,options)=>{
    coreRequests.push({url,payload:JSON.parse(options.body)});
    return {ok:coreStatus===200,status:coreStatus,json:async()=>{
      if(coreFailure instanceof Error)throw coreFailure;
      return coreFailure;
    }};
  },
});
const coreArgs={
  fileName:'Synthetic.xlsx',fileHash:'c'.repeat(64),planYear:2026,sourceSheet:'Synthetic WIP',sourceWeek:18,operationalImportId:importId,
  analyzers:Array.from({length:5},(_,n)=>({serialNumber:String(10000001+n),analyzerType:'5600',cleaningPct:0,servicePct:0,finalLinePct:0,releaseTestingPct:0,packagingPct:0})),
  trackerWeekly:Array.from({length:40},(_,n)=>({sourceKey:`2026:tracker:VITROS:${n+1}`,year:2026,product:'VITROS',quarter:'Q1',weekNumber:n+1,plan:2})),
  buildPlan:Array.from({length:20},(_,n)=>({sourceKey:`2026:build-plan:${n+1}`,year:2026,quarter:'Q1',weekNumber:n+1,data:{plan:5}})),
  staff:Array.from({length:5},(_,n)=>({sourceKey:`2026:staff:${n+1}`,year:2026,wwid:String(100001+n),name:`Synthetic Staff ${n+1}`,skills:{},certifications:{}})),
  weeklyNotes:[],targets:[{sourceKey:'2026:target:VITROS_ANNUAL_PLAN',year:2026,targetType:'VITROS_ANNUAL_PLAN',targetValue:10,actualValue:0,data:{}}],
};
await assert.rejects(coreActions.applyAuthoritativeWorkbookImport.handler({allowed:[]},coreArgs),/capability denied/);
await assert.rejects(coreActions.applyAuthoritativeWorkbookImport.handler({allowed:['rem.write']},{...coreArgs,operationalImportId:'malformed'}),/Invalid REM operational import identifier/);
await assert.rejects(coreActions.applyAuthoritativeWorkbookImport.handler({allowed:['rem.write']},{...coreArgs,analyzers:[]}),/Invalid analyzer row count/);
assert.equal(coreRequests.length,0);
coreFailure={message:'partial_lvcc_reviews_changed_source_requires_review',details:'private provider text'};
await assert.rejects(coreActions.applyAuthoritativeWorkbookImport.handler({allowed:['rem.write']},coreArgs),error=>{
  assert.equal(error.message,'This sheet moved existing reviews. Restore or review the current review IDs before applying this workbook.');
  return true;
});
const genericFailure='REM authoritative import could not be confirmed (400). Keep the same workbook preview and retry to recover its import receipt.';
for(const failure of [
  null,'private provider text',{},
  {message:'private provider text',details:'credentials must stay private'},
  {message:'partial_lvcc_reviews_changed_source_requires_review: private provider text'},
  {message:['partial_lvcc_reviews_changed_source_requires_review']},
  new Error('private response decoding failure'),
]) {
  coreFailure=failure;
  await assert.rejects(coreActions.applyAuthoritativeWorkbookImport.handler({allowed:['rem.write']},coreArgs),error=>{
    assert.equal(error.message,genericFailure);return true;
  });
}
assert.equal(pulses,0);
assert.match(coreRequests.at(-1).url,/\/apply_rem_full_workbook_import$/);
assert.equal(coreRequests.at(-1).payload.p_operational_import_id,importId);
assert.equal(coreRequests.at(-1).payload.p_actor,'canonical-server-actor');
coreStatus=200;coreFailure={already_applied:true,operational:{import_id:importId,rows:1,inserted:1,updated:0,unchanged:0,datasets:{field_status:1}}};
await coreActions.applyAuthoritativeWorkbookImport.handler({allowed:['rem.write']},coreArgs);
assert.equal(pulses,1);
await coreActions.applyAuthoritativeWorkbookImport.handler({allowed:['rem.write']},{...coreArgs,operationalImportId:undefined});
assert.match(coreRequests.at(-1).url,/\/apply_rem_authoritative_workbook_import$/);
assert.equal('p_operational_import_id' in coreRequests.at(-1).payload,false);
console.log('REM_FULL_ACTION_CORE_VALIDATION_WHITELIST_ERROR_CONTAINMENT=PASS');
