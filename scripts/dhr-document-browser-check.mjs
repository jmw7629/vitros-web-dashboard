// Actual production client, queue and contract in Chromium's native IndexedDB.
// The loopback transport is synthetic fault injection, not a live backend test.
// Optional: DHR_BROWSER_EXECUTABLE_PATH, DHR_BROWSER_ARTIFACT_DIR and the
// standard PLAYWRIGHT_BROWSERS_PATH. No credentials or document mappings used.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const harness = fs.mkdtempSync(path.join(os.tmpdir(), "vitros-dhr-native-browser-"));
const artifacts = process.env.DHR_BROWSER_ARTIFACT_DIR ? path.resolve(process.env.DHR_BROWSER_ARTIFACT_DIR) : path.join(harness, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const report = { syntheticTransport: true, nativeIndexedDB: true, productionAuthUntouched: true, sourceHashes: {}, checks: [], pageErrors: [], consoleErrors: [], externalRequests: [] };
const modules = new Map();
for (const name of ["dhrDocumentClient", "dhrDocumentQueue", "dhrDocumentContract"]) {
  const source = fs.readFileSync(path.join(root, "src/lib", `${name}.ts`), "utf8");
  report.sourceHashes[name] = createHash("sha256").update(source).digest("hex");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  modules.set(`/${name}.js`, compiled.replace(/from "(\.\/dhrDocument\w+)"/g, 'from "$1.js"'));
}
const original = {
  eventId: randomUUID(), idempotencyKey: randomUUID(), documentInstanceId: randomUUID(), documentTemplateId: "synthetic-browser-contract",
  documentRevision: "SYNTHETIC", fieldId: "synthetic-consumable-field", fieldVersion: 1, sectionId: "synthetic-section",
  partNumber: "SYNTHETIC-CONTROLLED-PART", previousQuantity: 0, quantity: 2, instrumentSn: "SYNTHETIC-INSTRUMENT", occurredAt: "2026-09-13T12:00:00.000Z",
};
const stockId = randomUUID(); const requests = []; const receipts = new Map(); let stock = 100; let stockRefreshes = 0;
const entry = `
const originalOpen = IDBFactory.prototype.open;
let databaseOpens = 0;
IDBFactory.prototype.open = function(...args) { databaseOpens++; return originalOpen.apply(this, args); };
const { IndexedDbDhrPendingStore } = await import("/dhrDocumentQueue.js");
const { createDhrDocumentClient } = await import("/dhrDocumentClient.js");
const databaseName = "synthetic-native-browser-queue";
const scope = "synthetic-owner-a";
let currentScope = scope, enabled = false, transportCalls = 0, refreshes = 0;
const store = new IndexedDbDhrPendingStore(indexedDB, databaseName);
const observer = new IndexedDbDhrPendingStore(indexedDB, databaseName);
const refreshReceipts = [];
const transport = async (event) => {
  transportCalls++;
  const pending = await observer.pending(scope);
  const matching = pending.find(item => item.event.eventId === event.eventId);
  if (!matching || matching.status !== "sending" || matching.eventJson !== JSON.stringify(event)) throw new Error("Transport preceded durable exact-event persistence");
  const response = await fetch("/synthetic-consumption", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) });
  if (!response.ok) throw new Error("Synthetic lost response after server commit");
  return response.json();
};
const afterAcknowledged = async (receipt) => {
  const acknowledged = await observer.acknowledged(scope);
  if (!acknowledged.some(item => item.receipt.eventId === receipt.eventId)) throw new Error("Refresh preceded durable acknowledgment");
  const response = await fetch("/synthetic-stock?stockId=" + encodeURIComponent(receipt.stockId));
  if (!response.ok || (await response.json()).quantity !== receipt.stockAfter) throw new Error("Stock refresh did not match receipt target");
  refreshReceipts.push(receipt); refreshes++;
};
const client = createDhrDocumentClient({ store, scope, currentScope: () => currentScope, enabled: () => enabled, transport, afterAcknowledged });
window.dhrHarness = {
  client, store, original: ${JSON.stringify(original)},
  metrics: () => ({ databaseOpens, transportCalls, refreshes, refreshReceipts }),
  enable() { enabled = true; }, owner(value) { currentScope = value; },
  async otherOwnerPending() {
    const other = createDhrDocumentClient({ store, scope: "synthetic-owner-b", currentScope: () => currentScope, enabled: () => enabled, transport, afterAcknowledged });
    const pending = await other.pending(); const result = await other.flush(); return { pending: pending.length, result };
  },
};
document.getElementById("status").textContent = "Synthetic native IndexedDB harness ready";
`;
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Synthetic DHR native storage regression</title></head><body><p id="status">Loading synthetic harness</p><script type="module" src="/entry.js"></script></body></html>';
let server; let browser;
try {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "POST" && url.pathname === "/synthetic-consumption") {
        let body = ""; for await (const chunk of req) { body += chunk; if (body.length > 20_000) throw new Error("Synthetic request exceeded limit"); }
        const event = JSON.parse(body); requests.push(event);
        const prior = receipts.get(event.idempotencyKey);
        if (prior) {
          assert.equal(JSON.stringify(event), JSON.stringify(prior.event), "Retry changed the exact event");
          res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ...prior.receipt, duplicate: true })); return;
        }
        const delta = event.quantity - event.previousQuantity;
        const receipt = { ...event, woNumber: event.woNumber ?? null, status: delta > 0 ? "consumed" : delta < 0 ? "returned" : "unchanged", duplicate: false,
          delta, inventoryPartNumber: "SYNTHETIC-RESOLVED-STOCK-PART", stockId, stockBefore: stock, stockAfter: stock - delta,
          auditId: randomUUID(), sapStagingId: randomUUID(), correlationId: "digital-dhr:" + event.idempotencyKey,
          operatorId: "synthetic-server-operator", operatorInitials: "ZZ", actor: "Synthetic server actor", processedAt: "2026-09-13T12:01:00.000Z" };
        stock = receipt.stockAfter; receipts.set(event.idempotencyKey, { event, receipt });
        // Commit the synthetic stock effect, but intentionally provide no receipt.
        // An HTTP 200 with an unusable response models an uncertain transport
        // result without introducing expected console errors into this check.
        res.setHeader("Content-Type", "application/json"); res.end("synthetic response lost"); return;
      }
      if (req.method === "GET" && url.pathname === "/synthetic-stock") {
        assert.equal(url.searchParams.get("stockId"), stockId); stockRefreshes++;
        res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ quantity: stock })); return;
      }
      const body = url.pathname === "/" ? html : url.pathname === "/entry.js" ? entry : modules.get(url.pathname);
      if (body === undefined) { res.writeHead(404).end(); return; }
      res.setHeader("Content-Type", url.pathname === "/" ? "text/html" : "text/javascript"); res.end(body);
    } catch (error) { report.serverFailure = String(error); res.writeHead(500).end("Synthetic harness failure"); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DHR_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.DHR_BROWSER_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext(); const page = await context.newPage(); page.setDefaultTimeout(10_000);
  page.on("pageerror", error => report.pageErrors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
  await page.route("**/*", route => { if (route.request().url().startsWith(`${base}/`)) return route.continue(); report.externalRequests.push(route.request().url()); return route.abort(); });
  const ready = () => page.waitForFunction(() => Boolean(window.dhrHarness));
  await page.goto(base); await ready();
  const disabled = await page.evaluate(async () => {
    const h = window.dhrHarness; const before = h.metrics(); let commitCode, flushCode;
    try { await h.client.commit(h.original); } catch (error) { commitCode = error.code; }
    try { h.client.flush(); } catch (error) { flushCode = error.code; }
    return { before, after: h.metrics(), commitCode, flushCode, databases: (await indexedDB.databases()).length };
  });
  assert.equal(disabled.before.databaseOpens, 0); assert.equal(disabled.after.databaseOpens, 0); assert.equal(disabled.after.transportCalls, 0);
  assert.equal(disabled.commitCode, "disabled"); assert.equal(disabled.flushCode, "disabled"); assert.equal(disabled.databases, 0); assert.equal(requests.length, 0);
  report.checks.push("default-off import and construction open no database and invoke no transport");
  const first = await page.evaluate(async () => { const h = window.dhrHarness; h.enable(); const result = await h.client.commit(h.original); return { result, pending: await h.client.pending() }; });
  assert.equal(first.result.result.pending, 1); assert.equal(first.pending[0].failure.code, "unavailable"); assert.deepEqual(first.pending[0].event, original);
  assert.equal(stock, 98); assert.equal(requests.length, 1); report.checks.push("native IndexedDB exact pending event precedes synthetic transport and survives lost committed response");
  await page.reload(); await ready();
  const resumed = await page.evaluate(async () => { const h = window.dhrHarness; return { metrics: h.metrics(), pending: await h.client.pending() }; });
  assert.equal(resumed.metrics.transportCalls, 0); assert.equal(resumed.pending[0].eventJson, first.pending[0].eventJson);
  report.checks.push("actual page reload retains exact failed event without automatic replay");
  const retried = await page.evaluate(async () => { const h = window.dhrHarness; h.enable(); const result = await h.client.retry(h.original.eventId); await h.client.flush(); return { result, pending: await h.client.pending(), acknowledged: await h.client.acknowledged(), metrics: h.metrics() }; });
  assert.equal(retried.result.acknowledged, 1); assert.equal(retried.pending.length, 0); assert.equal(retried.acknowledged.length, 0); assert.equal(retried.metrics.refreshes, 1);
  assert.equal(retried.metrics.refreshReceipts[0].duplicate, true); assert.equal(retried.metrics.refreshReceipts[0].inventoryPartNumber, "SYNTHETIC-RESOLVED-STOCK-PART");
  assert.deepEqual(requests[0], requests[1]); assert.equal(requests.length, 2); assert.equal(stock, 98); assert.equal(stockRefreshes, 1);
  report.checks.push("same-key retry after reload receives duplicate receipt, refreshes resolved stock and prunes local notification");
  await page.reload(); await ready(); assert.equal(await page.evaluate(async () => (await window.dhrHarness.client.pending()).length), 0);
  const switched = await page.evaluate(async () => {
    const h = window.dhrHarness; h.enable(); const next = { ...h.original, eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), fieldId: "synthetic-other-field" };
    await h.client.enqueue(next); h.owner("synthetic-owner-b"); let flushCode, readCode;
    try { h.client.flush(); } catch (error) { flushCode = error.code; }
    try { await h.client.pending(); } catch (error) { readCode = error.code; }
    const other = await h.otherOwnerPending(); h.owner(null); let signoutCode;
    try { await h.client.commit(next); } catch (error) { signoutCode = error.code; }
    return { flushCode, readCode, signoutCode, other, originalPending: (await h.store.pending("synthetic-owner-a")).length, metrics: h.metrics() };
  });
  assert.equal(switched.flushCode, "identity_unavailable"); assert.equal(switched.readCode, "identity_unavailable"); assert.equal(switched.signoutCode, "identity_unavailable");
  assert.equal(switched.other.pending, 0); assert.equal(switched.other.result.acknowledged, 0); assert.equal(switched.originalPending, 1); assert.equal(switched.metrics.transportCalls, 0); assert.equal(requests.length, 2);
  report.checks.push("account change and sign-out stop the old client; new owner cannot transmit old queue");
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.externalRequests, []); assert.equal(report.serverFailure, undefined);
  await page.evaluate(checks => {
    document.getElementById("status").textContent = "PASS: synthetic DHR native IndexedDB regression";
    const list = document.createElement("ul");
    for (const check of checks) { const item = document.createElement("li"); item.textContent = check; list.append(item); }
    document.body.append(list);
  }, report.checks);
  await page.screenshot({ path: path.join(artifacts, "native-indexeddb-check.png"), fullPage: true });
  report.browserVersion = browser.version(); report.passed = true; report.syntheticRequests = requests.length; report.syntheticStockMutations = receipts.size;
  console.log(`DIGITAL_DHR_NATIVE_BROWSER=PASS checks=${report.checks.length} (synthetic transport; live backend acceptance remains separate)`);
} catch (error) { report.passed = false; report.failure = error instanceof Error ? error.stack : String(error); console.error(report.failure); process.exitCode = 1; }
finally {
  await browser?.close(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2)); console.log(`DHR_BROWSER_ARTIFACTS=${artifacts}`);
}
