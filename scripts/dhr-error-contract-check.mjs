import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { ConvexError } from 'convex/values';

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), {
    exports, Error, Number, Object, encodeURIComponent, ...globals,
    require: name => { assert(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; },
  });
  return exports;
}
const contract = load('convex/dhrErrorContract.ts');
const client = load('src/lib/dhrErrors.ts', { '../../convex/dhrErrorContract': contract });
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const args = { sessionId: id, sectionId: '5.11', partNumber: 'J19057', expectedQty: 2, newQty: 1, category: 'Required', description: 'Filter', correlationId: 'test-only', expectedRevision: 0 };
function fixture({ allowed = true, ok = false, payload = { code: 'P0001', message: 'DHR revision conflict: expected 0, current 1' }, parseFailure = false } = {}) {
  const trace = [];
  const actions = load('convex/dhrInventoryActions.ts', {
    './_generated/api': { internal: { users: { getUserAuditIdentity: 'identity' } } },
    './_generated/server': { action: x => x },
    'convex/values': { ConvexError, v: new Proxy({}, { get: () => () => ({}) }) },
    './dhrErrorContract': contract,
    './authGuard': { requireCapability: async (_, capability) => { trace.push('auth:' + capability); if (!allowed) throw Error('Denied'); return 'trusted-user'; } },
    './realtimePulsePublisher': { publishRealtimePulse: async () => { trace.push('pulse'); } },
  }, {
    process: { env: { SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only' } },
    fetch: async (url, options) => {
      trace.push({ url, body: JSON.parse(options.body ?? '{}') });
      // Prerequisite reads for lifecycle/session creation; the write is tested below.
      if (options.method === 'GET') return { ok: true, json: async () => url.includes('checklist_sections') ? [{ analyzer_model: '5600' }] : [{ id, status: 'in_progress', revision: 0 }] };
      return { ok, status: ok ? 200 : 400, json: async () => { if (parseFailure) throw Error('private parse diagnostic'); return payload; } };
    },
  });
  const ctx = { runQuery: async () => { trace.push('identity'); return { role: 'superuser', name: 'Trusted Admin' }; } };
  return { trace, run: () => actions.applyScanTransition.handler(ctx, args),
    create: () => actions.createScannerSession.handler(ctx, { instrumentSn: 'TEST-ONLY', analyzerModel: '5600' }),
    lifecycle: () => actions.setScannerSessionLifecycle.handler(ctx, { sessionId: id, status: 'completed' }) };
}
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
const errorData = error => JSON.parse(JSON.stringify(error.data));
await test('auth rejection happens before database/identity access', async () => {
  const f = fixture({ allowed: false }); await assert.rejects(f.run(), /Denied/);
  assert.deepEqual(f.trace, ['auth:inventory.write']);
});
await test('recognized stale revision survives real ConvexError data serialization with no retry or pulse', async () => {
  const f = fixture(); let caught;
  await assert.rejects(f.run(), error => { caught = error; return error instanceof ConvexError; });
  assert.deepEqual(errorData(caught), { kind: 'dhr', code: 'REVISION_CONFLICT' });
  assert.equal(client.safeDhrError({ message: 'Server Error', data: errorData(caught) }), contract.DHR_ERROR_MESSAGES.REVISION_CONFLICT);
  assert.equal(f.trace.filter(x => typeof x === 'object').length, 1);
  assert.equal(f.trace.includes('pulse'), false);
  assert.equal(f.trace[2].body.p_actor, 'Trusted Admin');
});
await test('known inventory and lifecycle errors return only allowlisted codes', async () => {
  for (const [code, message, expected] of [
    ['P0001', 'Inventory part not found for controlled DHR part: J19057', 'PART_NOT_FOUND'],
    ['P0001', 'Ambiguous inventory part for controlled DHR part: J19057', 'AMBIGUOUS_PART'],
    ['P0001', 'Insufficient stock: requested 2, available 1', 'INSUFFICIENT_STOCK'],
    ['P0001', 'DHR session is not open for inventory consumption', 'SESSION_CLOSED'],
    ['P0001', 'correlationId already used for a different DHR event', 'IDEMPOTENCY_CONFLICT'],
    ['P0001', 'Legacy DHR result requires inventory reconciliation before scanner mutation', 'LEGACY_RECONCILIATION_REQUIRED'],
    ['40001', 'DHR session revision conflict: expected 0, current 1', 'REVISION_CONFLICT'],
  ]) {
    const f = fixture({ payload: { code, message, details: 'private row', hint: 'private hint' } });
    await assert.rejects(f.run(), error => { assert.deepEqual(errorData(error), { kind: 'dhr', code: expected }); return true; });
    assert.equal(f.trace.includes('pulse'), false);
  }
});
await test('unknown and malformed provider errors are redacted, including similar diagnostic text', async () => {
  for (const payload of [null, [], 'private', { message: ['private'] }, { error: 'private' }, { code: 'XX000', message: 'DHR revision conflict: expected 0, current 1' }, { code: 'P0001', message: 'private: DHR revision conflict: expected 0, current 1' }, { code: 'P0001', message: 'DHR revision conflict: expected 0, current 1\nprivate detail' }, { code: 'P0001', message: 'private password SQL' }]) {
    const f = fixture({ payload });
    await assert.rejects(f.run(), error => { assert.deepEqual(errorData(error), { kind: 'dhr', code: 'OPERATION_UNCONFIRMED' }); return true; });
    assert.equal(f.trace.filter(x => typeof x === 'object').length, 1);
    assert.equal(f.trace.includes('pulse'), false);
  }
  await assert.rejects(fixture({ parseFailure: true }).run(), error => error.data.code === 'OPERATION_UNCONFIRMED');
});
await test('session creation and lifecycle writes share provider containment', async () => {
  for (const method of ['create', 'lifecycle']) {
    const f = fixture({ payload: { code: 'XX000', message: 'private diagnostic' } });
    await assert.rejects(f[method](), error => error.data.code === 'OPERATION_UNCONFIRMED');
    assert.equal(f.trace.includes('pulse'), false);
  }
});
await test('accepted receipt is unchanged and emits exactly one pulse', async () => {
  const payload = { eventId: 'event', revisionAfter: 1, delta: 1, duplicate: false };
  const f = fixture({ ok: true, payload }); assert.equal(await f.run(), payload);
  assert.equal(f.trace.filter(x => typeof x === 'object').length, 1);
  assert.equal(f.trace.filter(x => x === 'pulse').length, 1);
});
await test('client ignores raw messages, malformed data and unknown codes', async () => {
  for (const error of [null, Error('private diagnostic'), Error('DHR revision conflict'), { data: 'private' }, { data: { kind: 'other', code: 'REVISION_CONFLICT' } }, { data: { kind: 'dhr', code: '__proto__' } }, { data: { kind: 'dhr', code: 'unknown' } }]) {
    assert.equal(client.safeDhrError(error), contract.DHR_ERROR_MESSAGES.OPERATION_UNCONFIRMED);
  }
});
// Execute the actual component's callback, preserving its control flow and imports.
const ui = fs.readFileSync('src/pages/inventory/DhrScanner.tsx', 'utf8');
const ast = ts.createSourceFile('DhrScanner.tsx', ui, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'applyQuantity') callback = node.initializer.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast); assert(callback); assert(ui.includes('import { safeDhrError as safeError } from "../../lib/dhrErrors"'));
function quantityFixture({ rejected = true, refreshFails = false } = {}) {
  const calls = [];
  const globals = {
    activeSession: { id, instrument_sn: 'TEST' }, resultsMap: new Map(), resultKey: () => 'key',
    setSavingKey: value => calls.push(['saving', value]), showToast: message => calls.push(['toast', message]), safeError: client.safeDhrError,
    applyDhrChecklistChange: async () => { calls.push(['write']); if (rejected) throw new ConvexError({ kind: 'dhr', code: 'REVISION_CONFLICT' }); return {}; },
    refreshSessionResults: async () => { calls.push(['sessionRead']); if (refreshFails) throw Error('private refresh diagnostic'); },
    data: { refresh: async () => { calls.push(['stockRead']); } }, receiptMessage: () => 'Accepted',
  };
  const exports = {};
  vm.runInNewContext(compile('export const run = ' + callback), { exports, ...globals });
  return { calls, run: () => exports.run('5.11', 'J19057', 1, 2, 'Required', 'Filter') };
}
await test('actual UI rejected change reconciles without retry and never claims reload succeeded', async () => {
  for (const refreshFails of [false, true]) {
    const f = quantityFixture({ refreshFails }); await f.run();
    assert.equal(f.calls.filter(x => x[0] === 'write').length, 1);
    assert.equal(f.calls.filter(x => x[0] === 'sessionRead').length, 1);
    assert.equal(f.calls.find(x => x[0] === 'toast')[1], contract.DHR_ERROR_MESSAGES.REVISION_CONFLICT);
    assert.deepEqual(f.calls.at(-1), ['saving', null]);
  }
});
await test('actual UI success keeps authoritative refresh and receipt feedback', async () => {
  const f = quantityFixture({ rejected: false }); await f.run();
  assert.equal(f.calls.filter(x => x[0] === 'write').length, 1);
  assert(f.calls.some(x => x[0] === 'sessionRead')); assert(f.calls.some(x => x[0] === 'stockRead'));
  assert.equal(f.calls.find(x => x[0] === 'toast')[1], 'Accepted');
});
console.log(`DHR error contract: ${checks} checks PASS`);
