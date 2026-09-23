import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const req=createRequire(process.env.VITROS_TEST_NODE_MODULES?path.join(process.env.VITROS_TEST_NODE_MODULES,'entry.cjs'):import.meta.url);
const React=req('react'), {create,act}=req('react-test-renderer'), ts=req('typescript');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const content=n=>(typeof n==='string'?n:(n?.children??[]).map(content).join(' ')).replace(/\s+/g,' ').trim();
async function fixture(role='superuser'){
 const f={calls:[],fail:false,close:0};
 const timers=new Map();let tid=0;
 const win={setTimeout:fn=>{timers.set(++tid,fn);return tid;},clearTimeout:id=>timers.delete(id),addEventListener:()=>{},removeEventListener:()=>{}};
 const sessions=[
 {id,instrument_sn:'ACTIVE-TEST',wo_number:'WO-A',analyzer_model:'5600',status:'in_progress',revision:0},
 {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',instrument_sn:'ARCHIVED-TEST',analyzer_model:'5600',status:'completed',revision:2},
 {id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',instrument_sn:'DELETED-TEST',analyzer_model:'5600',status:'deleted',revision:1}
 ];
 const actions={
  loadDhrScannerData:async()=>({sections:[],expectedParts:[],sessions,employees:[]}),
  loadDhrSessionResults:async()=>[],
  deleteDhrScannerSession:async args=>{f.calls.push(args);if(f.fail)throw Error('Synthetic lost response');return {status:'deleted'};},
 };
 const cache=new Map();
 const load=file=>{
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  const deps={
   react:React,'react/jsx-runtime':req('react/jsx-runtime'),
   'convex/react':{useConvexAuth:()=>({isAuthenticated:true}),useQuery:()=>undefined},
   'lucide-react':new Proxy({},{get:()=>()=>null}),xlsx:{},'file-saver':{},
   '../../components/vitros/SharedComponents':{WebCard:p=>React.createElement('section',null,p.children),theme:{}},
   '../../hooks/useConvexData':{useConvexData:()=>({parts:[],refresh:async()=>{}})},
   '../../lib/dhrErrors':{get safeDhrError(){return load('src/lib/dhrErrors.ts').safeDhrError;}},
   '../../convex/dhrErrorContract':{get DHR_ERROR_MESSAGES(){return load('convex/dhrErrorContract.ts').DHR_ERROR_MESSAGES;}},
   '../../hooks/useRole':{useRole:()=>({role})},
   '../../hooks/useServerActions':{useServerActions:()=>actions},
   '../../../convex/_generated/api':{api:{realtimePulse:{watch:'watch'}}},
   '../../components/vitros/DhrDeleteDialog':{get DhrDeleteDialog(){return load('src/components/vitros/DhrDeleteDialog.tsx').DhrDeleteDialog;}},
   '../ui/dialog':{
    Dialog:p=>React.createElement('div',{'data-dialog':true},p.children),
    DialogContent:p=>React.createElement('div',null,p.children),
    DialogHeader:p=>React.createElement('header',null,p.children),
    DialogTitle:p=>React.createElement('h2',null,p.children),
    DialogDescription:p=>React.createElement('p',null,p.children),
   },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
   exports,Error,Date,Map,Set,Number,Math,JSON,console,crypto:{randomUUID},window:win,document:{visibilityState:'visible',...win},
   require:name=>{assert.ok(name in deps,'Unexpected dependency '+name);return deps[name];}
  });return exports;
 };
 const Scanner=load('src/pages/inventory/DhrScanner.tsx').DhrScanner;
 let view;await act(async()=>{view=create(React.createElement(Scanner));});
 f.view=view;
 f.buttons=()=>view.root.findAllByType('button');
 f.button=label=>f.buttons().find(b=>content({children:b.children})===label);
 f.removeButton=()=>f.buttons().find(b=>b.props['aria-label']==='Delete DHR ACTIVE-TEST');
 f.open=async()=>{await act(async()=>f.removeButton().props.onClick());};
 f.reason=async value=>{await act(async()=>view.root.findByType('textarea').props.onChange({target:{value}}));};
 f.close=async()=>{await act(async()=>view.unmount());};
 return f;
}
let count=0;
async function test(name,run){await run();console.log('PASS '+name);count++;}
await test('Superuser sees delete only for active records; cancel performs no writes',async()=>{
 const f=await fixture();assert(f.removeButton());assert(!JSON.stringify(f.view.toJSON()).includes('DELETED-TEST'));
 await f.open();assert(f.button('Delete DHR').props.disabled);
 await act(async()=>f.button('Cancel').props.onClick());
 assert.equal(f.calls.length,0);assert.equal(f.view.root.findAllByType('textarea').length,0);
 await f.close();
});
await test('confirmation requires a reason and removes the deleted session',async()=>{
 const f=await fixture();await f.open();
 assert(JSON.stringify(f.view.toJSON()).includes('Consumed parts will not be returned to stock'));
 await f.reason('Duplicate session');await act(async()=>f.button('Delete DHR').props.onClick());
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].sessionId,id);assert.equal(f.calls[0].expectedRevision,0);
 assert.equal(f.calls[0].reason,'Duplicate session');assert.match(f.calls[0].correlationId,/^[0-9a-f-]{36}$/);
 assert(!f.removeButton());assert.equal(f.view.root.findAllByType('textarea').length,0);
 await f.close();
});
await test('failed confirmation stays open and retries the same operation',async()=>{
 const f=await fixture();f.fail=true;await f.open();await f.reason('Duplicate session');
 await act(async()=>f.button('Delete DHR').props.onClick());
 assert.equal(f.view.root.findByProps({role:'alert'}).children[0],'Synthetic lost response');
 assert(f.removeButton());f.fail=false;
 await act(async()=>f.button('Delete DHR').props.onClick());
 assert.equal(f.calls[0].correlationId,f.calls[1].correlationId);assert(!f.removeButton());
 await f.close();
});
await test('Engineer never receives a delete control on the list or checklist',async()=>{
 const f=await fixture('engineer');assert(!f.removeButton());
 const open=f.buttons().find(b=>content({children:b.children}).includes('ACTIVE-TEST'));
 await act(async()=>open.props.onClick());assert(!f.button('Delete DHR'));
 await f.close();
});
await test('Superuser can delete from the active checklist and returns to the list',async()=>{
 const f=await fixture();
 await act(async()=>f.buttons().find(b=>content({children:b.children}).includes('ACTIVE-TEST')).props.onClick());
 assert(f.button('Delete DHR'));await act(async()=>f.button('Delete DHR').props.onClick());await f.reason('Duplicate session');
 await act(async()=>f.buttons().filter(b=>content({children:b.children})==='Delete DHR').at(-1).props.onClick());
 assert.equal(f.calls.length,1);assert(content(f.view.toJSON()).includes('No active DHR sessions'));
 await f.close();
});
console.log('Actual DHR delete UI: '+count+' checks PASS');
