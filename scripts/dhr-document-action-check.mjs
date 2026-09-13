import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
const v=new Proxy({},{get:()=>()=>({})});
class ConvexError extends Error {constructor(data){super(data.message);this.data=data;}}
function load(path,deps,extra={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,...extra,require:name=>{if(name in deps)return deps[name];throw new Error(`Unexpected dependency ${name}`);}});return exports;
}
const contract=load('src/lib/dhrDocumentContract.ts',{});
const manifest={schemaVersion:1,templateId:'synthetic:document',documentRevision:'TEST-1',analyzerModel:'5600',artifactSha256:'a'.repeat(64),bindings:[{fieldId:'synthetic.quantity.a',sectionId:'SYNTHETIC',partNumber:'ABC123',kind:'consumable_part',quantityMode:'integer'},{fieldId:'synthetic.quantity.b',sectionId:'SYNTHETIC',partNumber:'ABC123',kind:'consumable_part',quantityMode:'integer'}]};
contract.validateDhrBindingManifest(manifest);
for(const changed of [m=>m.bindings[1].fieldId=m.bindings[0].fieldId,m=>m.bindings[0].coordinates=[1,2],m=>m.bindings[0].quantityMode='inferred',m=>m.artifactSha256='missing']){const m=structuredClone(manifest);changed(m);assert.throws(()=>contract.validateDhrBindingManifest(m));}
const event={eventId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',idempotencyKey:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',documentInstanceId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',documentTemplateId:manifest.templateId,documentRevision:manifest.documentRevision,fieldId:'synthetic.quantity.a',fieldVersion:1,sectionId:'SYNTHETIC',partNumber:'ABC123',previousQuantity:0,quantity:2,instrumentSn:'56009999',occurredAt:'2026-09-13T00:00:00.000Z'};
const receipt={...event,woNumber:null,status:'consumed',duplicate:false,delta:2,inventoryPartNumber:'ABC123',stockId:'ffffffff-ffff-4fff-8fff-ffffffffffff',stockBefore:20,stockAfter:18,auditId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sapStagingId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',correlationId:`digital-dhr:${event.idempotencyKey}`,operatorId:'server-user',operatorInitials:'SA',actor:'Synthetic Alice (SA)',processedAt:'2026-09-13T00:00:01Z'};
contract.validateDigitalDhrEvent(event);contract.validateDigitalDhrReceipt(receipt);
assert.throws(()=>contract.validateDigitalDhrEvent({...event,occurredAt:'2026-02-30T00:00:00Z'}));
contract.validateDigitalDhrReceipt({...receipt,status:'ignored',delta:0,inventoryPartNumber:null,stockId:null,stockBefore:null,stockAfter:null,auditId:null,sapStagingId:null});
for(const altered of [r=>r.stockAfter=17,r=>r.delta=1,r=>r.auditId=null,r=>r.operatorInitials='',r=>r.status='returned']){const r=structuredClone(receipt);altered(r);assert.throws(()=>contract.validateDigitalDhrReceipt(r));}
const document={documentInstanceId:event.documentInstanceId,sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',documentTemplateId:manifest.templateId,documentRevision:manifest.documentRevision,instrumentSn:'56009999',woNumber:null,status:'in_progress',manifest,fields:manifest.bindings.map(b=>({fieldId:b.fieldId,fieldVersion:0,quantity:0,conflict:false}))};
contract.validateDhrDocumentState(document);
assert.throws(()=>contract.validateDhrDocumentState({...document,fields:[document.fields[0],document.fields[0]]}));
let nextResponse=receipt,status=200,fetchFailure=false,decodeFailure=false,employeeId='11111111-1111-4111-8111-111111111111',pulses=0;
const calls=[],metrics=[];
const env={DIGITAL_DHR_ENABLED:'false',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-private-server-only'};
const actions=load('convex/dhrDocumentActions.ts',{'convex/values':{v,ConvexError},'./_generated/server':{action:x=>x},'./_generated/api':{internal:{users:{getUserAuditIdentity:'profile'}}},'./authGuard':{requireCapability:async(ctx,cap)=>{if(!ctx.capabilities.includes(cap))throw new Error('denied');return 'server-user';}},'./realtimePulsePublisher':{publishRealtimePulse:async()=>{pulses++;}},'../src/lib/dhrDocumentContract':contract},{process:{env},console:{info:x=>metrics.push(JSON.parse(x))},fetch:async(url,options)=>{calls.push({url,body:options.body?JSON.parse(options.body):undefined});if(fetchFailure)throw new Error('private network detail');return {ok:status===200,status,json:async()=>{if(decodeFailure)throw new Error('private decode detail');return nextResponse;}};}});
const ctx={capabilities:['inventory.read','inventory.write'],runQuery:async()=>({employeeId,role:'engineer'})};
const rejectCode=async(fn,code)=>assert.rejects(fn,error=>{assert.equal(error.data.code,code);assert.equal(error.message.includes('private'),false);return true;});
await rejectCode(actions.applyFieldConsumption.handler(ctx,{event}),'disabled');assert.equal(calls.length,0);assert.equal(metrics.at(-1).code,'disabled');
assert.deepEqual(JSON.parse(JSON.stringify(await actions.getBridgeStatus.handler(ctx,{}))),{enabled:false});
env.DIGITAL_DHR_ENABLED='true';
await assert.rejects(actions.applyFieldConsumption.handler({...ctx,capabilities:[]},{event}),/denied/);assert.equal(calls.length,0);
await rejectCode(actions.applyFieldConsumption.handler(ctx,{event:{...event,quantity:-1}}),'validation');assert.equal(metrics.at(-1).code,'validation');assert.equal(calls.length,0);
employeeId=undefined;await rejectCode(actions.applyFieldConsumption.handler(ctx,{event}),'identity_unavailable');assert.equal(metrics.at(-1).code,'identity_unavailable');assert.equal(calls.length,0);employeeId='11111111-1111-4111-8111-111111111111';
const result=await actions.applyFieldConsumption.handler(ctx,{event});assert.equal(result.quantity,2);assert.equal(pulses,1);assert.equal(calls.at(-1).body.p_operator_id,'server-user');assert.equal(calls.at(-1).body.p_employee_id,employeeId);assert.equal('actor' in calls.at(-1).body.p_event,false);assert.equal(metrics.at(-1).outcome,'accepted');
nextResponse={...receipt,duplicate:true};await actions.applyFieldConsumption.handler(ctx,{event});assert.equal(metrics.at(-1).outcome,'duplicate');
for(const marker of ['digital_dhr_conflict','digital_dhr_insufficient_stock','digital_dhr_disabled']){status=400;nextResponse={message:marker,details:'private provider data'};await rejectCode(actions.applyFieldConsumption.handler(ctx,{event}),marker.replace('digital_dhr_',''));}
for(const body of [{message:'private body'},{message:'constructor'},{message:'toString'},{message:'__proto__'},{message:'digital_dhr_conflict private'},null,{}]){nextResponse=body;await rejectCode(actions.applyFieldConsumption.handler(ctx,{event}),'unavailable');}
status=200;nextResponse={...receipt,documentInstanceId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};await rejectCode(actions.applyFieldConsumption.handler(ctx,{event}),'unavailable');
nextResponse=receipt;fetchFailure=true;await rejectCode(actions.applyFieldConsumption.handler(ctx,{event}),'unavailable');fetchFailure=false;decodeFailure=true;await rejectCode(actions.applyFieldConsumption.handler(ctx,{event}),'unavailable');decodeFailure=false;
nextResponse=document;await actions.createDocumentInstance.handler(ctx,{documentInstanceId:event.documentInstanceId,sessionId:document.sessionId,templateId:manifest.templateId,documentRevision:manifest.documentRevision});assert.equal(calls.at(-1).body.p_operator_id,'server-user');
await actions.getDocumentState.handler(ctx,{documentInstanceId:event.documentInstanceId});
assert.equal(JSON.stringify(metrics).includes('synthetic-private'),false);assert.equal(JSON.stringify(metrics).includes('documentInstanceId'),false);
console.log('DIGITAL_DHR_BINDING_CONTRACT_AUTH_FLAG_ACTOR_RECEIPT_ERROR_METRICS=PASS');
