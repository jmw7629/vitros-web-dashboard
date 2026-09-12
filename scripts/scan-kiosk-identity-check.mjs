// Synthetic component regression. Executes the real TSX render and event handlers;
// stubs external hooks only. No DOM/camera/network/backend authority is exercised.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/pages/inventory/ScanKiosk.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const self = { _id: 'test-authenticated-engineer', name: 'Test Engineer', role: 'engineer' };
const part = { _id: 'test-part', partNumber: 'TEST-PART', description: 'Synthetic component fixture', qoh: 10, minQty: 1, maxQty: 20, status: 'OK' };

function harness(identity) {
  const state = [];
  let cursor = 0;
  let tree;
  const calls = [];
  const data = { employees: [], parts: [part], kits: [{ kitId: 'test-kit', name: 'Synthetic Kit', basePartNumber: 'TEST-KIT', components: [{ partNumber: part.partNumber, qtyRequired: 2 }] }], scanPart: async (...args) => calls.push(args) };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const imports = {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
      },
      useMemo: fn => fn(), useCallback: fn => fn, useRef: initial => ({ current: initial }), useEffect: () => {},
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'convex/react': { useQuery: query => { assert.equal(query, 'auth.currentUser'); return identity; } },
    '../../../convex/_generated/api': { api: { auth: { currentUser: 'auth.currentUser' } } },
    '../../hooks/useConvexData': { useConvexData: () => data },
    '../../components/vitros/SharedComponents': { WebCard: 'card', StatusBadge: 'badge', DashCard: 'dash', theme: {}, statusColor: () => '', modeColor: () => '', formatDate: () => '' },
    'lucide-react': {},
    'zxing-wasm/reader': { readBarcodesFromImageData: () => { throw new Error('Camera is out of scope'); } },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; } }, { filename: 'ScanKiosk.component-under-test.js' });
  function render() { cursor = 0; tree = exports.ScanKiosk(); return tree; }
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  function text(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (Array.isArray(node)) return node.map(text).join('');
    return typeof node === 'object' ? text(node.props?.children) : String(node);
  }
  function find(type, predicate) { const found = nodes(tree).filter(n => n.type === type && predicate(n)); assert.equal(found.length, 1, `Expected one ${type}, found ${found.length}`); return found[0]; }
  const button = pattern => find('button', n => pattern.test(text(n)));
  async function click(pattern) { const node = button(pattern); assert.ok(!node.props.disabled, `Disabled button: ${text(node)}`); await node.props.onClick(); render(); }
  function fill(predicate, value) { find('input', n => predicate(n.props)).props.onChange({ target: { value } }); render(); }
  function operator() {
    const input = find('input', n => n.props['aria-label'] === 'Signed-in operator');
    assert.equal(input.props.readOnly, true);
    assert.equal(input.props.onChange, undefined);
    assert.equal(input.props.value, identity?.name ?? 'Sign in to continue');
    assert.equal(nodes(tree).filter(n => n.type === 'select').length, 0, 'No employee directory selector');
  }
  render();
  return { render, button, click, fill, operator, calls, data };
}

for (const mode of ['IN', 'OUT']) {
  for (const identity of [self, null, undefined]) {
    const h = harness(identity);
    await h.click(mode === 'IN' ? /Stock In/ : /Stock Out/);
    h.operator();
    h.fill(p => p.id === 'part-search-input', 'TEST-PART');
    await h.click(/TEST-PART/);
    await h.click(/Add 1 to Batch/);
    if (mode === 'OUT') {
      assert.equal(h.button(/Commit Batch/).props.disabled, true, 'OUT needs analyzer serial');
      h.fill(p => p.placeholder === 'Enter analyzer serial number...', 'TEST-SERIAL');
    }
    assert.equal(Boolean(h.button(/Commit Batch/).props.disabled), !identity);
    if (identity) {
      await h.click(/Commit Batch/);
      assert.equal(h.calls.length, 1);
      assert.deepEqual(h.calls[0], [mode, part.partNumber, 1, self._id, mode === 'OUT' ? 'TEST-SERIAL' : undefined]);
    } else assert.equal(h.calls.length, 0);
    assert.equal(h.data.employees.length, 0);
    console.log(`PASS standard ${mode}: ${identity ? 'authenticated self commits with empty directory' : identity === null ? 'signed-out disabled' : 'loading identity disabled'}`);
  }
}

for (const identity of [self, null, undefined]) {
  const h = harness(identity);
  await h.click(/Synthetic Kit/);
  h.operator();
  assert.equal(h.button(/Consume Kit \(/).props.disabled, true, 'Kit needs analyzer serial');
  h.fill(p => p.placeholder === 'Enter analyzer serial number...', 'TEST-SERIAL');
  assert.equal(Boolean(h.button(/Consume Kit \(/).props.disabled), !identity);
  if (identity) {
    await h.click(/Consume Kit \(/);
    h.operator();
    assert.equal(Boolean(h.button(/Commit Batch/).props.disabled), false);
    await h.click(/Commit Batch/);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0], ['OUT', part.partNumber, 2, self._id, 'TEST-SERIAL']);
  } else assert.equal(h.calls.length, 0);
  console.log(`PASS kit: ${identity ? 'preview and actual OUT commit use self with empty directory' : identity === null ? 'signed-out disabled' : 'loading identity disabled'}`);
}
console.log('ScanKiosk identity regression passed: 9 actual-render/event paths; no remote writes.');
