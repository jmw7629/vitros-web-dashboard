import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/lib/remOperationalUpload.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {}, Error, Number, Math };
vm.runInNewContext(compiled, context);
const upload = context.exports.uploadRemOperationalRecords;
const importId = '11111111-1111-4111-8111-111111111111';
const input = { fileHash: 'a'.repeat(64), planYear: 2026, records: Array.from({ length: 503 }, (_, i) => ({ sourceKey: `row-${i}` })) };
let stored = 0;
let next = 0;
let lostResponse = true;
const observed = [];
const receipt = () => ({ importId, planYear: 2026, expectedRows: 503, receivedRows: stored, nextBatchIndex: next, status: 'staging' });
const begin = async () => receipt();
const stage = async ({ importId: id, batchIndex, records }) => {
  assert.equal(id, importId);
  assert.equal(batchIndex, next);
  assert.equal(records[0].sourceKey, `row-${stored}`);
  observed.push(records.length);
  stored += records.length;
  next++;
  if (lostResponse) { lostResponse = false; throw new Error('network response lost after commit'); }
  return receipt();
};
await assert.rejects(upload(input, begin, stage, () => {}), /network response lost/);
assert.equal(stored, 250, 'one staged batch can commit before its response is lost');
const progress = [];
assert.equal(await upload(input, begin, stage, (received) => progress.push(received)), importId);
assert.deepEqual(observed, [250, 250, 3], 'resume skips only server-confirmed rows, with final partial batch');
assert.deepEqual(progress, [250, 500, 503]);
assert.equal(await upload(input, async () => ({ ...receipt(), status: 'applied' }), async () => { throw new Error('must not restage applied import'); }, () => {}), importId);
for (const invalid of [
  { ...receipt(), importId: 'wrong-id' },
  { ...receipt(), receivedRows: 249, nextBatchIndex: 1 },
  { ...receipt(), expectedRows: 504 },
  { ...receipt(), planYear: 2025 },
  { ...receipt(), receivedRows: 250, nextBatchIndex: 1, status: 'applied' },
]) await assert.rejects(upload(input, async () => invalid, stage, () => {}), /inconsistent/);
await assert.rejects(upload(input, async () => ({ ...receipt(), receivedRows: 0, nextBatchIndex: 0 }), async () => ({ ...receipt(), receivedRows: 0, nextBatchIndex: 0 }), () => {}), /not confirmed/);
await assert.rejects(upload({ ...input, records: [] }, begin, stage, () => {}), /No operational/);
let advances = 0;
const ahead = await upload(input, async () => ({ ...receipt(), receivedRows: 0, nextBatchIndex: 0 }), async ({ batchIndex }) => {
  advances++;
  return batchIndex === 0 ? { ...receipt(), receivedRows: 500, nextBatchIndex: 2 } : { ...receipt(), receivedRows: 503, nextBatchIndex: 3 };
}, () => {});
assert.equal(ahead, importId);
assert.equal(advances, 2, 'another tab may advance beyond the requested batch');
console.log('REM_OPERATIONAL_UPLOAD=PASS (lost-response recovery, bounded batches, receipt validation, completed replay)');
