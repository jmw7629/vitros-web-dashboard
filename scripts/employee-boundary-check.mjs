// Focused structural + executable check for canonical employee directory boundary (PR387).
// Validates convex/employeeActions.ts routes through Supabase convex_employees with
// server-authoritative RBAC, versioning, correlation idempotency and immutable audit.
// Includes transpiled VM harness that stubs action/auth/fetch/pulse to verify
// deny-before-network, server actor, exactly ONE write RPC, no direct PATCH, optional patch,
// invalid payload, no raw provider leakage, malformed receipt, fixed conflict messages.
// This is a static gate, not a live DB concurrency test.
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const path = "convex/employeeActions.ts";
const src = fs.readFileSync(path, "utf8");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function pass(msg) {
  console.log(`PASS: ${msg}`);
}

// 1. Must not use Convex db. Actions have no db; production authority is Supabase.
const codeOnly = src.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
if (/ctx\.db\.(query|get|insert|patch|collect)/.test(codeOnly)) fail("ctx.db usage found – actions must use Supabase convex_employees, not Convex employees table");
pass("No ctx.db usage");

// 2. Must not use invalid validators or mutation syntax.
if (/v\.number[^\(]/.test(src) && /v\.number,/.test(src)) fail("Invalid validator v.number without parentheses");
if (/v\.number\(\)/.test(src)) pass("Valid v.number() validators");
else fail("Missing v.number() validators");
if (/\.mutate\(/.test(src)) fail("Invalid .mutate() syntax – use Supabase REST");
pass("No .mutate() syntax");
if (!src.includes("internal.employeeAccess.beginTransition") || !src.includes("internal.employeeAccess.completeTransition")) fail("Missing employee access lifecycle barrier");
pass("Internal authorization barrier surrounds SQL transition");

// 3. Must route through Supabase convex_employees for reads and atomic RPC for writes
if (!/convex_employees\?select=/.test(src)) fail("Missing convex_employees Supabase select for reads");
pass("Uses convex_employees Supabase select for reads");
if (!/getSupabaseConfig/.test(src)) fail("Missing getSupabaseConfig");
pass("Has getSupabaseConfig");
if (!/sbFetch/.test(src)) fail("Missing sbFetch helper");
pass("Has sbFetch");
if (!/rpc\/apply_employee_transition/.test(src)) fail("Missing rpc/apply_employee_transition – all writes must route ONLY through this atomic RPC");
pass("Uses rpc/apply_employee_transition for all writes");
if (/rpc\/insert_employee_event/.test(src)) fail("Must not use insert_employee_event – writes must use only apply_employee_transition (review rejects separate PATCH/INSERT + insert_employee_event)");
pass("No insert_employee_event usage");
if (/convex_employees\?id=eq/.test(src) && /method:\s*"PATCH"/.test(src)) fail("Direct PATCH to convex_employees is forbidden – use only apply_employee_transition RPC");
pass("No direct PATCH to convex_employees");
if (/convex_employees",\s*\{[\s\S]*?method:\s*"POST"/.test(src)) fail("Direct POST to convex_employees is forbidden – use only apply_employee_transition RPC");
pass("No direct POST to convex_employees");

// 4. Must enforce admin.users.manage capability
const capMatches = [...src.matchAll(/requireCapability\(ctx,\s*"([^"]+)"\)/g)].map(m=>m[1]);
if (!capMatches.length) fail("No requireCapability found");
if (!capMatches.every(c=>c==="admin.users.manage")) fail(`All capabilities must be admin.users.manage, found: ${capMatches.join(", ")}`);
pass(`All ${capMatches.length} handlers enforce admin.users.manage`);
if (!/admin\.users\.manage/.test(src)) fail("admin.users.manage not found");

// 5. Must validate version/correlation contracts and active mapping
if (!/validateExpectedVersion/.test(src) || !/expectedVersion/.test(src)) fail("Missing expectedVersion validation");
pass("Validates expectedVersion");
if (!/validateCorrelationId/.test(src) || !/correlationId/.test(src)) fail("Missing correlationId validation");
pass("Validates correlationId");
if (!/Version conflict/.test(src)) fail("Missing version conflict handling");
pass("Handles version conflict");
if (!/active === true/.test(src)) fail("active NULL from DB must map to false (only active===true is active)");
pass("active NULL maps to false");
if (!/validateAndMapEmployeeReceipt/.test(src)) fail("Missing strict receipt validation (validateAndMapEmployeeReceipt)");
pass("Validates canonical RPC receipt shape");

// 6. Must preserve frontend-needed action names with correct optional patch signature
for (const name of ["listEmployees","getEmployee","createEmployee","updateEmployee","activateEmployee","deactivateEmployee"]) {
  if (!new RegExp(`export const ${name}\\s*=`).test(src)) fail(`Missing export ${name}`);
}
pass("All six actions exported: listEmployees/getEmployee/createEmployee/updateEmployee/activateEmployee/deactivateEmployee");
if (!/name:\s*v\.optional\(v\.string\(\)\)/.test(src) || !/initials:\s*v\.optional\(v\.string\(\)\)/.test(src) || !/active:\s*v\.optional\(v\.boolean\(\)\)/.test(src)) {
  fail("updateEmployee must allow optional name, initials, active for single atomic combined change");
}
pass("updateEmployee allows optional name/initials/active");
if (!/No fields to update/.test(src)) fail("updateEmployee must reject empty patch");
pass("updateEmployee rejects empty patch");

// 7. Must not weaken RLS/grants or invent parallel Convex authority
if (/ENABLE ROW LEVEL SECURITY/i.test(src)) fail("Must not modify RLS in action file");
if (/grant execute/i.test(src)) fail("Must not grant EXECUTE in action file");
if (/defineTable.*employees/.test(src)) fail("Must not define Convex employees table in action file");
pass("No RLS/grant/table invention");

// 8. Must use publishRealtimePulse after writes
if (!/publishRealtimePulse/.test(src)) fail("Missing publishRealtimePulse");
const pulseCount = (src.match(/publishRealtimePulse/g)||[]).length;
if (pulseCount < 4) fail(`Expected at least 4 publishRealtimePulse calls (create/update/activate/deactivate), found ${pulseCount}`);
pass(`publishRealtimePulse called ${pulseCount} times`);

// 9. Must use server-authoritative actor identity (requireCapability return)
if (!/requireCapability/.test(src) || !/actorId/.test(src)) fail("Missing server-authoritative actor via requireCapability");
pass("Uses server-authoritative actorId");

// 10. Must have correct employeeRow validators
if (!/const employeeRow = v\.object\(\{[\s\S]*?v\.string\(\)[\s\S]*?v\.boolean\(\)[\s\S]*?v\.number\(\)/.test(src)) fail("employeeRow must use v.string(), v.boolean(), v.number()");
pass("employeeRow validators correct");

// 11. Must parse JSON code and map fixed messages, never rethrow raw body substrings
if (/throw new Error\(text/.test(src) || /text\.match\(/.test(src) && /version conflict/.test(src)) {
  // The old pattern rethrew substring of raw body – now forbidden. Check for code-based mapping.
  if (!/code === "40001"/.test(src) || !/code === "23505"/.test(src) || !/code === "P0001"/.test(src)) {
    fail("Provider errors must parse JSON code and map 40001/23505/P0001 to fixed messages, never rethrow raw body substrings");
  }
}
if (!/code === "40001"/.test(src)) fail("Missing code 40001 version-conflict mapping");
pass("Maps 40001 version conflict via JSON code");
if (!/code === "23505"/.test(src)) fail("Missing code 23505 duplicate mapping");
pass("Maps 23505 duplicate via JSON code");
if (!/code === "P0001"/.test(src)) fail("Missing code P0001 correlation mapping");
pass("Maps P0001 correlation via JSON code");
if (/Supabase request failed.*\$\{text/.test(src) || /throw new Error\(.*text/.test(src)) {
  // Ensure generic case does not include raw text
  if (/throw new Error\(`Supabase request failed.*\$\{.*text/.test(src)) fail("Generic error must not include raw provider body");
}
pass("Provider errors never leak raw body substrings");

// === Executable production action tests via transpile/VM stub ===
// Transpile the exact production file and exercise handlers with stubbed auth/fetch/pulse.
console.log("\n--- Executable VM harness ---");
const transformedSrc = src
  .replace(/import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];?/g, "")
  .replace(/declare const process[^;]+;/g, "")
  .replace(/import type [^\n]+\n/g, "");

const stubs = `
// --- Test stubs ---
const __fetchCalls = [];
let __fetchHandler = null;
let __requireImpl = async () => "stubActorId";
let __publishCalls = 0;
globalThis.fetch = async (url, init) => {
  __fetchCalls.push({ url, init, body: init && init.body ? (()=>{ try{ return JSON.parse(init.body);}catch{ return init.body}})() : null });
  if (__fetchHandler) return __fetchHandler(url, init);
  return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) };
};
const v = {
  string: () => ({ _t:"string" }),
  number: () => ({ _t:"number" }),
  boolean: () => ({ _t:"boolean" }),
  object: (o) => o,
  array: (a) => a,
  union: (...a) => a,
  optional: (a) => a,
  null: () => ({ _t:"null" }),
  literal: (a) => ({ _t:"literal", v:a }),
  id: () => ({ _t:"id" }),
};
const internal = { employeeAccess: { beginTransition: "begin", completeTransition: "complete", rejectTransition: "reject" } };
const action = (cfg) => cfg;
const requireCapability = (...a) => __requireImpl(...a);
const publishRealtimePulse = async () => { __publishCalls++; };
const process = { env: { SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-key" } };
globalThis.process = process;
`;

const fullSrcForTranspile = transformedSrc;
let prodTranspiled;
try {
  prodTranspiled = ts.transpileModule(fullSrcForTranspile, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, allowSyntheticDefaultImports: true, skipLibCheck: true }
  }).outputText;
} catch (e) {
  fail("Transpile of production file failed: " + e.message);
}
const fullSrc = stubs + "\n" + prodTranspiled + "\n" +
`globalThis.__exports = typeof exports !== 'undefined' ? exports : typeof module !== 'undefined' ? module.exports : {};
globalThis.__fetchCalls = __fetchCalls;
globalThis.__getFetchCalls = () => __fetchCalls;
globalThis.__clearFetch = () => { __fetchCalls.length = 0; };
globalThis.__setFetchHandler = (fn) => { __fetchHandler = fn; };
globalThis.__setRequireImpl = (fn) => { __requireImpl = fn; };
globalThis.__getPublishCalls = () => __publishCalls;
globalThis.__resetPublish = () => { __publishCalls = 0; };
`;

const transpiled = fullSrc;

const sandbox = {
  console,
  setTimeout, clearTimeout, Promise, JSON, String, Number, Boolean, Array, Object, Map, Set, RegExp, Date, Error, TypeError, RangeError, isFinite, isNaN, parseInt, parseFloat,
  Buffer, URL, encodeURIComponent, decodeURIComponent,
  require: (m) => { throw new Error("require not allowed: " + m); },
  exports: {},
  module: { exports: {} },
};
sandbox.exports = sandbox.module.exports;
vm.createContext(sandbox);
try {
  vm.runInContext(transpiled, sandbox);
} catch (e) {
  fail("VM execution of production file failed: " + e.stack);
}

const exp = sandbox.__exports || sandbox.exports || {};
// In CommonJS transpilation, exports are on sandbox.exports or sandbox.__exports
const actions = exp;
if (!actions.listEmployees && sandbox.exports && sandbox.exports.listEmployees) {
  Object.assign(actions, sandbox.exports);
}
if (!actions.createEmployee) {
  // Try alternative: vm context may have put exports on global
  const maybe = vm.runInContext("typeof exports !== 'undefined' ? exports : typeof __exports !== 'undefined' ? __exports : {}", sandbox);
  if (maybe && maybe.createEmployee) Object.assign(actions, maybe);
}
function getAction(name) {
  const a = actions[name] || sandbox[name] || (sandbox.exports && sandbox.exports[name]) || (sandbox.__exports && sandbox.__exports[name]);
  if (!a) fail("Action not found in VM exports: " + name);
  return a;
}

// Helper to invoke action handler
async function invoke(name, ctx, args) {
  const act = getAction(name);
  if (!act.handler) fail("Action has no handler: " + name);
  return act.handler({ runMutation: async () => "synthetic-operation", ...ctx }, args);
}

const validUuid = "11111111-1111-4111-8111-111111111111";
const validUuid2 = "22222222-2222-4222-8222-222222222222";

// Capture helpers inside VM
const clearFetch = vm.runInContext("globalThis.__clearFetch", sandbox);
const getFetchCalls = vm.runInContext("globalThis.__getFetchCalls", sandbox);
const setFetchHandler = vm.runInContext("globalThis.__setFetchHandler", sandbox);
const setRequireImpl = vm.runInContext("globalThis.__setRequireImpl", sandbox);
const getPublishCalls = vm.runInContext("globalThis.__getPublishCalls", sandbox);
const resetPublish = vm.runInContext("globalThis.__resetPublish", sandbox);

// Async test runner inside VM context – we run tests via vm.runInContext with async IIFE
async function runVmTests() {
  // Helper to reset state
  function reset() {
    clearFetch();
    resetPublish();
    setRequireImpl(async () => "serverActor123");
    setFetchHandler(null);
  }

  // 1. deny before network: requireCapability throws, fetch must be 0
  console.log("VM Test 1: deny before network");
  reset();
  setRequireImpl(async () => { throw new Error("Missing capability: admin.users.manage"); });
  setFetchHandler(async () => { throw new Error("fetch should not be called"); });
  try {
    await invoke("createEmployee", {}, { name: "Alice", initials: "AL", correlationId: "corr-deny-1" });
    fail("VM Test 1: should have thrown capability error");
  } catch (e) {
    if (!/Missing capability/.test(e.message)) fail("VM Test 1: wrong error: " + e.message);
    if (getFetchCalls().length !== 0) fail("VM Test 1: fetch called despite auth deny");
    pass("VM deny before network");
  }

  // 2. server actor: p_actor must be server-resolved, not client
  console.log("VM Test 2: server actor");
  reset();
  setRequireImpl(async () => "convexUserABC");
  let capturedBody = null;
  setFetchHandler(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      json: async () => ({ id: validUuid, name: "Alice", initials: "AL", active: true, version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      text: async () => "{}"
    };
  });
  await invoke("createEmployee", {}, { name: "Alice", initials: "AL", correlationId: "corr-actor-1", reason: "test" });
  if (capturedBody.p_actor !== "convexUserABC") fail("VM Test 2: p_actor not server-resolved, got " + capturedBody.p_actor);
  if (capturedBody.p_correlation_id !== "corr-actor-1") fail("VM Test 2: correlation mismatch");
  pass("VM server actor");

  // 3. exactly ONE write RPC, no direct PATCH/POST
  console.log("VM Test 3: exactly ONE write RPC, no direct PATCH");
  reset();
  setRequireImpl(async () => "actor1");
  let fetchCount = 0;
  let urls = [];
  setFetchHandler(async (url, init) => {
    fetchCount++;
    urls.push(url);
    return { ok: true, status: 200, json: async () => ({ id: validUuid, name: "Bob", initials: "BB", active: true, version: 2, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }), text: async () => "{}" };
  });
  await invoke("updateEmployee", {}, { id: validUuid, name: "Bob", initials: "BB", expectedVersion: 1, correlationId: "corr-update-1" });
  if (fetchCount !== 1) fail("VM Test 3: expected exactly ONE fetch, got " + fetchCount);
  if (!urls[0].includes("rpc/apply_employee_transition")) fail("VM Test 3: fetch not to rpc/apply_employee_transition: " + urls[0]);
  if (urls.some(u => u.includes("convex_employees?") && u.includes("method"))) fail("VM Test 3: direct PATCH detected");
  // Ensure no direct convex_employees write via body inspection
  if (getFetchCalls().some(c => c.url.includes("convex_employees") && c.init && c.init.method && c.init.method !== "GET")) fail("VM Test 3: direct convex_employees write detected");
  pass("VM exactly ONE write RPC, no direct PATCH");

  // 4. optional patch: update with single field, and empty patch rejection
  console.log("VM Test 4: optional patch");
  reset();
  setRequireImpl(async () => "actor1");
  let optBody = null;
  setFetchHandler(async (url, init) => {
    optBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ id: validUuid, name: "Charlie", initials: "CH", active: optBody.p_active ?? true, version: optBody.p_expected_version + 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }), text: async () => "{}" };
  });
  await invoke("updateEmployee", {}, { id: validUuid, name: "NewName", expectedVersion: 1, correlationId: "corr-opt-1" });
  if (optBody.p_name !== "NewName") fail("VM Test 4a: p_name not passed");
  if (optBody.p_initials !== null) fail("VM Test 4a: p_initials should be null when omitted, got " + optBody.p_initials);
  if (optBody.p_active !== null) fail("VM Test 4a: p_active should be null when omitted");
  // Active only
  clearFetch();
  optBody = null;
  await invoke("updateEmployee", {}, { id: validUuid, active: false, expectedVersion: 2, correlationId: "corr-opt-2" });
  if (optBody.p_active !== false) fail("VM Test 4b: p_active should be false");
  if (optBody.p_name !== null || optBody.p_initials !== null) fail("VM Test 4b: omitted name/initials should be null");
  // Empty patch should reject before network
  clearFetch();
  try {
    await invoke("updateEmployee", {}, { id: validUuid, expectedVersion: 1, correlationId: "corr-opt-3" });
    fail("VM Test 4c: empty patch should have thrown");
  } catch (e) {
    if (!/No fields to update/.test(e.message)) fail("VM Test 4c: wrong error for empty patch: " + e.message);
    if (getFetchCalls().length !== 0) fail("VM Test 4c: fetch should not be called for empty patch");
  }
  pass("VM optional patch");

  // 5. invalid payload: bad name/uuid should throw before network
  console.log("VM Test 5: invalid payload");
  reset();
  setFetchHandler(async () => { throw new Error("fetch should not be called for invalid payload"); });
  try {
    await invoke("createEmployee", {}, { name: "  bad ", initials: "AL", correlationId: "corr-inv-1" });
    fail("VM Test 5a: invalid name with whitespace should throw");
  } catch (e) {
    if (!/leading or trailing/.test(e.message)) fail("VM Test 5a: wrong error: " + e.message);
  }
  try {
    await invoke("updateEmployee", {}, { id: "not-a-uuid", name: "Bob", initials: "BB", expectedVersion: 1, correlationId: "corr-inv-2" });
    fail("VM Test 5b: invalid uuid should throw");
  } catch (e) {
    if (!/Invalid employee id/.test(e.message)) fail("VM Test 5b: wrong error: " + e.message);
  }
  if (getFetchCalls().length !== 0) fail("VM Test 5: fetch called despite invalid payload");
  pass("VM invalid payload before network");

  // 6. no raw provider leakage: provider returns JSON with sensitive leak, error must be fixed generic
  console.log("VM Test 6: no raw provider leakage");
  reset();
  setRequireImpl(async () => "actor1");
  const leakBody = JSON.stringify({ code: "23505", message: 'duplicate key value violates unique constraint "convex_employees_canonical_initials_uq" Detail: Key (upper(btrim(initials)))=(AL) already exists. Schema leaked: public.convex_employees' });
  setFetchHandler(async () => ({ ok: false, status: 409, text: async () => leakBody, json: async () => JSON.parse(leakBody) }));
  try {
    await invoke("createEmployee", {}, { name: "Leak", initials: "AL", correlationId: "corr-leak-1" });
    fail("VM Test 6: should have thrown duplicate");
  } catch (e) {
    if (/convex_employees/.test(e.message) || /Detail:/.test(e.message) || /Schema leaked/.test(e.message)) fail("VM Test 6: raw provider leak in error: " + e.message);
    if (!/Duplicate employee initials/.test(e.message)) fail("VM Test 6: fixed duplicate message expected, got: " + e.message);
  }
  // 40001 leak
  const leak40001 = JSON.stringify({ code: "40001", message: "version conflict: expected 1, current 5 - table public.convex_employees version=5 secret" });
  setFetchHandler(async () => ({ ok: false, status: 400, text: async () => leak40001, json: async () => JSON.parse(leak40001) }));
  try {
    await invoke("updateEmployee", {}, { id: validUuid, name: "Bob", expectedVersion: 1, correlationId: "corr-leak-2" });
    fail("VM Test 6b: should have thrown version conflict");
  } catch (e) {
    if (/secret/.test(e.message) || /current 5/.test(e.message) || /public\.convex_employees/.test(e.message)) fail("VM Test 6b: raw leak: " + e.message);
    if (!/Version conflict/.test(e.message)) fail("VM Test 6b: fixed version conflict expected, got: " + e.message);
  }
  pass("VM no raw provider leakage");

  // 7. malformed receipt: RPC returns invalid shape -> invalid receipt
  console.log("VM Test 7: malformed receipt");
  reset();
  setRequireImpl(async () => "actor1");
  setFetchHandler(async () => ({ ok: true, status: 200, text: async () => "{}", json: async () => ({ id: "not-a-uuid", name: "", initials: "TOOLONG123", active: "yes", version: "one", created_at: "not-a-date", updated_at: null }) }));
  try {
    await invoke("createEmployee", {}, { name: "Alice", initials: "AL", correlationId: "corr-malf-1" });
    fail("VM Test 7: malformed receipt should throw");
  } catch (e) {
    if (!/invalid receipt/i.test(e.message)) fail("VM Test 7: expected invalid receipt, got: " + e.message);
  }
  // Missing version
  setFetchHandler(async () => ({ ok: true, status: 200, text: async () => "{}", json: async () => ({ id: validUuid, name: "Alice", initials: "AL", active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }));
  try {
    await invoke("createEmployee", {}, { name: "Alice", initials: "AL", correlationId: "corr-malf-2" });
    fail("VM Test 7b: missing version should throw");
  } catch (e) {
    if (!/invalid receipt/i.test(e.message)) fail("VM Test 7b: expected invalid receipt, got: " + e.message);
  }
  pass("VM malformed receipt");

  // Legacy creation time is explicitly nullable in the durable directory.
  // A valid committed transition must return success and publish its refresh.
  for (const actionName of ["updateEmployee", "activateEmployee", "deactivateEmployee"]) {
    reset();
    const receipt = { id: validUuid, name: "Legacy", initials: "LG", active: actionName !== "deactivateEmployee", version: 2, created_at: null, updated_at: "2026-09-12T00:00:00Z" };
    setFetchHandler(async () => ({ ok: true, status: 200, json: async () => receipt }));
    const args = { id: validUuid, expectedVersion: 1, correlationId: "legacy-" + actionName, ...(actionName === "updateEmployee" ? { name: "Legacy" } : {}) };
    const result = await invoke(actionName, {}, args);
    if (result.createdAt !== null || result.updatedAt !== Date.parse(receipt.updated_at)) fail("Legacy timestamps were fabricated or rejected");
    if (getFetchCalls().length !== 1 || getPublishCalls() !== 1) fail("Committed legacy transition must publish once");
    for (const malformed of [undefined, "not-a-date"]) {
      receipt.created_at = malformed;
      try {
        await invoke(actionName, {}, args);
        fail("Malformed creation timestamp should still reject");
      } catch (error) {
        if (!/invalid receipt/.test(error.message)) throw error;
      }
    }
  }
  pass("Nullable legacy creation timestamp survives committed transitions and refresh");

  reset();
  const lifecycle = [];
  const lifecycleCtx = { async runMutation(ref, args) { lifecycle.push({ ref, args }); return "synthetic-operation"; } };
  setFetchHandler(async () => {
    if (lifecycle[0]?.ref !== "begin") fail("Barrier must precede SQL");
    return { ok: true, status: 200, json: async () => ({ id: validUuid, name: "Nullable", initials: "NU", active: null, version: 2, created_at: null, updated_at: "2026-09-12T00:00:00Z" }) };
  });
  const nullable = await invoke("updateEmployee", lifecycleCtx, { id: validUuid, name: "Nullable", expectedVersion: 1, correlationId: "nullable-active" });
  if (nullable.active !== false || lifecycle[1]?.ref !== "complete" || lifecycle[1]?.args.active !== false || getPublishCalls() !== 1) fail("Nullable inactive receipt must complete blocked and publish");
  reset(); lifecycle.length = 0;
  setFetchHandler(async () => { throw new Error("synthetic network loss"); });
  try {
    await invoke("deactivateEmployee", lifecycleCtx, { id: validUuid, expectedVersion: 1, correlationId: "uncertain" });
    fail("Network loss should throw");
  } catch (error) { if (!/synthetic network loss/.test(error.message)) throw error; }
  if (lifecycle.length !== 1 || lifecycle[0].ref !== "begin" || getPublishCalls() !== 0) fail("Unknown network outcome must retain barrier");
  reset(); lifecycle.length = 0;
  setFetchHandler(async (url) => url.includes("reconcile_employee_transition")
    ? ({ ok: true, status: 200, json: async () => ({ outcome: "superseded", employee_id: validUuid, correlation_id: "known-rejection", actor: "serverActor123", expected_version: 1, current_version: 2 }) })
    : ({ ok: false, status: 400, text: async () => JSON.stringify({ code: "40001" }) }));
  try {
    await invoke("deactivateEmployee", lifecycleCtx, { id: validUuid, expectedVersion: 1, correlationId: "known-rejection" });
    fail("SQL rejection should throw");
  } catch (error) { if (!/Version conflict/.test(error.message)) throw error; }
  if (lifecycle.length !== 2 || lifecycle[1].ref !== "reject") fail("Confirmed SQL rollback should recover invocation");
  pass("Access barrier ordering, nullable inactive success and uncertain response containment");

  // 8. fixed conflict messages: 40001 before 409, P0001 correlation
  console.log("VM Test 8: fixed conflict messages");
  reset();
  setRequireImpl(async () => "actor1");
  // 40001 even with 409 status should map to version conflict first
  const both409 = JSON.stringify({ code: "40001", message: "version conflict: expected 1, current 2" });
  setFetchHandler(async () => ({ ok: false, status: 409, text: async () => both409, json: async () => JSON.parse(both409) }));
  try {
    await invoke("updateEmployee", {}, { id: validUuid, name: "Bob", expectedVersion: 1, correlationId: "corr-fixed-1" });
    fail("VM Test 8a: should throw version conflict");
  } catch (e) {
    if (!/Version conflict/.test(e.message) || /Duplicate/.test(e.message)) fail("VM Test 8a: 40001 should map to version conflict, got: " + e.message);
  }
  const p0001 = JSON.stringify({ code: "P0001", message: "correlation id was already used for a different request" });
  setFetchHandler(async () => ({ ok: false, status: 400, text: async () => p0001, json: async () => JSON.parse(p0001) }));
  try {
    await invoke("createEmployee", {}, { name: "Dup", initials: "DD", correlationId: "corr-fixed-2" });
    fail("VM Test 8b: should throw correlation");
  } catch (e) {
    if (!/Correlation id was already used/.test(e.message)) fail("VM Test 8b: expected correlation fixed, got: " + e.message);
  }
  // Generic else
  setFetchHandler(async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ code: "XX999", message: "secret internal error" }), json: async () => ({ code: "XX999" }) }));
  try {
    await invoke("createEmployee", {}, { name: "Gen", initials: "GG", correlationId: "corr-fixed-3" });
    fail("VM Test 8c: should throw generic");
  } catch (e) {
    if (!/Supabase request failed \(500\)/.test(e.message)) fail("VM Test 8c: expected generic, got: " + e.message);
    if (/secret/.test(e.message)) fail("VM Test 8c: leaked secret");
  }
  pass("VM fixed conflict messages");
}

await runVmTests();

console.log("\nPASS: employee-boundary-check complete – canonical Supabase convex_employees boundary is structurally correct");
console.log("NOTE: Writes are atomic via public.apply_employee_transition (p_action,p_employee_id,p_name,p_initials,p_active,p_expected_version,p_correlation_id,p_actor,p_reason) RETURNS jsonb canonical row; correlation idempotency, versioning and immutable history are enforced server-side in that RPC. Reads use convex_employees?select=... with admin.users.manage RBAC.");
