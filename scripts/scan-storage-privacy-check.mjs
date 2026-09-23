import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {privatizeScans,PROJECT_URL} from './scan-storage-privacy.mjs';
const bytes=Buffer.from('synthetic document');
const manifest=[{file:'scan_123.jpg',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}];
function fixture({isPublic=true,extra=false,wrongBytes=false,publicLeak=false,failUpdate=false}={}) {
 const calls=[];
 return {calls,fetchFn:async(url,options)=>{
  assert(url.startsWith(PROJECT_URL+'/storage/v1/'));assert.equal(options.redirect,'error');calls.push({url,...options});
  const path=new URL(url).pathname;
  if(path.includes('/object/public/')){assert.equal(options.headers.Authorization,undefined);return new Response(isPublic||publicLeak?bytes:'denied',{status:isPublic||publicLeak?200:403});}
  assert.equal(options.headers.Authorization,'Bearer synthetic-key');
  if(path.endsWith('/bucket/dhr-scans')){
   if(options.method==='PUT'){assert.deepEqual(JSON.parse(options.body),{id:'dhr-scans',name:'dhr-scans',public:false});if(failUpdate)return new Response('private diagnostic synthetic-key',{status:500});isPublic=false;}
   return Response.json({id:'dhr-scans',public:isPublic,file_size_limit:100,allowed_mime_types:['image/jpeg']});
  }
  if(path.includes('/object/list/'))return Response.json([{name:'scan_123.jpg',id:'id'},...(extra?[{name:'unexpected.jpg',id:'extra'}]:[])]);
  if(path.includes('/object/authenticated/'))return new Response(wrongBytes?'wrong':bytes);
  throw Error('Unexpected route');
 }};
}
let f=fixture();let r=await privatizeScans({key:'synthetic-key',manifest,fetchFn:f.fetchFn});assert.equal(r.publicReadable,1);assert.equal(f.calls.filter(c=>c.method==='PUT').length,0);
f=fixture();r=await privatizeScans({key:'synthetic-key',manifest,apply:true,fetchFn:f.fetchFn});assert.equal(r.publicAfter,false);assert.equal(r.publicReadable,0);assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
f=fixture({isPublic:false});r=await privatizeScans({key:'synthetic-key',manifest,apply:true,fetchFn:f.fetchFn});assert.equal(r.changed,false);
for(const bad of [{extra:true},{wrongBytes:true}]){f=fixture(bad);await assert.rejects(privatizeScans({key:'synthetic-key',manifest,apply:true,fetchFn:f.fetchFn}),/manifest/);assert(!f.calls.some(c=>c.method==='PUT'));}
f=fixture({publicLeak:true});await assert.rejects(privatizeScans({key:'synthetic-key',manifest,apply:true,fetchFn:f.fetchFn}),/not reopened/);assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
f=fixture({failUpdate:true});await assert.rejects(privatizeScans({key:'synthetic-key',manifest,apply:true,fetchFn:f.fetchFn}),e=>e.message==='Storage request rejected (HTTP 500).');
f=fixture();await assert.rejects(privatizeScans({manifest,key:'',fetchFn:f.fetchFn}),/required/);assert.equal(f.calls.length,0);
await assert.rejects(privatizeScans({key:'synthetic-key',manifest:[{...manifest[0],file:'../other.jpg'}],fetchFn:f.fetchFn}),/Invalid/);assert.equal(f.calls.length,0);
console.log('SCAN_STORAGE_PRIVACY_CHECK=PASS audit-only default, exact manifest, retained bytes, private-only update, safe failure, no credential reflection');
