// Runs the actual production IndexedDB store and client against fake-indexeddb.
// All field/template identities below are synthetic; no controlled mapping is seeded.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { randomUUID, webcrypto } from "node:crypto";
import ts from "typescript";
import { IDBFactory } from "fake-indexeddb";

const context = vm.createContext({ console, crypto: webcrypto, structuredClone });
const modules = new Map();
function load(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context);
  run((name) => { if (!name.startsWith(".")) throw new Error(`Unexpected dependency ${name}`); return load(path.resolve(path.dirname(file), `${name}.ts`)); }, module, module.exports);
  return module.exports;
}
const { IndexedDbDhrPendingStore, DhrClientError, MAX_DHR_OUTSTANDING_EVENTS } = load("src/lib/dhrDocumentQueue.ts");
const { createDhrDocumentClient } = load("src/lib/dhrDocumentClient.ts");
const { validateDigitalDhrReceipt } = load("src/lib/dhrDocumentContract.ts");
const doc = "00000000-0000-4000-8000-000000000073";
const scope = "synthetic-authenticated-user";
const event = (overrides = {}) => ({
  eventId: randomUUID(), idempotencyKey: randomUUID(), documentInstanceId: doc,
  documentTemplateId: "synthetic-contract-test", documentRevision: "SYNTHETIC",
  fieldId: "synthetic-consumable-field", fieldVersion: 1, sectionId: "synthetic-section",
  partNumber: "SYNTHETIC-PART", previousQuantity: 0, quantity: 2,
  instrumentSn: "SYNTHETIC-INSTRUMENT", occurredAt: "2026-09-13T12:00:00.000Z", ...overrides,
});
const receipt = (e, before = 100, duplicate = false) => {
  const delta = e.quantity - e.previousQuantity;
  return { ...e, woNumber: e.woNumber ?? null, status: delta > 0 ? "consumed" : delta < 0 ? "returned" : "unchanged", duplicate,
    delta, inventoryPartNumber: e.partNumber, stockId: "00000000-0000-4000-8000-000000000075", stockBefore: before, stockAfter: before - delta, auditId: delta ? randomUUID() : null,
    sapStagingId: delta ? randomUUID() : null, correlationId: `digital-dhr:${e.idempotencyKey}`, operatorId: "synthetic-operator",
    operatorInitials: "ZZ", actor: "Synthetic server actor", processedAt: "2026-09-13T12:01:00.000Z" };
};
const documentState = (e, fieldVersion, quantity, conflict = false) => ({
  documentInstanceId: e.documentInstanceId, sessionId: "00000000-0000-4000-8000-000000000074",
  documentTemplateId: e.documentTemplateId, documentRevision: e.documentRevision, instrumentSn: e.instrumentSn,
  woNumber: e.woNumber ?? null, status: "in_progress",
  manifest: { schemaVersion: 1, templateId: e.documentTemplateId, documentRevision: e.documentRevision,
    analyzerModel: "SYNTHETIC", artifactSha256: "a".repeat(64), bindings: [{ fieldId: e.fieldId, sectionId: e.sectionId,
      partNumber: e.partNumber, kind: "consumable_part", quantityMode: "integer" }] },
  fields: [{ fieldId: e.fieldId, fieldVersion, quantity, conflict }],
});
function server() {
  const receipts = new Map(); const fields = new Map(); const calls = []; let stock = 100;
  return {
    calls, fields, get stock() { return stock; },
    async accept(e) {
      calls.push(structuredClone(e));
      if (receipts.has(e.idempotencyKey)) return { ...receipts.get(e.idempotencyKey), duplicate: true };
      const field = fields.get(e.fieldId) ?? { version: 0, quantity: 0 };
      if (e.fieldVersion !== field.version + 1 || e.previousQuantity !== field.quantity) throw { data: { code: "conflict", message: "Private server details must not reach the UI" } };
      const result = receipt(e, stock); validateDigitalDhrReceipt(result);
      stock = result.stockAfter; fields.set(e.fieldId, { version: e.fieldVersion, quantity: e.quantity });
      receipts.set(e.idempotencyKey, result); return result;
    },
  };
}
function fixture(overrides = {}) {
  const factory = new IDBFactory(); const databaseName = randomUUID(); const transport = server(); let time = 1_000;
  const stores = [];
  const store = () => { const value = new IndexedDbDhrPendingStore(factory, databaseName); stores.push(value); return value; };
  const make = (changes = {}) => createDhrDocumentClient({ store: store(), scope, currentScope: () => changes.scope ?? overrides.scope ?? scope, transport: (e) => transport.accept(e), afterAcknowledged: async () => {}, enabled: () => true, now: () => time, ...overrides, ...changes });
  return { factory, databaseName, transport, store, make, advance: (ms) => { time += ms; }, now: () => time, close: async () => { for (const value of stores) await value.close(); } };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`); }

await test("default OFF and construction have no transport or database side effects", async () => {
  let opens = 0, calls = 0;
  const store = new IndexedDbDhrPendingStore({ open() { opens++; throw new Error("must not open"); } });
  const client = createDhrDocumentClient({ store, scope, currentScope: () => scope, transport: async () => { calls++; }, afterAcknowledged: async () => {} });
  assert.equal(opens, 0); assert.equal(calls, 0);
  await assert.rejects(client.enqueue(event()), (error) => error.code === "disabled");
  assert.throws(() => client.flush(), (error) => error.code === "disabled"); assert.equal(opens, 0); assert.equal(calls, 0);
});
await test("transport starts only after exact event is durably readable by another connection", async () => {
  const f = fixture(); const observer = f.store(); const original = event();
  let refreshed = false;
  const client = f.make({ afterAcknowledged: async (ack) => { assert.equal((await observer.acknowledged(scope))[0].receipt.eventId, ack.eventId); refreshed = true; }, transport: async (e) => {
    const pending = await observer.pending(scope); assert.equal(pending.length, 1);
    assert.equal(pending[0].eventJson, JSON.stringify(e)); assert.equal(pending[0].status, "sending"); return f.transport.accept(e);
  } });
  await client.commit(original); assert.equal((await observer.pending(scope)).length, 0);
  assert(refreshed); assert.equal((await observer.acknowledged(scope)).length, 0, "local receipt notification pruned only after successful refresh"); await f.close();
});
await test("queued payload survives restart and later mutation of caller object", async () => {
  const f = fixture(); const original = event(); const expected = structuredClone(original); const store = f.store();
  const client = f.make({ store }); await client.enqueue(original); original.quantity = 77; original.fieldId = "changed-by-caller";
  await store.close(); const resumed = f.make(); const pending = await resumed.pending();
  assert.deepEqual(JSON.parse(pending[0].eventJson), expected); await resumed.flush();
  assert.deepEqual(f.transport.calls[0], expected); assert.equal(f.transport.stock, 98); await f.close();
});
await test("IndexedDB version-one upgrade preserves the exact pending event and adds conflict evidence storage", async () => {
  const original = event(); const source = fixture(); await source.make().enqueue(original); const record = (await source.store().pending(scope))[0]; await source.close();
  const factory = new IDBFactory(); const name = randomUUID();
  const legacy = await new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      for (const storeName of ["pending", "acknowledged"]) {
        const store = request.result.createObjectStore(storeName, { keyPath: "key" });
        store.createIndex("scope", "scope"); store.createIndex("revision", "revisionKey", { unique: true }); store.createIndex("request", "requestKey", { unique: true });
      }
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => { const tx = legacy.transaction("pending", "readwrite"); tx.objectStore("pending").add(record); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); legacy.close();
  const store = new IndexedDbDhrPendingStore(factory, name); const accepted = server();
  const client = createDhrDocumentClient({ store, scope, currentScope: () => scope, enabled: () => true, transport: (e) => accepted.accept(e), afterAcknowledged: async () => {} });
  assert.equal((await client.pending())[0].eventJson, record.eventJson); assert.equal((await client.resolutions()).length, 0);
  await client.flush(); assert.deepEqual(accepted.calls[0], original); assert.equal((await client.pending()).length, 0); await store.close();
});
await test("lost successful response retries same payload and key after restart without duplicate stock", async () => {
  const f = fixture(); const original = event(); const store = f.store();
  const client = f.make({ store, transport: async (e) => { await f.transport.accept(e); throw new Error("connection lost after commit"); } });
  const first = await client.commit(original); assert.equal(first.result.pending, 1); assert.equal(f.transport.stock, 98);
  const pending = (await client.pending())[0]; assert.equal(pending.failure.code, "unavailable");
  let replayReceipt;
  await store.close(); f.advance(1_001); const resumed = f.make({ afterAcknowledged: async (value) => { replayReceipt = value; } }); await resumed.flush();
  assert.equal(f.transport.calls.length, 2); assert.deepEqual(f.transport.calls[0], f.transport.calls[1]);
  assert.equal(f.transport.stock, 98); assert.equal((await resumed.pending()).length, 0);
  assert.equal(replayReceipt.duplicate, true); await f.close();
});
await test("separate committed edits preserve ordered delta semantics including return and zero", async () => {
  const f = fixture(); const received = []; const client = f.make({ afterAcknowledged: async (value) => { received.push(value); } });
  for (const [version, previous, quantity] of [[1, 0, 2], [2, 2, 3], [3, 3, 1], [4, 1, 1]]) await client.enqueue(event({ fieldVersion: version, previousQuantity: previous, quantity }));
  const result = await client.flush(); assert.equal(result.acknowledged, 4); assert.equal(f.transport.stock, 99);
  assert.deepEqual(f.transport.calls.map((e) => e.quantity - e.previousQuantity), [2, 1, -2, 0]);
  assert.equal(received.length, 4); assert.equal((await client.acknowledged()).length, 0); await f.close();
});
await test("same field version or idempotency key cannot be overwritten by a different committed edit", async () => {
  const f = fixture(); const a = f.make(); const b = f.make(); const e = event();
  const results = await Promise.allSettled([a.enqueue(e), b.enqueue(event({ quantity: 3 }))]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); assert.equal(results.filter((r) => r.status === "rejected" && r.reason.code === "local_conflict").length, 1);
  const pending = await a.pending(); assert.equal(pending.length, 1); const winner = pending[0].event;
  await assert.rejects(b.enqueue({ ...winner, quantity: 55 }), (error) => error.code === "local_conflict");
  await assert.rejects(b.enqueue(event({ fieldId: "other-field", idempotencyKey: winner.idempotencyKey })), (error) => error.code === "local_conflict");
  await a.flush(); const stock = f.transport.stock;
  await b.enqueue(event({ quantity: 4 })); assert.equal((await b.flush()).conflicts, 1); assert.equal(f.transport.stock, stock, "server remains authoritative after local receipt pruning"); await f.close();
});
await test("single-flight and cross-tab lease prevent concurrent field version submission", async () => {
  const f = fixture(); let release; const gate = new Promise((resolve) => { release = resolve; }); let entered; const started = new Promise((resolve) => { entered = resolve; });
  const a = f.make({ transport: async (e) => { entered(); await gate; return f.transport.accept(e); } }); const b = f.make();
  await a.enqueue(event()); await a.enqueue(event({ fieldVersion: 2, previousQuantity: 2, quantity: 3 }));
  const first = a.flush(); assert.equal(a.flush(), first); await started;
  const concurrent = await b.flush(); assert.equal(concurrent.acknowledged, 0); assert.equal(f.transport.calls.length, 0);
  release(); await first; assert.deepEqual(f.transport.calls.map((e) => e.fieldVersion), [1, 2]); await f.close();
});
await test("an abandoned cross-tab lease recovers only after expiry", async () => {
  const f = fixture(); const store = f.store(); const client = f.make({ store }); await client.enqueue(event());
  await store.claim(scope, "dead-tab", f.now(), 1_000); await store.close(); const resumed = f.make();
  assert.equal((await resumed.flush()).acknowledged, 0); assert.equal(f.transport.calls.length, 0);
  f.advance(1_001); assert.equal((await resumed.flush()).acknowledged, 1); assert.equal(f.transport.stock, 98); await f.close();
});
await test("typed conflicts pause the field and retain successors while another field can sync", async () => {
  const f = fixture(); f.transport.fields.set("synthetic-consumable-field", { version: 2, quantity: 3 }); const client = f.make();
  await client.enqueue(event()); await client.enqueue(event({ fieldVersion: 2, previousQuantity: 2, quantity: 3 }));
  await client.enqueue(event({ fieldId: "independent-synthetic-field" })); const result = await client.flush();
  assert.equal(result.conflicts, 1); assert.equal(result.pending, 2); assert.equal(result.acknowledged, 1);
  assert.equal(f.transport.calls.filter((e) => e.fieldId === "synthetic-consumable-field").length, 1);
  const failed = (await client.pending()).find((e) => e.status === "conflict"); assert.equal(failed.event.quantity, 2);
  assert(!failed.failure.message.includes("Private server details")); await f.close();
});
await test("two owners racing version one can explicitly review accepted state and commit version two", async () => {
  const f = fixture(); const winner = f.make({ scope: "winner" }); const losingEvent = event({ quantity: 3 }); const store = f.store(); let reads = 0;
  const loser = f.make({ scope: "loser", store, getDocumentState: async () => { reads++; const field = f.transport.fields.get(losingEvent.fieldId); return documentState(losingEvent, field.version, field.quantity); } });
  await winner.commit(event()); assert.equal((await loser.commit(losingEvent)).result.conflicts, 1);
  const review = await loser.reviewConflict(losingEvent.eventId); assert.equal(review.event.quantity, 3); assert.equal(review.evidence.acceptedQuantity, 2);
  assert.equal((await loser.pending()).length, 1, "review alone preserves the original edit");
  review.event.quantity = 99; review.evidence.acceptedQuantity = 99;
  const resolved = await loser.resolveConflict(review.reviewId); assert.equal(reads, 2); assert.equal(resolved.event.quantity, 3); assert.equal(resolved.evidence.acceptedQuantity, 2);
  assert.equal((await loser.pending()).length, 0); assert.equal(f.transport.stock, 98); assert.equal(f.transport.calls.length, 2, "resolution does not send an inventory event");
  await assert.rejects(loser.enqueue(losingEvent), (error) => error.code === "local_conflict");
  await store.close(); const resumed = f.make({ scope: "loser" }); const evidence = await resumed.resolutions(); assert.equal(evidence[0].event.eventId, losingEvent.eventId);
  assert.equal((await resumed.commit(event({ fieldVersion: 2, previousQuantity: 2, quantity: 3 }))).result.acknowledged, 1);
  assert.equal(f.transport.stock, 97); assert.equal((await winner.resolutions()).length, 0); await f.close();
});
await test("uncertain accepted events cannot be retired even when accepted server version is current", async () => {
  const f = fixture(); const e = event(); let reads = 0;
  const client = f.make({ transport: async (value) => { await f.transport.accept(value); throw new Error("lost reply"); }, getDocumentState: async () => { reads++; return documentState(e, 1, 2); } });
  await client.commit(e); await assert.rejects(client.reviewConflict(e.eventId), (error) => error.code === "local_conflict");
  assert.equal(reads, 0); assert.equal((await client.pending())[0].event.eventId, e.eventId); assert.equal((await client.resolutions()).length, 0); await f.close();
});
await test("manual aggregate conflict behind the submitted version requires server reconciliation", async () => {
  const f = fixture(); const e = event(); const client = f.make({ transport: async () => { throw { data: { code: "conflict" } }; }, getDocumentState: async () => documentState(e, 0, 0, true) });
  await client.commit(e); await assert.rejects(client.reviewConflict(e.eventId), (error) => error.code === "conflict");
  assert.equal((await client.pending()).length, 1); assert.equal((await client.resolutions()).length, 0); await f.close();
});
await test("changed proof requires another review and cannot retire a different document or binding", async () => {
  const f = fixture(); const e = event(); let state = documentState(e, 1, 2);
  const client = f.make({ transport: async () => { throw { data: { code: "conflict" } }; }, getDocumentState: async () => structuredClone(state) });
  await client.commit(e); const first = await client.reviewConflict(e.eventId); state.fields[0].fieldVersion = 2; state.fields[0].quantity = 4;
  await assert.rejects(client.resolveConflict(first.reviewId), (error) => error.code === "conflict");
  assert.equal((await client.pending()).length, 1);
  state = documentState(e, 1, 2); state.instrumentSn = "OTHER-SYNTHETIC-INSTRUMENT";
  await assert.rejects(client.reviewConflict(e.eventId), (error) => error.code === "protocol");
  state = documentState(e, 1, 2); state.manifest.bindings[0].partNumber = "OTHER-SYNTHETIC-PART";
  await assert.rejects(client.reviewConflict(e.eventId), (error) => error.code === "protocol");
  assert.equal((await client.pending()).length, 1); assert.equal((await client.resolutions()).length, 0); await f.close();
});
await test("every displayed conflict evidence component must remain unchanged at resolution", async () => {
  for (const mutate of [
    (state) => { state.sessionId = randomUUID(); }, (state) => { state.manifest.artifactSha256 = "b".repeat(64); },
    (state) => { state.fields[0].fieldVersion = 2; }, (state) => { state.fields[0].quantity = 5; },
    (state) => { state.fields[0].conflict = true; }, (state) => { state.manifest.bindings[0].kind = "tool"; },
  ]) {
    const f = fixture(); const e = event(); const state = documentState(e, 1, 2);
    const client = f.make({ transport: async () => { throw { data: { code: "conflict" } }; }, getDocumentState: async () => structuredClone(state) });
    await client.commit(e); const review = await client.reviewConflict(e.eventId); mutate(state);
    await assert.rejects(client.resolveConflict(review.reviewId), (error) => error.code === "conflict");
    assert.equal((await client.pending()).length, 1); assert.equal((await client.resolutions()).length, 0); await f.close();
  }
});
await test("a concurrent retry invalidates retirement without deleting its pending event", async () => {
  const f = fixture(); const e = event(); const store = f.store(); const client = f.make({ store, transport: async () => { throw { data: { code: "conflict" } }; }, getDocumentState: async () => documentState(e, 1, 2) });
  await client.commit(e); const review = await client.reviewConflict(e.eventId); await store.retry(scope, e.eventId, f.now());
  await assert.rejects(client.resolveConflict(review.reviewId), (error) => error.code === "local_conflict");
  assert.equal((await client.pending())[0].status, "pending"); assert.equal((await client.resolutions()).length, 0); await f.close();
});
await test("mismatched receipts retain the event and explicit retry sends it unchanged", async () => {
  const f = fixture(); let wrong = true; const original = event();
  const client = f.make({ transport: async (e) => { const accepted = await f.transport.accept(e); return wrong ? { ...accepted, fieldId: "incorrect-field" } : accepted; } });
  const first = await client.commit(original); assert.equal(first.result.failed, 1); assert.equal((await client.pending())[0].failure.code, "protocol");
  wrong = false; await client.retry(original.eventId); assert.equal((await client.pending()).length, 0);
  assert.deepEqual(f.transport.calls[0], f.transport.calls[1]); assert.equal(f.transport.stock, 98); await f.close();
});
await test("every receipt identity component must match before pending removal", async () => {
  const f = fixture();
  for (const property of ["eventId", "idempotencyKey", "documentInstanceId", "documentTemplateId", "documentRevision", "fieldId", "sectionId", "partNumber", "instrumentSn", "occurredAt", "woNumber"]) {
    const original = event({ fieldId: `synthetic-${property}` });
    const client = f.make({ transport: async (e) => ({ ...receipt(e), [property]: property.endsWith("Id") && ["eventId", "documentInstanceId"].includes(property) || property === "idempotencyKey" ? randomUUID() : property === "occurredAt" ? "2026-09-13T13:00:00.000Z" : "OTHER" }) });
    const result = await client.commit(original); assert.equal(result.result.acknowledged, 0, property);
    assert((await client.pending()).some((pending) => pending.event.eventId === original.eventId), property);
  }
  await f.close();
});
await test("durable storage failure prevents transport and receipt-store failure retains exact retry", async () => {
  const store = new IndexedDbDhrPendingStore(undefined); let calls = 0;
  const disabledStorage = createDhrDocumentClient({ store, scope, currentScope: () => scope, enabled: () => true, transport: async () => { calls++; }, afterAcknowledged: async () => {} });
  await assert.rejects(disabledStorage.commit(event()), (error) => error.code === "storage"); assert.equal(calls, 0);
  const f = fixture(); const working = f.store(); const acknowledge = working.acknowledge.bind(working);
  working.acknowledge = async () => { throw new DhrClientError("storage", "Synthetic receipt persistence failure"); };
  const client = f.make({ store: working }); const original = event(); await client.commit(original);
  assert.equal((await client.pending())[0].failure.code, "storage"); assert.equal(f.transport.stock, 98);
  working.acknowledge = acknowledge; f.advance(1_001); await client.flush(); assert.equal(f.transport.stock, 98);
  assert.deepEqual(f.transport.calls[0], f.transport.calls[1]); assert.equal((await client.pending()).length, 0); await f.close();
});
await test("stock refresh is durably retried after restart without replaying consumption", async () => {
  const f = fixture(); const store = f.store(); let refreshes = 0;
  const client = f.make({ store, afterAcknowledged: async () => { throw new Error("refresh unavailable"); } });
  const original = event(); const first = await client.commit(original); assert.equal(first.result.refreshPending, 1); assert.equal(first.result.pending, 0);
  await store.close(); const resumed = f.make({ afterAcknowledged: async (r) => { refreshes++; assert.equal(r.eventId, original.eventId); } });
  const second = await resumed.flush(); assert.equal(second.refreshPending, 0); assert.equal(refreshes, 1); assert.equal(f.transport.calls.length, 1); await f.close();
});
await test("pending events are isolated to the current account scope", async () => {
  const f = fixture(); const a = f.make(); await a.enqueue(event()); const b = f.make({ scope: "another-synthetic-account" });
  assert.equal((await b.pending()).length, 0); assert.equal((await b.acknowledged()).length, 0);
  assert.equal((await b.flush()).acknowledged, 0); assert.equal(f.transport.calls.length, 0); assert.equal((await a.pending()).length, 1); await f.close();
});
await test("an old client cannot transmit or read its queue after sign-out or account switch", async () => {
  const f = fixture(); let current = scope; const store = f.store(); const client = f.make({ store, currentScope: () => current }); await client.enqueue(event());
  current = null; assert.throws(() => client.flush(), (error) => error.code === "identity_unavailable");
  assert.throws(() => client.pending(), (error) => error.code === "identity_unavailable");
  current = "another-owner"; await assert.rejects(client.commit(event()), (error) => error.code === "identity_unavailable");
  assert.equal(f.transport.calls.length, 0); assert.equal((await store.pending(scope)).length, 1);
  current = scope; await client.flush(); assert.equal(f.transport.stock, 98); await f.close();
});
await test("account switch during an uncertain transport retains original owner event", async () => {
  const f = fixture(); let current = scope; const store = f.store();
  const client = f.make({ store, currentScope: () => current, transport: async (e) => { const result = await f.transport.accept(e); current = "another-owner"; return result; } });
  await assert.rejects(client.commit(event()), (error) => error.code === "identity_unavailable");
  assert.equal((await store.pending(scope)).length, 1); assert.equal((await store.acknowledged(scope)).length, 0); assert.equal(f.transport.stock, 98); await f.close();
});
await test("outstanding capacity is bounded and pending events are never evicted", async () => {
  const f = fixture(); const store = f.store(); const client = f.make({ store });
  for (let index = 0; index < MAX_DHR_OUTSTANDING_EVENTS; index++) await client.enqueue(event({ fieldVersion: index + 1 }));
  const overflow = event({ fieldVersion: MAX_DHR_OUTSTANDING_EVENTS + 1 });
  await assert.rejects(client.enqueue(overflow), (error) => error.code === "storage");
  const before = await client.pending(); assert.equal(before.length, MAX_DHR_OUTSTANDING_EVENTS);
  const first = await store.claim(scope, "test-ack", f.now(), 1_000); await store.acknowledge(first, receipt(first.event));
  await assert.rejects(client.enqueue(overflow), (error) => error.code === "storage", "unrefreshed receipt still occupies durable capacity");
  await store.markRefreshed(scope, first.event.eventId); await client.enqueue(overflow);
  const after = await client.pending(); assert.equal(after.length, MAX_DHR_OUTSTANDING_EVENTS);
  assert(before.filter((pending) => pending.event.eventId !== first.event.eventId).every((pending) => after.some((item) => item.event.eventId === pending.event.eventId))); await f.close();
});
await test("definite server rejections pause exact events instead of auto-retrying", async () => {
  const f = fixture();
  for (const code of ["not_found", "validation", "insufficient_stock", "identity_unavailable", "disabled"]) {
    let calls = 0; const client = f.make({ transport: async () => { calls++; throw { data: { code } }; } });
    const e = event({ fieldId: `synthetic-${code}` }); await client.commit(e); f.advance(100_000); await client.flush();
    assert.equal(calls, 1); const pending = (await client.pending()).find((item) => item.event.eventId === e.eventId);
    assert.equal(pending.status, "failed"); assert.equal(pending.failure.code, code); assert.equal(pending.event.quantity, 2);
  }
  await f.close();
});
await test("ignored tool receipt preserves field edit with no claimed inventory delta", async () => {
  const f = fixture(); let delivered;
  const client = f.make({ transport: async (e) => ({ ...receipt(e), status: "ignored", delta: 0, inventoryPartNumber: null, stockId: null, stockBefore: null, stockAfter: null, auditId: null, sapStagingId: null }), afterAcknowledged: async (r) => { delivered = r; } });
  const result = await client.commit(event()); assert.equal(result.result.acknowledged, 1);
  assert.equal(delivered.delta, 0); assert.equal(delivered.quantity, 2); assert.equal(f.transport.stock, 100); await f.close();
});
await test("invalid quantities never enter durable queue or invoke transport", async () => {
  const f = fixture(); const client = f.make();
  for (const quantity of [-1, 1.5, NaN, Infinity]) await assert.rejects(client.enqueue(event({ quantity })));
  assert.equal((await client.pending()).length, 0); assert.equal(f.transport.calls.length, 0); await f.close();
});
console.log(`DIGITAL_DHR_DURABLE_CLIENT=PASS checks=${passed}`);
