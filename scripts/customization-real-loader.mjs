import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = new Map();
const refs = new Proxy({}, {get:(_t,module)=>new Proxy({}, {get:(_t,fn)=>String(module)+":"+String(fn)})});
const register = (definition) => definition;
const framework = {query:register,mutation:register,internalQuery:register,internalMutation:register,action:register,internalAction:register};
const validators = new Proxy({}, {get:(_t,name)=>(...args)=>({kind:name,args})});
export function loadReal(name) {
  if (modules.has(name)) return modules.get(name);
  const filename=path.join(ROOT,"convex",name+".ts");
  const source=fs.readFileSync(filename,"utf8");
  const result=ts.transpileModule(source,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  const syntax=(result.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert.equal(syntax.length,0,ts.formatDiagnosticsWithColorAndContext(syntax,{getCurrentDirectory:()=>ROOT,getCanonicalFileName:x=>x,getNewLine:()=>"\n"}));
  const module={exports:{}};modules.set(name,module.exports);
  const require=(dependency)=>{
    if(dependency==="./_generated/server") return framework;
    if(dependency==="./_generated/api") return {internal:refs,api:refs};
    if(dependency==="convex/values") return {v:validators};
    if(dependency==="@convex-dev/auth/server") return {getAuthUserId:async ctx=>ctx.fixtureUserId??null};
    // Existing employee and canonical identity modules have their own real-handler
    // regression suite. These fixtures isolate the new config guard boundary.
    if(dependency==="./employeeAccess") return {assertUserEmployeeAccess:async ctx=>{if(ctx.fixtureEmployeeDenied)throw new Error("Employee access denied");}};
    if(dependency==="./roleIdentity") return {resolveServerIdentity:async ctx=>ctx.fixtureIdentity??null};
    if(dependency.startsWith("./")) return loadReal(dependency.slice(2));
    throw new Error("Unexpected dependency: "+dependency);
  };
  vm.runInNewContext(result.outputText,{module,exports:module.exports,require,console,process,Date,JSON,Math,Set,Map,Error,TypeError,Uint8Array,TextEncoder,TextDecoder},{filename,timeout:10000});
  return module.exports;
}
const contract=loadReal("configContract");
const actions=loadReal("configActions");
assert.equal(typeof actions.publishDraft.handler,"function");
assert.equal(typeof actions.applyImportConfig.handler,"function");
assert.equal(contract.validateConfigValue("brand.appTitle","Fixture").valid,true);
assert.equal(contract.validateConfigValue("nav.inventoryItems","not an array").valid,false);
await assert.rejects(actions.listDrafts.handler({},{}),/Not authenticated/);
assert.equal(actions.createAuditEntry,undefined);
console.log("ACTUAL_CONFIG_MODULE_LOADER=PASS; no source extraction or business-function copies");
