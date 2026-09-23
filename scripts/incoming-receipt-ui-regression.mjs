// Regression harness adapted from the independent issue70 reproducer.
// Candidate-author additions are not an independent review. Actual TS/TSX runs in fresh VM modules.
// React and actual action/review/identity code execute; auth, OCR, RPC and file IO are synthetic.
// Never connect to a provider, database, browser session or production endpoint.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const run = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(run, '..');
const require = createRequire(path.join(root, 'package.json'));
const React = require('react');
const { create, act } = require('react-test-renderer');
const ts = require('typescript');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = async () => { throw Error('Verifier prohibits external networking'); };
const refs = new Proxy({}, { get: (_t, mod) => new Proxy({}, { get: (_u, fn) => `${String(mod)}:${String(fn)}` }) });
const text = node => typeof node === 'string' ? node : (node?.children ?? []).map(text).join('');
const clean = value => JSON.parse(JSON.stringify(value));
const results = [];
function fixture() {
  return { allowed: true, auth: [], requests: [], rpc: [], calls: [], reviews: [], pulses: 0,
    stock: [{ id: 'fixture-a', part_number: 'TEST-A', description: 'Fixture alpha', qty_on_hand: 10 },
            { id: 'fixture-b', part_number: 'TEST-B', description: 'Fixture beta', qty_on_hand: 20 }],
    ocr: [{ partNumber: 'TEST-A', shippedQuantity: 2, orderedQuantity: 9, page: '1', lineNo: 1, documentRef: 'FIXTURE-DOC' },
          { partNumber: 'TEST-B', shippedQuantity: 3, page: '1', lineNo: 2, documentRef: 'FIXTURE-DOC' }],
    attempts: new Map(), acknowledged: new Set(), rpcBehavior: null, refreshes: 0 };
}
function loader(f) {
  const cache = new Map();
  const load = relative => {
    let filename = path.resolve(root, relative);
    if (!fs.existsSync(filename)) filename = ['.tsx', '.ts'].map(ext => filename + ext).find(fs.existsSync);
    assert(filename && filename.startsWith(root + '/'), `Local source module only: ${relative}`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
    const scopedRequire = name => {
      if (name === './_generated/server') return { action: spec => spec };
      if (name === './authGuard') return { requireCapability: async (_ctx, capability) => {
        f.auth.push(capability); if (!f.allowed) throw Error('Fixture authorization denied'); return 'fixture-server-actor'; } };
      if (name === './realtimePulsePublisher') return { publishRealtimePulse: async () => { f.pulses++; } };
      if (name.endsWith('/_generated/api')) return { api: refs, internal: refs };
      if (name === 'convex/values') return { v: new Proxy({}, { get: () => () => ({}) }) };
      if (name === 'convex/react') return { useAction: ref => async args => {
        f.calls.push({ ref, args: clean(args) });
        if (ref === 'aiGateway:ocrPackingList' || ref === 'incomingStockPdfOcr:ocrPackingListPdf') return JSON.stringify(f.ocr);
        const actions = load('convex/incomingStockActions.ts');
        if (ref === 'incomingStockActions:reviewPackingListDraft') {
          const reply = await actions.reviewPackingListDraft.handler({}, args); f.reviews.push(clean(reply)); return reply;
        }
        if (ref === 'incomingStockActions:commitConfirmedReceiveLine') return actions.commitConfirmedReceiveLine.handler({}, args);
        if (ref === 'incomingStockActions:getIncomingReceiptRecovery') return actions.getIncomingReceiptRecovery.handler({}, args);
        if (ref === 'incomingStockActions:acknowledgeIncomingReceiptAttempt') return actions.acknowledgeIncomingReceiptAttempt.handler({}, args);
        if (ref === 'incomingStockActions:reserveIncomingManualReceiptReview') return actions.reserveIncomingManualReceiptReview.handler({}, args);
        if (ref === 'incomingStockActions:resolveIncomingReceiptAttempt') return actions.resolveIncomingReceiptAttempt.handler({}, args);
        throw Error(`Unexpected synthetic action ${ref}`);
      } };
      if (name.endsWith('/hooks/useConvexData')) return { useConvexData: () => ({
        parts: f.stock.map(p => ({ partNumber: p.part_number })), refresh: async () => { f.refreshes++; } }) };
      if (name.endsWith('/vitros/SharedComponents')) return { theme: {}, WebCard: p => React.createElement('div', p, p.children) };
      if (name === 'lucide-react') return new Proxy({}, { get: (_t, icon) => p => React.createElement('i', { ...p, 'data-fixture-icon': String(icon) }) });
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), name)));
      throw Error(`Unapproved module import ${name}`);
    };
    class FixtureFileReader {
      readAsDataURL(file) { this.result = `data:${file.type};base64,Zml4dHVyZQ==`; queueMicrotask(() => this.onload?.()); }
    }
    vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require: scopedRequire,
      console, Error, TypeError, Date, JSON, Math, Map, Set, Number, String, Boolean, Object, Array,
      setTimeout, clearTimeout, structuredClone, crypto: { randomUUID }, FileReader: FixtureFileReader,
      process: { env: { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only-not-a-credential' } },
      fetch: async (input, options) => {
        const u = new URL(String(input)); assert.equal(u.origin, 'https://fixture.invalid');
        f.requests.push({ path: u.pathname, method: options.method });
        if (options.method === 'GET') {
          assert.equal(u.pathname, '/rest/v1/stock');
          const offset = Number(u.searchParams.get('offset')); const limit = Number(u.searchParams.get('limit'));
          return { ok: true, json: async () => f.stock.slice(offset, offset + limit) };
        }
        assert.equal(options.method, 'POST');
        const payload = JSON.parse(options.body);
        const rpcName = u.pathname.split('/').at(-1);
        if (rpcName === 'list_incoming_receipt_recovery') {
          const rows = [...f.attempts.values()].filter(a => a.actor === payload.p_actor && !f.acknowledged.has(a.attemptId) && a.state !== 'abandoned');
          return { ok: true, json: async () => rows.map(clean) };
        }
        if (rpcName === 'reserve_incoming_manual_receipt_review') {
          const doc = String(payload.p_document_ref ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
          const otherOpen = [...f.attempts.values()].find(a => a.batchId === doc && a.actor !== payload.p_actor && a.state !== 'abandoned' && !f.acknowledged.has(a.attemptId));
          if (otherOpen) return { ok: false, status: 409, json: async () => ({ ignored: 'diagnostic' }) };
          const used = [...f.attempts.values()].filter(a => a.batchId === doc && a.sourcePage === 'MANUAL').map(a => a.sourceLineNo);
          const sourceLineNo = used.length ? Math.max(...used) + 1 : 1;
          const correlationId = `incoming:${doc}|MANUAL|${sourceLineNo}`;
          const attempt = { attemptId: `attempt-${f.attempts.size + 1}`, state: 'reviewed', revision: 1, actor: payload.p_actor,
            documentRef: String(payload.p_document_ref).trim(), sourcePage: 'MANUAL', sourceLineNo, partNumber: payload.p_part_number,
            qty: payload.p_qty, correlationId, batchId: doc, receipt: null };
          f.attempts.set(attempt.attemptId, attempt);
          return { ok: true, json: async () => clean(attempt) };
        }
        if (rpcName === 'register_incoming_receipt_review') {
          const correlationId = payload.p_correlation_id;
          let attempt = [...f.attempts.values()].find(a => a.correlationId === correlationId);
          if (!attempt) {
            attempt = { attemptId: `attempt-${f.attempts.size + 1}`, state: 'reviewed', revision: 1, actor: payload.p_actor,
              documentRef: payload.p_document_ref, sourcePage: payload.p_source_page ?? null, sourceLineNo: payload.p_source_line_no,
              partNumber: payload.p_part_number, qty: payload.p_qty, correlationId, batchId: payload.p_batch_id, receipt: null };
            f.attempts.set(attempt.attemptId, attempt);
          }
          return { ok: true, json: async () => clean(attempt) };
        }
        if (rpcName === 'execute_incoming_receipt_attempt') {
          const attempt = f.attempts.get(payload.p_attempt_id); assert(attempt, 'Synthetic receipt attempt exists');
          const movement = { p_part_number: attempt.partNumber, p_mode: 'RECEIVE', p_qty: attempt.qty, p_user: attempt.actor,
            p_correlation_id: attempt.correlationId, p_expected_revision: null, p_batch_id: attempt.batchId };
          f.rpc.push(movement);
          const response = f.rpcBehavior ? await f.rpcBehavior(movement, f.rpc.length)
            : { ok: true, json: async () => ({ duplicate: false, fixture: true, correlationId: movement.p_correlation_id }) };
          if (!response.ok) return response;
          const receipt = await response.json();
          attempt.state = 'accepted'; attempt.revision += 2; attempt.receipt = receipt;
          return { ok: true, json: async () => clean(attempt) };
        }
        if (rpcName === 'mark_incoming_receipt_attempt_unknown') {
          const attempt = f.attempts.get(payload.p_attempt_id); assert(attempt, 'Synthetic receipt attempt exists');
          if (attempt.state !== 'accepted') { attempt.state = 'unknown'; attempt.revision += 1; }
          return { ok: true, json: async () => clean(attempt) };
        }
        if (rpcName === 'acknowledge_incoming_receipt_attempt') {
          const attempt = f.attempts.get(payload.p_attempt_id); assert(attempt, 'Synthetic receipt attempt exists');
          f.acknowledged.add(attempt.attemptId); attempt.revision += 1;
          return { ok: true, json: async () => clean(attempt) };
        }
        if (rpcName === 'resolve_incoming_receipt_attempt') {
          const attempt = f.attempts.get(payload.p_attempt_id); assert(attempt, 'Synthetic receipt attempt exists');
          if (attempt.actor !== payload.p_actor || attempt.revision !== payload.p_expected_revision || !['reviewed','conflict'].includes(attempt.state))
            return { ok: false, status: 409, json: async () => ({ ignored: 'diagnostic' }) };
          if (attempt.receipt) return { ok: false, status: 409, json: async () => ({ ignored: 'diagnostic' }) };
          attempt.state = 'abandoned'; attempt.revision += 1;
          return { ok: true, json: async () => clean(attempt) };
        }
        throw Error(`Unexpected synthetic RPC ${rpcName}`);
      },
    }, { filename, timeout: 10000 });
    return module.exports;
  };
  return load;
}
const args = (overrides = {}) => ({ partNumber: 'TEST-A', qty: 2, confirmationId: 'fixture-presentation-key',
  documentRef: 'FIXTURE-DOC', sourcePage: '1', sourceLineNo: 1, ...overrides });
async function withUI(f, fn, document = false) {
  const load = loader(f); const file = document ? 'IncomingStockDocument' : 'IncomingStockSecure';
  const Component = load(`src/pages/inventory/${file}.tsx`)[file]; let renderer;
  const settle = async () => { await act(async () => { await new Promise(setImmediate); await new Promise(setImmediate); }); };
  await act(async () => { renderer = create(React.createElement(Component)); });
  const buttons = () => renderer.root.findAllByType('button');
  const input = placeholder => renderer.root.findAllByType('input').find(n => n.props.placeholder === placeholder);
  const click = async b => { assert(b && !b.props.disabled, 'UI control is enabled'); await act(async () => { b.props.onClick(); }); await settle(); };
  const change = async (n, value) => { assert(n && !n.props.disabled, 'Input is enabled'); await act(async () => n.props.onChange({ target: { value } })); };
  const h = { renderer, buttons, input, click, change, settle,
    confirm: () => buttons().find(b => text(b).includes(document ? 'Confirm & Receive PDF (' : 'Confirm & Receive (')),
    doc: () => input('Required for deterministic receipt identity'),
    manual: async (part = 'TEST-A', qty = '2') => {
      await change(input('Part number'), part); await change(input('Qty'), qty);
      await click(buttons().find(b => text(b) === 'Review'));
    },
    upload: async () => {
      if (document) await click(buttons().find(b => b.props['aria-label'] === 'Open Incoming Stock PDF packing-list intake'));
      const n = renderer.root.findAllByType('input').find(n => n.props.type === 'file' && (document ? n.props.accept === 'application/pdf,.pdf' : n.props.accept === 'image/*'));
      await act(async () => n.props.onChange({ target: { value: '', files: [{ type: document ? 'application/pdf' : 'image/png', name: document ? 'fixture.pdf' : 'fixture.png', size: 7 }] } }));
      await settle();
    },
  };
  try { await fn(h); } finally { await act(async () => renderer.unmount()); }
}
async function test(name, fn) {
  const f = fixture(); let status = 'PASS', error = null;
  try { await fn(f); } catch (e) { status = 'FAIL'; error = String(e.stack ?? e); }
  const result = { name, status, error, trace: { auth: f.auth, rpc: f.rpc, actionCalls: f.calls, reviewIdentities: f.reviews.map(r => r.lines.map(l => l.deterministicIdentity)), pulses: f.pulses } };
  results.push(result); console.log(`${status} ${name}${error ? '\n' + error : ''}`);
}
await test('Actual action denies authorization before any stock/RPC access', async f => {
  f.allowed = false; const actions = loader(f)('convex/incomingStockActions.ts');
  await assert.rejects(actions.commitConfirmedReceiveLine.handler({}, args()), /authorization denied/);
  assert.deepEqual(f.auth, ['inventory.write']); assert.equal(f.requests.length, 0);
});
await test('Actual action rejects invalid RECEIVE quantities before any stock/RPC access', async f => {
  const actions = loader(f)('convex/incomingStockActions.ts');
  for (const qty of [0, -1, 1.5, NaN, Infinity]) await assert.rejects(actions.commitConfirmedReceiveLine.handler({}, args({ qty })), /positive integer/);
  assert.equal(f.requests.length, 0);
});
await test('Actual action requires document, presentation key and valid physical line', async f => {
  const actions = loader(f)('convex/incomingStockActions.ts');
  for (const change of [{ documentRef: undefined }, { documentRef: ' ' }, { confirmationId: '' }, { sourceLineNo: 0 }, { sourceLineNo: 1.5 }, { sourceLineNo: 501 }]) {
    await assert.rejects(actions.commitConfirmedReceiveLine.handler({}, args(change)));
  }
  assert.equal(f.requests.length, 0);
});
await test('Actual action rejects unknown and ambiguous canonical parts before RECEIVE', async f => {
  const actions = loader(f)('convex/incomingStockActions.ts');
  await assert.rejects(actions.commitConfirmedReceiveLine.handler({}, args({ partNumber: 'TEST-A-WRONG' })), /not present/);
  f.stock.push({ id: 'fixture-duplicate', part_number: ' test-a ' });
  await assert.rejects(actions.commitConfirmedReceiveLine.handler({}, args()), /ambiguous/);
  assert.equal(f.rpc.length, 0); assert.equal(f.pulses, 0);
});
await test('Actual action uses server actor, canonical PN and stable request identity', async f => {
  const actions = loader(f)('convex/incomingStockActions.ts');
  const first = await actions.commitConfirmedReceiveLine.handler({}, args({ partNumber: ' test-a ', documentRef: ' fixture-doc ' }));
  const second = await actions.commitConfirmedReceiveLine.handler({}, args({ confirmationId: 'new-presentation-key' }));
  assert.equal(first.correlationId, second.correlationId);
  assert.equal(f.rpc.length, 1, 'Accepted same-correlation replay must not create a second inventory movement');
  assert.equal(f.rpc[0].p_part_number, 'TEST-A'); assert.equal(f.rpc[0].p_user, 'fixture-server-actor');
  assert.equal(f.rpc[0].p_mode, 'RECEIVE'); assert.equal(f.rpc[0].p_batch_id, 'FIXTURE-DOC');
  assert.equal(f.rpc[0].p_qty, 2); assert.equal(f.pulses, 2);
});
await test('Actual rejected RPC never parses diagnostic payload, retries or emits pulse', async f => {
  f.rpcBehavior = async () => ({ ok: false, status: 400, json: async () => { throw Error('Fixture diagnostic body must never be read'); } });
  const actions = loader(f)('convex/incomingStockActions.ts');
  await assert.rejects(actions.commitConfirmedReceiveLine.handler({}, args()), error => error.message === 'Receive failed (400)');
  assert.equal(f.rpc.length, 1); assert.equal(f.pulses, 0);
});
await test('Actual review preserves two physical rows, shipped qty and description-independent identity without receiving', async f => {
  const actions = loader(f)('convex/incomingStockActions.ts');
  f.ocr[0].description = 'Intentionally unrelated to stock description';
  const reviewed = await actions.reviewPackingListDraft.handler({}, { ocrJson: JSON.stringify(f.ocr), documentRef: 'FIXTURE-DOC' });
  assert.equal(reviewed.lines.length, 2); assert(reviewed.lines.every(l => l.matchStatus === 'matched'));
  assert.equal(reviewed.lines[0].qtyOcr, 2); assert.equal(reviewed.requiresHumanConfirmation, true);
  assert.equal(reviewed.descriptionUsedForIdentity, false);
  assert.notEqual(reviewed.lines[0].deterministicIdentity, reviewed.lines[1].deterministicIdentity);
  assert.equal(f.rpc.length, 0);
});
await test('Mounted actual image UI reviews without RPC and receives only on explicit confirmation', async f => {
  await withUI(f, async h => {
    await h.upload(); assert.equal(f.reviews.length, 1); assert.equal(f.rpc.length, 0);
    await h.click(h.confirm()); assert.equal(f.rpc.length, 2); assert.equal(f.rpc[0].p_qty, 2); assert.equal(f.rpc[1].p_qty, 3);
    assert.notEqual(f.rpc[0].p_correlation_id, f.rpc[1].p_correlation_id);
  });
});
await test('Mounted actual PDF UI reviews without RPC and receives only on explicit confirmation', async f => {
  await withUI(f, async h => {
    await h.upload(); assert.equal(f.reviews.length, 1); assert.equal(f.rpc.length, 0);
    await h.click(h.confirm()); assert.equal(f.rpc.length, 2);
    assert.notEqual(f.rpc[0].p_correlation_id, f.rpc[1].p_correlation_id);
  }, true);
});
await test('Two separately added manual physical lines are persisted with distinct server-reserved identities before RECEIVE', async f => {
  await withUI(f, async h => {
    await h.change(h.doc(), 'FIXTURE-MANUAL'); await h.manual('TEST-A', '2'); await h.manual('TEST-B', '3');
    assert.equal(f.rpc.length, 0);
    const reserved = [...f.attempts.values()].filter(a => a.batchId === 'FIXTURE-MANUAL' && a.sourcePage === 'MANUAL');
    assert.equal(reserved.length, 2);
    assert.deepEqual(reserved.map(a => a.sourceLineNo).sort((a,b) => a-b), [1,2]);
    assert.notEqual(reserved[0].correlationId, reserved[1].correlationId);
    await h.click(h.confirm()); assert.equal(f.rpc.length, 2);
    assert.notEqual(f.rpc[0].p_correlation_id, f.rpc[1].p_correlation_id,
      'Two different manually appended physical lines reused the same authoritative correlation ID');
  });
});
await test('Unacknowledged image RECEIVE retry cannot silently rebind old reviewed line to an edited document', async f => {
  f.rpcBehavior = async (_p, count) => { if (count === 1) throw Error('Fixture lost acknowledgement; result unknown'); return { ok: true, json: async () => ({ fixture: true, duplicate: false }) }; };
  await withUI(f, async h => {
    await h.change(h.doc(), 'FIXTURE-ORIGINAL'); await h.manual(); await h.click(h.confirm()); assert.equal(f.rpc.length, 1);
    await h.change(h.doc(), 'FIXTURE-EDITED');
    if (h.confirm().props.disabled) return;
    await h.click(h.confirm());
    assert(f.rpc.length === 1 || f.rpc[1].p_correlation_id === f.rpc[0].p_correlation_id,
      'Same previously reviewed uncertain line was sent with a NEW correlation ID after only header edit; no re-review occurred');
  });
});
await test('Unacknowledged PDF RECEIVE retry cannot silently rebind old reviewed line to an edited document', async f => {
  f.ocr = [f.ocr[0]];
  f.rpcBehavior = async (_p, count) => { if (count === 1) throw Error('Fixture lost acknowledgement; result unknown'); return { ok: true, json: async () => ({ fixture: true, duplicate: false }) }; };
  await withUI(f, async h => {
    await h.upload(); await h.click(h.confirm()); assert.equal(f.rpc.length, 1);
    const documentInput = h.renderer.root.findAllByType('input').filter(n => n.props.placeholder === 'Required for deterministic receipt identity').at(-1);
    await h.change(documentInput, 'FIXTURE-EDITED');
    if (h.confirm().props.disabled) return;
    await h.click(h.confirm());
    assert(f.rpc.length === 1 || f.rpc[1].p_correlation_id === f.rpc[0].p_correlation_id,
      'PDF uncertain line was sent with a NEW correlation ID after header edit without re-review');
  }, true);
});
async function queuedChange(f, kind, document = false) {
  let release; const gate = new Promise(resolve => { release = resolve; });
  f.rpcBehavior = async (_payload, count) => { if (count === 1) await gate; return { ok: true, json: async () => ({ fixture: true, duplicate: false }) }; };
  await withUI(f, async h => {
    await h.upload(); await h.click(h.confirm()); assert.equal(f.rpc.length, 1, 'First RECEIVE is in flight');
    try {
      const label = kind === 'remove' ? 'Remove draft line 2' : document ? 'Select PDF line 2 for receiving' : 'Select line 2 for receiving';
      const control = h.buttons().find(b => b.props['aria-label'] === label); assert(control, 'Second queued physical line control exists');
      if (control.props.disabled) return; // Safe alternative: freeze every queued line until batch completion.
      await h.click(control);
      if (kind === 'remove') assert.equal(h.buttons().filter(b => b.props['aria-label'] === label).length, 0, 'Removed draft row is no longer visible');
      assert.equal(f.rpc.length, 1, 'Second line has not been sent before user changes it');
      release(); await h.settle();
      assert.equal(f.rpc.length, 1, `Second queued physical line still sent after enabled ${kind} control changed the UI`);
    } finally { release(); await h.settle(); }
  }, document);
}
await test('Image queue must lock or honor deselection of not-yet-sent physical line', f => queuedChange(f, 'deselect'));
await test('Image queue must lock or honor removal of not-yet-sent physical line', f => queuedChange(f, 'remove'));
await test('PDF queue must lock or honor deselection of not-yet-sent physical line', f => queuedChange(f, 'deselect', true));
for (const pdf of [false,true]) await test(`${pdf?'PDF':'Image'} repeated confirmation callback cannot start overlapping batches`, async f => {
 let release;const gate=new Promise(r=>{release=r;});
 f.rpcBehavior=async(_p,count)=>{if(count===1)await gate;return {ok:true,json:async()=>({fixture:true})};};
 await withUI(f,async h=>{
  await h.upload();const handler=h.confirm().props.onClick;
  try {
   await act(async()=>{handler();handler();});await h.settle();
   assert.equal(f.rpc.length,1);release();await h.settle();
   assert.equal(f.rpc.length,2,'One confirmed two-line batch only');
  } finally {release();await h.settle();}
 },pdf);
});
await test('Captured image queued selection removal and edit handlers cannot change a frozen batch',async f=>{
 let release;const gate=new Promise(r=>{release=r;});
 f.rpcBehavior=async(_p,count)=>{if(count===1)await gate;return {ok:true,json:async()=>({fixture:true})};};
 await withUI(f,async h=>{
  await h.upload();
  const choose=h.buttons().find(b=>b.props['aria-label']==='Select line 2 for receiving').props.onClick;
  const remove=h.buttons().find(b=>b.props['aria-label']==='Remove draft line 2').props.onClick;
  const edit=h.renderer.root.findAllByType('input').find(n=>n.props.value==='TEST-B').props.onChange;
  try {
   await h.click(h.confirm());assert.equal(f.rpc.length,1);
   for(const label of ['Select line 2 for receiving','Remove draft line 2'])assert(h.buttons().find(b=>b.props['aria-label']===label).props.disabled);
   await act(async()=>{choose();remove();edit({target:{value:'TEST-A'}});});await h.settle();
   release();await h.settle();assert.equal(f.rpc.length,2);assert.equal(f.rpc[1].p_part_number,'TEST-B');assert.equal(f.rpc[1].p_qty,3);
  } finally {release();await h.settle();}
 });
});


await test('Recovered conflict exposes audited safe resolution and never performs RECEIVE while resolving', async f => {
  f.attempts.set('attempt-conflict', { attemptId: 'attempt-conflict', state: 'conflict', revision: 2, actor: 'fixture-server-actor',
    documentRef: 'CONFLICT-DOC', sourcePage: '1', sourceLineNo: 1, partNumber: 'TEST-A', qty: 2,
    correlationId: 'incoming:CONFLICT-DOC|1|1', batchId: 'CONFLICT-DOC', receipt: null });
  await withUI(f, async h => {
    await h.settle();
    const resolve = h.buttons().find(b => b.props['aria-label'] === 'Resolve persisted line 1');
    assert(resolve && !resolve.props.disabled, 'Recovered conflict has an explicit resolution control');
    await h.click(resolve);
    assert.equal(f.rpc.length, 0, 'Resolving a review conflict never runs inventory RECEIVE');
    assert.equal(f.attempts.get('attempt-conflict').state, 'abandoned');
    assert.equal(h.buttons().some(b => b.props['aria-label'] === 'Resolve persisted line 1'), false);
  });
});

await test('Recovered PDF conflict has the same fail-closed server resolution path', async f => {
  f.attempts.set('attempt-pdf-conflict', { attemptId: 'attempt-pdf-conflict', state: 'conflict', revision: 2, actor: 'fixture-server-actor',
    documentRef: 'PDF-CONFLICT-DOC', sourcePage: '2', sourceLineNo: 7, partNumber: 'TEST-A', qty: 1,
    correlationId: 'incoming:PDF-CONFLICT-DOC|2|7', batchId: 'PDF-CONFLICT-DOC', receipt: null });
  await withUI(f, async h => {
    await h.click(h.buttons().find(b => b.props['aria-label'] === 'Open Incoming Stock PDF packing-list intake'));
    await h.settle();
    const resolve = h.buttons().find(b => b.props['aria-label'] === 'Resolve persisted PDF line 7');
    assert(resolve && !resolve.props.disabled, 'Recovered PDF conflict has an explicit resolution control');
    await h.click(resolve);
    assert.equal(f.rpc.length, 0);
    assert.equal(f.attempts.get('attempt-pdf-conflict').state, 'abandoned');
  }, true);
});

await test('Persisted unknown image attempt survives remount and retries only the original correlation', async f => {
  f.rpcBehavior = async (_movement, count) => {
    if (count === 1) throw Error('Fixture lost acknowledgement before authoritative reply');
    return { ok: true, json: async () => ({ fixture: true, duplicate: false }) };
  };
  const actions = loader(f)('convex/incomingStockActions.ts');
  await assert.rejects(
    actions.commitConfirmedReceiveLine.handler({}, args({ documentRef: 'RECOVER-DOC', sourcePage: 'MANUAL', sourceLineNo: 1 })),
    /uncertain/i,
  );
  assert.equal(f.attempts.size, 1);
  const persisted = [...f.attempts.values()][0];
  assert.equal(persisted.state, 'unknown');
  const originalCorrelation = persisted.correlationId;

  await withUI(f, async h => {
    await h.settle();
    assert.equal(h.doc().props.value, 'RECOVER-DOC');
    await h.change(h.doc(), 'CHANGED-DOC');
    assert.equal(h.doc().props.value, 'RECOVER-DOC', 'Recovered uncertain receipt reference must stay frozen');
    assert.equal(f.rpc.length, 1);
    await h.click(h.confirm());
    assert.equal(f.rpc.length, 2);
    assert.equal(f.rpc[1].p_correlation_id, originalCorrelation, 'Remount retry must use the persisted correlation');
    assert.equal([...f.attempts.values()][0].state, 'accepted');
  });
});

await test('Partial batch remount acknowledges accepted lines and retries only the unresolved physical line', async f => {
  const actions = loader(f)('convex/incomingStockActions.ts');
  f.rpcBehavior = async movement => {
    if (movement.p_correlation_id === 'incoming:PARTIAL-DOC|1|2') throw Error('Fixture line 2 acknowledgement lost');
    return { ok: true, json: async () => ({ fixture: true, duplicate: false }) };
  };
  const first = await actions.commitConfirmedReceiveLine.handler({}, args({
    documentRef: 'PARTIAL-DOC', sourcePage: '1', sourceLineNo: 1, confirmationId: 'partial-1',
  }));
  await assert.rejects(actions.commitConfirmedReceiveLine.handler({}, args({
    documentRef: 'PARTIAL-DOC', sourcePage: '1', sourceLineNo: 2, confirmationId: 'partial-2',
  })), /uncertain/i);
  assert.equal(first.correlationId, 'incoming:PARTIAL-DOC|1|1');
  assert.equal(f.rpc.length, 2);
  const states = [...f.attempts.values()].map(a => [a.correlationId, a.state]);
  assert(states.some(([id, state]) => id === 'incoming:PARTIAL-DOC|1|1' && state === 'accepted'));
  assert(states.some(([id, state]) => id === 'incoming:PARTIAL-DOC|1|2' && state === 'unknown'));

  f.rpcBehavior = async () => ({ ok: true, json: async () => ({ fixture: true, duplicate: false }) });
  await withUI(f, async h => {
    await h.settle();
    assert(f.acknowledged.size >= 1, 'Recovered accepted line is acknowledged server-side');
    const confirm = h.confirm();
    assert(confirm && !confirm.props.disabled);
    await h.click(confirm);
    assert.equal(f.rpc.length, 3, 'Only the unresolved line is re-executed after remount');
    assert.equal(f.rpc[2].p_correlation_id, 'incoming:PARTIAL-DOC|1|2');
    assert.equal([...f.attempts.values()].filter(a => a.state === 'accepted').length, 2);
  });
});

const summary = { source_revision: 'Use the exact checked-out CI commit; no live endpoint tested',
  scope: 'Candidate TS/TSX executed with real React test renderer; synthetic auth, OCR and HTTP/RPC only; not database or browser/provider acceptance',
  counts: { total: results.length, passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length },
  results, production_writes: false, external_network: false };
// Synthetic traces stay in test memory; CI captures the explicit case output below.
console.log(JSON.stringify(summary.counts));
process.exitCode = summary.counts.failed ? 1 : 0;
