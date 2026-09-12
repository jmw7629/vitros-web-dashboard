// Executes real UserDashboard TSX and dropdown handlers with synthetic hooks/data.
// This validates presentation attribution, not server authorization or live data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../src/pages/inventory/UserDashboard.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const engineer = { _id: 'actor-self', name: 'Same Name', email: 'self@example.test', role: 'engineer' };
const mapped = { _id: 'directory-row', actorId: 'actor-mapped', name: 'Mapped Employee', initials: 'ME', active: true };
const unlinked = { _id: 'directory-unlinked', name: 'Unlinked Employee', initials: 'UE', active: true };
const transactions = [
  ['actor-self', 'SELF-EXACT', 2], ['Same Name', 'FOREIGN-NAME', 99], ['SN', 'FOREIGN-INITIALS', 99],
  ['actor-foreign', 'FOREIGN-ACTOR', 99], ['actor-mapped', 'MAPPED-EXACT', 3],
  ['directory-row', 'DIRECTORY-ID-NOT-ACTOR', 99], ['Mapped Employee', 'MAPPED-NAME-NOT-ACTOR', 99],
  ['directory-unlinked', 'UNLINKED-DIRECTORY', 99], ['Unlinked Employee', 'UNLINKED-NAME', 99], ['UE', 'UNLINKED-INITIALS', 99],
].map(([user, partNumber, qty], index) => ({ user, partNumber, qty, mode: 'OUT', timestamp: index, description: 'Synthetic test transaction' }));
const batches = [{ intakeBatchId: 'batch-self', createdBy: 'actor-self' }, { intakeBatchId: 'batch-label', createdBy: 'Same Name' }, { intakeBatchId: 'batch-mapped', createdBy: 'actor-mapped' }];
const stockLog = batches.map((batch, i) => ({ intakeBatchId: batch.intakeBatchId, partNumber: `RECEIVED-${batch.intakeBatchId}`, qtyAdded: i + 1 }));

function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  return typeof node === 'object' ? text(node.props?.children) : String(node);
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function harness(identity, employees) {
  let tree;
  let cursor = 0;
  const state = [];
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const imports = {
    react: {
      useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
      useMemo: fn => fn(),
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'convex/react': { useQuery: query => { assert.equal(query, 'auth.currentUser'); return identity; } },
    '../../../convex/_generated/api': { api: { auth: { currentUser: 'auth.currentUser' } } },
    '../../hooks/useConvexData': { useConvexData: () => ({ employees, transactions, batches, stockLog }) },
    '../../components/vitros/SharedComponents': { WebCard: 'card', StatusBadge: 'badge', DashCard: 'dash', theme: {}, modeColor: () => '', formatDate: () => '' },
    'lucide-react': {},
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => { assert.ok(name in imports, `Unexpected import: ${name}`); return imports[name]; } }, { filename: 'UserDashboard.component-under-test.js' });
  const render = () => { cursor = 0; tree = exports.UserDashboard(); };
  function find(type, predicate) { const result = nodes(tree).filter(n => n.type === type && predicate(n)); assert.equal(result.length, 1, `Expected one ${type}, found ${result.length}`); return result[0]; }
  function open() { find('input', n => n.props['aria-label'] === 'Search employee activity').props.onFocus(); render(); }
  function select(id) { open(); find('button', n => n.key === id).props.onClick(); render(); }
  function stat(label) { return find('dash', n => n.props.label === label).props.value; }
  function history(expected) {
    const body = text(tree);
    for (const tx of transactions) assert.equal(body.includes(tx.partNumber), expected.includes(tx.partNumber), `Attribution of ${tx.partNumber}`);
  }
  render();
  return { open, select, stat, history, body: () => text(tree), options: () => nodes(tree).filter(n => n.type === 'button' && n.key != null).map(n => n.key), statuses: () => nodes(tree).filter(n => n.props.role === 'status').map(text) };
}

for (const employees of [[], [mapped, unlinked]]) {
  const h = harness(engineer, employees);
  h.history(['SELF-EXACT']);
  assert.equal(h.stat('TRANSACTIONS'), 1);
  assert.equal(h.stat('PARTS OUT'), 2);
  assert.equal(h.stat('RECEIVED'), 1);
  assert.ok(h.body().includes('RECEIVED-batch-self'));
  assert.ok(!h.body().includes('RECEIVED-batch-label'));
  h.open();
  assert.deepEqual(h.options(), [engineer._id], 'Engineer may select only authenticated self');
  h.select(engineer._id);
  h.history(['SELF-EXACT']);
  console.log(`PASS engineer: exact self attribution, read-only actor source, ${employees.length ? 'directory ignored' : 'empty directory supported'}`);
}

const admin = { ...engineer, _id: 'actor-admin', name: 'Test Admin', role: 'superuser' };
const h = harness(admin, [mapped, unlinked, { ...mapped, _id: 'inactive-row', active: false }, { ...mapped, _id: 'duplicate-self', actorId: admin._id }]);
h.open();
assert.deepEqual(h.options(), [admin._id, mapped._id, unlinked._id], 'Active admin options use directory row IDs and deduplicate self');
h.select(mapped._id);
h.history(['MAPPED-EXACT']);
assert.equal(h.stat('TRANSACTIONS'), 1);
assert.equal(h.stat('PARTS OUT'), 3);
assert.equal(h.stat('RECEIVED'), 3);
assert.ok(h.body().includes('RECEIVED-batch-mapped'));
assert.ok(!h.body().includes('RECEIVED-batch-self'));
console.log('PASS admin mapped employee: actual dropdown row ID selects canonical actorId activity');
h.select(unlinked._id);
h.history([]);
assert.equal(h.statuses().length, 1);
assert.match(h.statuses()[0], /No verified account is linked to Unlinked Employee yet/);
assert.ok(!h.body().includes('Recent Transactions'));
console.log('PASS admin unlinked employee: explicit status and no guessed directory/name/initials attribution');
for (const identity of [null, undefined]) {
  const signedOut = harness(identity, [mapped]);
  signedOut.history([]);
  signedOut.open();
  assert.deepEqual(signedOut.options(), []);
  console.log(`PASS ${identity === null ? 'signed-out' : 'loading'} identity: no activity or directory options`);
}
console.log('UserDashboard identity regression passed: 6 actual-render/selection paths; no remote writes.');
