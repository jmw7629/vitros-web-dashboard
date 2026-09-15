// Exercise the actual data provider and refresh coordinator with synthetic transport.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as coordinator from '../src/lib/refreshCoordinator.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const req = createRequire(process.env.VITROS_TEST_NODE_MODULES ? path.join(process.env.VITROS_TEST_NODE_MODULES, 'entry.cjs') : import.meta.url);
const React = req('react');
const { create, act } = req('react-test-renderer');
const ts = req('typescript');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const stock = name => [{ id: name, part_number: name, qty_on_hand: 0, min_qty: 1, max_qty: 1 }];
async function fixture() {
  const f = { user: undefined, calls: [], fallback: [], http: [], overrides: {}, snapshot: null };
  const actions = new Map();
  const defaults = name => name === 'listStock' ? stock(f.user._id)
    : name === 'listCore' ? { analyzers: [], lvccItems: [], weeklyNotes: [] }
    : name === 'listPlanning' ? { trackerWeekly: [], buildPlan: [], staff: [], targets: [] } : [];
  const modules = {
    react: React,
    'react/jsx-runtime': req('react/jsx-runtime'),
    'convex/react': {
      useQuery: () => f.user,
      useAction: name => {
        if (!actions.has(name)) actions.set(name, async () => {
          f.calls.push(name);
          return f.overrides[name] ? f.overrides[name]() : defaults(name);
        });
        return actions.get(name);
      },
    },
    '../../convex/_generated/api': { api: new Proxy({}, { get: () => new Proxy({}, { get: (_, name) => name }) }) },
    '../lib/employeeOperationIdentity': { employeeOperationIdentity: () => { throw new Error('Unexpected write'); } },
    '../lib/browserSafeRead': { browserSafeRead: async name => { f.fallback.push(name); throw new Error('Synthetic unavailable stock'); } },
    '../lib/refreshCoordinator.mjs': coordinator,
  };
  const listeners = {};
  const timers = new Map(); let nextTimer = 0;
  const surface = {
    addEventListener: (name, callback) => { listeners[name] = callback; },
    removeEventListener: name => { delete listeners[name]; },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: id => timers.delete(id),
  };
  const filename = path.join(root, 'src/hooks/useConvexData.tsx');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, require: name => {
      assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
    }, console, Date, Math, Error, window: surface, document: { ...surface, visibilityState: 'visible' },
    fetch: async (_, options) => { f.http.push(JSON.parse(options.body).path); return { json: async () => ({ status: 'success', value: [] }) }; },
  }, { filename });
  const { ConvexDataProvider, useConvexData } = module.exports;
  function Probe() { f.snapshot = useConvexData(); return null; }
  const tree = () => React.createElement(ConvexDataProvider, null, React.createElement(Probe));
  let view;
  await act(async () => { view = create(tree()); });
  f.identity = async user => { await act(async () => { f.user = user; view.update(tree()); }); };
  f.close = async () => { await act(async () => view.unmount()); assert.equal(timers.size, 0); };
  f.online = async () => { await act(async () => listeners.online()); };
  return f;
}
let checks = 0;
async function test(name, run) { await run(); console.log(`PASS ${name}`); checks++; }
await test('pending and signed-out sessions never request data, including refresh triggers', async () => {
  const f = await fixture();
  await f.online();
  await f.identity(null);
  await act(async () => f.snapshot.refresh());
  assert.equal(f.calls.length + f.fallback.length + f.http.length, 0);
  assert.equal(f.snapshot.isLoading, false);
  await f.close();
});
await test('server identity immediately loads mapped stock without advancing the poll timer', async () => {
  const f = await fixture();
  await f.identity({ _id: 'engineer', role: 'engineer' });
  assert.equal(f.snapshot.parts[0].partNumber, 'engineer');
  assert.equal(f.snapshot.parts[0].minQty, 1);
  assert.equal(f.snapshot.isLoading, false);
  assert.equal(f.snapshot.error, null);
  assert.ok(!f.calls.includes('listEmployees'));
  assert.equal(f.fallback.length, 0);
  await f.close();
});
await test('logout clears loaded snapshots and blocks further refresh reads', async () => {
  const f = await fixture();
  await f.identity({ _id: 'admin', role: 'superuser' });
  assert.equal(f.snapshot.parts.length, 1);
  const count = f.calls.length;
  await f.identity(null); await f.online();
  assert.equal(f.snapshot.parts.length, 0);
  assert.equal(f.snapshot.employees.length, 0);
  assert.equal(f.calls.length, count);
  await f.close();
});
for (const outcome of ['resolve', 'reject']) await test(`old identity ${outcome} cannot publish data or start a fallback after logout`, async () => {
  const f = await fixture(); const pending = deferred();
  f.overrides.listStock = () => pending.promise;
  await f.identity({ _id: 'old', role: 'engineer' });
  await f.identity(null);
  const count = f.calls.length;
  await act(async () => { pending[outcome](outcome === 'resolve' ? stock('old') : new Error('Expired session')); });
  assert.equal(f.snapshot.parts.length, 0);
  assert.equal(f.snapshot.error, null);
  assert.equal(f.calls.length, count);
  assert.equal(f.fallback.length, 0);
  await f.close();
});
await test('identity replacement queues fresh data and discards prior in-flight results', async () => {
  const f = await fixture(); const pending = deferred();
  f.overrides.listStock = () => pending.promise;
  await f.identity({ _id: 'old', role: 'engineer' });
  delete f.overrides.listStock;
  await f.identity({ _id: 'new', role: 'engineer' });
  await act(async () => pending.resolve(stock('old')));
  assert.equal(f.snapshot.parts[0].partNumber, 'new');
  assert.equal(f.snapshot.error, null);
  await f.close();
});
await test('late REM responses cannot restore state after logout', async () => {
  const f = await fixture(); const pending = deferred();
  f.overrides.listCore = () => pending.promise;
  await f.identity({ _id: 'old', role: 'engineer' });
  assert.equal(f.snapshot.parts.length, 1);
  await f.identity(null);
  await act(async () => pending.resolve({ analyzers: [{ serial: 'old' }], lvccItems: [], weeklyNotes: [] }));
  assert.equal(f.snapshot.parts.length, 0);
  assert.equal(f.snapshot.analyzers.length, 0);
  assert.equal(f.http.length, 0);
  await f.close();
});
await test('current authenticated failures remain visible and fail closed', async () => {
  const f = await fixture();
  f.overrides.listStock = async () => { throw new Error('Synthetic server failure'); };
  await f.identity({ _id: 'engineer', role: 'engineer' });
  assert.equal(f.snapshot.error, 'Synthetic unavailable stock');
  assert.equal(f.snapshot.parts.length, 0);
  assert.equal(f.snapshot.isLoading, false);
  assert.ok(f.fallback.includes('stock'));
  await f.close();
});
console.log(`Actual data provider authentication readiness: ${checks} checks PASS`);
