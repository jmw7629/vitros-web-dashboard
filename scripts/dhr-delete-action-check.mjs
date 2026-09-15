import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const req=createRequire(process.env.VITROS_TEST_NODE_MODULES?path.join(process.env.VITROS_TEST_NODE_MODULES,'entry.cjs'):import.meta.url);
const ts=req('typescript');
const code=ts.transpileModule(fs.readFileSync('convex/dhrInventoryActions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', key='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function fixture({allowed=true,status=200,duplicate=false}={}){
 const f={calls:[],caps:[],pulses:0,profiles:[]};
 const exports={};
 const deps={
  './_generated/api':{internal:{users:{getUserAuditIdentity:'identity'}}},
  './_generated/server':{action:x=>x},
  'convex/values':{v:new Proxy({},{get:()=>()=>({})})},
  './authGuard':{requireCapability:async(_,cap)=>{f.caps.push(cap);if(!allowed)throw Error('Denied');return 'trusted-id';}},
  './realtimePulsePublisher':{publishRealtimePulse:async()=>{f.pulses++;}},
 };
 vm.runInNewContext(code,{exports,Error,Number,encodeURIComponent,process:{env:{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-server-key'}},
 require:name=>{assert(name in deps);return deps[name];},
 fetch:async(url,options)=>{
  f.calls.push({url,...options});
  return {ok:status===200,status,json:async()=>({eventId:key,sessionId:id,status:'deleted',revision:1,duplicate})};
 }});
 f.run=(changes={})=>exports.deleteScannerSession.handler({runQuery:async(_,args)=>{f.profiles.push(args);return {role:'superuser',name:'Trusted Admin'};}},{sessionId:id,expectedRevision:0,reason:'Duplicate work order',correlationId:key,...changes});
 f.bootstrap=()=>exports.loadScannerData.handler({});
 return f;
}
let checks=0;
async function test(name,run){await run();checks++;console.log('PASS '+name);}
await test('deletion requires inventory.admin before any database or profile reads',async()=>{
 const f=fixture({allowed:false});await assert.rejects(f.run(),/Denied/);
 assert.deepEqual(f.caps,['inventory.admin']);assert.equal(f.calls.length+f.profiles.length,0);
});
await test('server resolves actor and sends exactly one atomic deletion RPC',async()=>{
 const f=fixture();const result=await f.run({reason:'  Duplicate work order  '});
 assert.equal(result.status,'deleted');assert.equal(f.calls.length,1);assert.equal(f.pulses,1);
 assert.equal(f.calls[0].url,'https://synthetic.invalid/rest/v1/rpc/delete_active_dhr_session');
 assert.equal(f.calls[0].method,'POST');
 assert.deepEqual(JSON.parse(f.calls[0].body),{p_session_id:id,p_expected_revision:0,p_actor:'Trusted Admin',p_reason:'Duplicate work order',p_correlation_id:'dhr-delete:'+key});
 assert.equal(f.profiles[0].userId,'trusted-id');
});
await test('invalid inputs never reach persistence',async()=>{
 for(const changes of [{reason:' '},{reason:'x'.repeat(501)},{expectedRevision:-1},{expectedRevision:0.5},{sessionId:'bad'},{correlationId:'bad'}]){
  const f=fixture();await assert.rejects(f.run(changes));assert.equal(f.calls.length,0);
 }
});
await test('lost-response retry preserves the same operation identity and duplicate receipt',async()=>{
 const f=fixture({duplicate:true});assert.equal((await f.run()).duplicate,true);assert.equal((await f.run()).duplicate,true);
 assert.equal(f.calls[0].body,f.calls[1].body);
});
await test('revision conflicts stay visible and never emit a successful pulse',async()=>{
 const f=fixture({status:409});await assert.rejects(f.run(),/changed.*Refresh/);assert.equal(f.pulses,0);
});
await test('non-successful deletion is never presented as success',async()=>{
 const f=fixture({status:500});await assert.rejects(f.run(),/deletion failed/);assert.equal(f.pulses,0);
});
await test('bootstrap only requests active or completed sessions',async()=>{
 const f=fixture();await assert.rejects(f.bootstrap(),/invalid payload/);
 assert.ok(f.calls.some(x=>x.url.includes('dhr_scan_sessions?')&&x.url.includes('status=in.(in_progress,completed)')));
});
console.log('DHR deletion action: '+checks+' checks PASS');
