import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { ConvexError, convexToJson, jsonToConvex } from 'convex/values';
const compile = source => ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(file, deps={}) {
  const exports={};
  vm.runInNewContext(compile(fs.readFileSync(file,'utf8')), {exports,Error,Object,Array,require:id=>{assert(id in deps, id);return deps[id];}});
  return exports;
}
const contract=load('convex/aiErrorContract.ts');
const client=load('src/lib/aiErrors.ts', {'../../convex/aiErrorContract':contract});
const wire=e=>jsonToConvex(convexToJson(e.data));
const generic=contract.AI_ERROR_MESSAGES.PROVIDER_UNAVAILABLE;
for(const code of ['constructor','toString','__proto__','unknown',null,1,{}]) {
  assert.equal(contract.aiPublicErrorCode({code}), 'PROVIDER_UNAVAILABLE');
  assert.equal(client.safeOcrError(new ConvexError({kind:'ai',code})),generic);
}
for(const e of [null,[],{},Error('private provider output'),{data:[]},{data:{kind:'wrong',code:'TIMEOUT'}}]) assert.equal(client.safeOcrError(e),generic);
for(const code of Object.keys(contract.AI_ERROR_MESSAGES)) {
  const data=wire(new ConvexError({kind:'ai',code}));
  assert.equal(contract.aiPublicErrorCode({data} ),code);
  assert.equal(client.safeOcrError({data}),contract.AI_ERROR_MESSAGES[code]);
}
const failures=[
 [Error('OpenCode Zen key is not configured. Add OPENCODE_ZEN_API_KEY in the server environment.'),'ZEN_NOT_CONFIGURED'],
 [Object.assign(Error('private diagnostic'),{code:'provider_auth'}),'PROVIDER_ACCESS_REJECTED'],
 [Object.assign(Error('private diagnostic'),{code:'constructor'}),'PROVIDER_UNAVAILABLE'],
 [Error('private provider output'),'PROVIDER_UNAVAILABLE'],
 [{data:wire(new ConvexError({kind:'ai',code:'AI_PAUSED'}))},'AI_PAUSED'],
];
for(const [file,name,args] of [
 ['convex/aiGateway.ts','ocrPackingList',{imageBase64:'aA==',prompt:'test'}],
 ['convex/aiGateway.ts','ocrDhrPage',{imageBase64:'aA==',prompt:'test'}],
 ['convex/incomingStockPdfOcr.ts','ocrPackingListPdf',{pdfBase64:'JVBERi0=',prompt:'test'}],
]) {
  let allowed=true, failure, calls=0;
  const mod=load(file,{'./_generated/server':{action:x=>x},'convex/values':{ConvexError,v:new Proxy({},{get:()=>()=>({})})},'./authGuard':{requireCapability:async()=>{if(!allowed)throw Error('Denied');return 'trusted-user';}},'./aiErrorContract':contract,'./zenRuntime':{runZen:async()=>{calls++;if(failure)throw failure;return {text:'[]'};}}});
  const run=()=>mod[name].handler({},args);
  for(const [error,code] of failures) {
    failure=error;calls=0;
    await assert.rejects(run(),e=>{assert(e instanceof ConvexError);assert.deepEqual(wire(e),{kind:'ai',code});assert.equal(client.safeOcrError({data:wire(e)}),contract.AI_ERROR_MESSAGES[code]);return true;});
    assert.equal(calls,1,'no automatic provider retry');
  }
  failure=null;assert.equal(await run(),'[]');
  allowed=false;calls=0;await assert.rejects(run(),/Denied/);assert.equal(calls,0);
}
// Execute the actual Incoming Stock OCR catch blocks, including JSON parse failures.
for(const file of ['IncomingStockSecure','IncomingStockDocument']) {
 const source=fs.readFileSync('src/pages/inventory/'+file+'.tsx','utf8');
 const ast=ts.createSourceFile(file+'.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let caught;
 function visit(node){if(ts.isCatchClause(node)&&node.block.getText(ast).includes('safeOcrError(error)'))caught=node.block.getText(ast);ts.forEachChild(node,visit);}
 visit(ast);assert(caught,'OCR catch missing');
 for(const error of [Error('private provider JSON snippet'),new ConvexError({kind:'ai',code:'unknown',diagnostic:'private'}),new ConvexError({kind:'ai',code:'ZEN_NOT_CONFIGURED'})]) {
  let status;
  vm.runInNewContext(compile(caught),{error,safeOcrError:client.safeOcrError,setLines:()=>{},setStatus:s=>{status=s;}});
  assert.equal(status,'Error: '+client.safeOcrError(error));assert(!status.includes('private'));
 }
}
console.log('AI_OCR_SAFE_ERROR_CONTRACT=PASS actual server actions, Convex serialization, client mappers, Incoming Stock catch blocks');
