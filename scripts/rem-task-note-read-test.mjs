import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import{v}from'convex/values';
const compile=(file,require,extra={})=>{const out={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out.exports,require,...extra});return out.exports;};
let deny=false,noteFailure=false,calls=[];const id='11111111-1111-4111-8111-111111111111',lv='22222222-2222-4222-8222-222222222222';
const contract=compile('convex/remProgressContract.ts',()=>{});
const actions=compile('convex/remReadActions.ts',name=>{
 if(name==='convex/values')return{v};if(name==='./_generated/server')return{action:x=>x};if(name==='./remProgressContract')return contract;
 if(name==='./authGuard')return{requireCapability:async()=>{if(deny)throw Error('Not authorized');return 'server-actor';}};throw Error(name);
},{process:{env:{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only'}},fetch:async(url,init)=>{
 calls.push({url,body:init.body?JSON.parse(init.body):null});
 const notes=url.includes('/rpc/rem_task_note_summaries');
 return {ok:!notes||!noteFailure,status:notes&&noteFailure?503:200,json:async()=>notes?[{kind:'vision',recordId:id,pendingNotes:[{stage:'Service',count:2}]},{kind:'lvcc',recordId:lv,pendingNotes:[{stage:'Test',count:1}]}]:url.includes('/rem_analyzers?')?[{id,analyzer_type:'VISION',serial_number:'VISION-SYNTHETIC',current_stage:'Service'}]:url.includes('/rem_lvcc?')?[{id:lv,serial_number:'LVCC-SYNTHETIC',item_type:'Electrometer'}]:[]};
}});
deny=true;await assert.rejects(actions.listCore.handler({},{}),/authorized/);assert.equal(calls.length,0);deny=false;
const data=await actions.listCore.handler({},{});assert.equal(data.analyzers[0].pendingNotes[0].stage,'Service');assert.equal(data.analyzers[0].pendingNotes[0].count,2);assert.equal(data.lvccItems[0].pendingNotes[0].stage,'Test');
const request=calls.find(x=>x.body);assert.deepEqual(request.body,{p_analyzer_ids:[id],p_lvcc_ids:[lv]});assert(!JSON.stringify(data).includes('test-only'));
noteFailure=true;await assert.rejects(actions.listCore.handler({},{}),/note indicators are unavailable/);
console.log('REM task indicators: authenticated reads, exact record scope, family/task counts and fail-closed note availability PASS');
