// DISPOSABLE DATABASE ONLY. Two contending connections plus a lock observer.
// CI installs pg@8.16.3 outside the app; NODE_PATH selects that test-only client.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

assert.equal(process.env.VITROS_DISPOSABLE_DATABASE, '1');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.PGHOST));
assert.match(process.env.PGDATABASE || '', /test/i);
const connections = [new Client(), new Client(), new Client()];
const [dhr, count, observer] = connections;
const settle = promise => promise.then(value => ({ value }), error => ({ error }));
async function waitBlocked(pid, blocker) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query('select $2::int=any(pg_blocking_pids($1)) as blocked', [pid, blocker]);
    if (rows[0].blocked) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected lock interleaving was not reached');
}
async function confirm(client, request, correlation) {
  return client.query("select public.apply_cycle_count_operation('confirm',$1::jsonb,'lock-fixture',$2::uuid) as receipt", [request, correlation]);
}
async function fixture() {
  const id = randomUUID();
  await observer.query("insert into public.dhr_scan_sessions(id,instrument_sn,analyzer_model,status) values($1,$2,'5600','in_progress')", [id, `LOCK-${id}`]);
  const { rows: [stock] } = await observer.query("insert into public.stock(part_number,description,qty_on_hand) values($1,'Lock fixture',10) returning *", [`LOCK-${id}`]);
  const { rows: [schedule] } = await observer.query("select public.apply_cycle_count_operation('createSchedule',$1::jsonb,'lock-fixture',$2::uuid) as receipt", [{ name: 'Lock fixture', frequency: 'Single', startDate: 1, parts: [stock.part_number] }, randomUUID()]);
  const { rows: [session] } = await observer.query("select public.apply_cycle_count_operation('start',$1::jsonb,'lock-fixture',$2::uuid) as receipt", [{ id: schedule.receipt.id, scopeMode: 'standard' }, randomUUID()]);
  const { rows: [{ snapshot }] } = await observer.query('select public.read_cycle_count_wip() as snapshot');
  const part = snapshot.parts.find(p => p.partNumber === stock.part_number);
  return { id, stock, request: { sessionId: session.receipt.sessionId, expectedRevision: 0, sortMode: 'alpha', adjustmentBasis: 'counted', wipFingerprint: snapshot.fingerprint, lines: [{ partNumber: stock.part_number, countedQty: 8, incomingQty: 0, stockToken: part.stockToken }] } };
}
async function lifecycle(id) {
  return dhr.query("select public.apply_dhr_session_lifecycle($1,'completed','lock-fixture',$2,0) as receipt", [id, randomUUID()]);
}
async function main() {
  await Promise.all(connections.map(c => c.connect()));
  await Promise.all(connections.map(c => c.query("set statement_timeout='8s'; set deadlock_timeout='100ms'")));
  const dhrPid = (await dhr.query('select pg_backend_pid() as pid')).rows[0].pid;
  const countPid = (await count.query('select pg_backend_pid() as pid')).rows[0].pid;

  // Stop the lifecycle transaction at its real FOR UPDATE -> UPDATE boundary.
  // The extra row lock is exactly the lock acquired by the production function.
  const first = await fixture();
  await dhr.query('begin');
  await dhr.query('select id from public.dhr_scan_sessions where id=$1 for update', [first.id]);
  const pendingCount = settle(confirm(count, first.request, randomUUID()));
  await waitBlocked(countPid, dhrPid);
  const transitioned = await settle(lifecycle(first.id));
  if (transitioned.error) {
    await dhr.query('rollback');
    await pendingCount;
    throw transitioned.error;
  }
  await dhr.query('commit');
  const rejected = await pendingCount;
  assert.equal(rejected.error?.code, 'P0001', 'count must reject stale WIP, not deadlock');
  assert.match(rejected.error.message, /^DHR WIP changed/);
  assert.equal((await observer.query('select qty_on_hand from public.stock where id=$1', [first.stock.id])).rows[0].qty_on_hand, 10);
  assert.equal((await observer.query('select revision from public.cycle_count_sessions where id=$1', [first.request.sessionId])).rows[0].revision, 0);

  // Reverse arrival order: count owns its DHR snapshot until atomic commit.
  const second = await fixture();
  const correlation = randomUUID();
  await count.query('begin');
  const result = await confirm(count, second.request, correlation);
  assert.equal(result.rows[0].receipt.status, 'completed');
  const pendingDhr = settle(lifecycle(second.id));
  await waitBlocked(dhrPid, countPid);
  // EXCLUSIVE must keep ordinary dashboard SELECT readers available.
  assert.equal((await observer.query('select status from public.dhr_scan_sessions where id=$1', [second.id])).rows[0].status, 'in_progress');
  await count.query('commit');
  const completed = await pendingDhr;
  if (completed.error) throw completed.error;
  assert.equal(completed.value.rows[0].receipt.to_status, 'completed');
  assert.equal((await observer.query('select qty_on_hand from public.stock where id=$1', [second.stock.id])).rows[0].qty_on_hand, 8);
  assert.equal((await confirm(count, second.request, correlation)).rows[0].receipt.duplicate, true);
  const movement = `cycle-count:${second.request.sessionId}:${second.stock.id}`;
  for (const table of ['audit_log', 'sap_staging']) {
    assert.equal((await observer.query(`select count(*)::int as n from public.${table} where correlation_id=$1`, [movement])).rows[0].n, 1);
  }
  assert.equal((await observer.query('select export_status from public.sap_staging where correlation_id=$1', [movement])).rows[0].export_status, 'pending');
  console.log('CYCLE_COUNT_CONCURRENCY=PASS: both lock orders, stale WIP rollback, concurrent readers, atomic adjustment and replay');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.allSettled(connections.map(c => c.query('rollback')));
  await Promise.allSettled(connections.map(c => c.end()));
});
