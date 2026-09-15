import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('convex/inventoryReportActions.ts','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let allowed=true, requests=[], response=[];
const exports={};
const validator=new Proxy({}, {get:()=>()=>({})});
vm.runInNewContext(code,{exports,URLSearchParams,Date,Number,Error,Math,
 require(name) {
  if(name==='./_generated/server')return {action:x=>x};
  if(name==='convex/values')return {v:validator};
  if(name==='./authGuard')return {requireCapability:async(_ctx,cap)=>{assert.equal(cap,'inventory.read');if(!allowed)throw Error('denied');}};
  if(name==='./supabaseGateway')return {getSupabaseConfig:()=>({url:'https://synthetic.invalid',serviceKey:'synthetic'})};
  throw Error('Unexpected module '+name);
 },
 fetch:async(url)=>{requests.push(new URL(url));return {ok:true,json:async()=>response};}
});
const handler=exports.listPeriod.handler;
const args={start:Date.UTC(2026,0,1),end:Date.UTC(2026,11,31,23,59,59,999),offset:0};
allowed=false;await assert.rejects(handler({},args),/denied/);assert.equal(requests.length,0);allowed=true;
for(const bad of [{...args,offset:-1},{...args,offset:1},{...args,end:args.start-1},{...args,start:NaN}])await assert.rejects(handler({},bad),/Invalid report range/);
assert.equal(requests.length,0);
response=Array.from({length:501},(_,i)=>({id:String(i),created_at:'2026-06-01T10:00:00Z',action:'OUT',part_number:'__proto__',new_value:{qty:2,description:'Synthetic'}}));
let page=await handler({},args);assert.equal(page.items.length,500);assert.equal(page.hasMore,true);assert.equal(page.items[0].qty,2);
assert.equal(requests[0].searchParams.get('entity_type'),'eq.stock');assert.equal(requests[0].searchParams.get('action'),'in.(IN,OUT,RECEIVE,ADJUST)');assert.equal(requests[0].searchParams.getAll('created_at').length,2);
response=[{id:'end',created_at:'2026-01-02T00:00:00Z',action:'RECEIVE',part_number:'TEST',new_value:{qty_before:3,qty_after:8}}];
page=await handler({}, {...args,offset:500});assert.equal(page.hasMore,false);assert.equal(page.items[0].qty,5);assert.equal(requests.at(-1).searchParams.get('offset'),'500');
response=[{id:'missing',created_at:'2026-01-02T00:00:00Z',action:'OUT',part_number:'TEST',new_value:{}}];
await assert.rejects(handler({},args),/missing its date or quantity/);
console.log('PASS actual inventory report action: auth, input bounds, dated movement filtering, pagination, quantity recovery and incomplete-record rejection');
