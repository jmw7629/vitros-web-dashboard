#!/usr/bin/env node
// enterprise-upload-flow-check.mjs — end-to-end enterprise upload action pipeline
// Loads the REAL production .ts modules through transpile+vm (same mechanism as
// enterprise-upload-check.mjs), then drives the begin -> attach -> queue ->
// process -> finish -> publish -> dataset flow against a Convex-like fixture db.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// ---------------------------------------------------------------
// Loader: execute actual production .ts via transpile + vm sandbox
// ---------------------------------------------------------------
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cRequire = createRequire(import.meta.url);
const modules = new Map();

const refs = new Proxy(
  {},
  { get: (_, mod) => new Proxy({}, { get: (_, fn) => String(mod) + ":" + String(fn) }) }
);
const register = (definition) => definition;
const framework = {
  query: register,
  mutation: register,
  internalQuery: register,
  internalMutation: register,
  action: register,
  internalAction: register,
};
const validators = new Proxy(
  {},
  { get: (_, name) => (...args) => ({ kind: name, args }) }
);

function loadReal(name) {
  if (modules.has(name)) return modules.get(name);
  const filename = path.join(ROOT, "convex", name + ".ts");
  const source = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const syntax = (result.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  );
  assert.equal(
    syntax.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(syntax, {
      getCurrentDirectory: () => ROOT,
      getCanonicalFileName: (x) => x,
      getNewLine: () => "\n",
    })
  );
  const module = { exports: {} };
  modules.set(name, module.exports);
  const require = (dep) => {
    if (dep === "./_generated/server") return framework;
    if (dep === "./_generated/api") return { internal: refs, api: refs };
    if (dep === "./_generated/dataModel") return { Doc: {}, Id: String };
    if (dep === "convex/values") return { v: validators };
    if (dep === "convex/server") {
      const table = { index: () => table };
      return { defineTable: () => table };
    }
    if (dep === "xlsx") return cRequire("xlsx");
    if (dep === "@convex-dev/auth/server")
      return { getAuthUserId: async (ctx) => ctx.fixtureUserId ?? null };
    if (dep === "./employeeAccess")
      return {
        assertUserEmployeeAccess: async (ctx) => {
          if (ctx.fixtureEmployeeDenied) throw new Error("Employee access denied");
        },
      };
    if (dep === "./roleIdentity")
      return { resolveServerIdentity: async (ctx) => ctx.fixtureIdentity ?? null };
    if (dep === "./configContract")
      return {
        effectiveRoleCapabilities: (role) => {
          const caps = {
            superuser: [
              "inventory.read", "inventory.write", "inventory.admin",
              "ai.ocr", "rem.read", "rem.write",
              "admin.system_settings.manage", "admin.users.manage", "admin.audit.read",
            ],
            engineer: ["inventory.read", "inventory.write", "ai.ocr", "rem.read", "rem.write"],
            viewer: ["inventory.read", "rem.read"],
          };
          return caps[role] ?? [];
        },
      };
    if (dep === "./zenRuntime")
      return { runZen: async () => ({ text: '{"tables":[]}', model: "test-stub" }) };
    if (dep.startsWith("./")) return loadReal(dep.slice(2));
    throw new Error("Unexpected dependency: " + dep);
  };
  vm.runInNewContext(
    result.outputText,
    {
      module,
      exports: module.exports,
      require,
      console,
      process,
      Date,
      JSON,
      Math,
      Set,
      Map,
      Error,
      TypeError,
      Uint8Array,
      TextEncoder,
      TextDecoder,
      Blob,
      structuredClone,
      Object,
    },
    { filename, timeout: 10000 }
  );
  return module.exports;
}

const { parseEnterpriseFile, parseExtractedText } = loadReal("enterpriseFileParser");
const {
  suggestMapping, acceptAISuggestions, validateMapping, selectedRows,
  numeric, dateValue, metrics,
} = loadReal("enterpriseMapping");
const uploads = loadReal("enterpriseUploads");
const actions = loadReal("enterpriseUploadActions");

// ---------------------------------------------------------------
// Harness
// ---------------------------------------------------------------
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); if (e.stack) console.error(e.stack.split("\n").slice(1, 3).join("\n")); }
}
function reject(promise, pattern) {
  return promise.then(
    () => { throw new Error(`Expected rejection matching ${pattern} but resolved`); },
    (e) => { if (pattern && !pattern.test(String(e?.message ?? e))) throw new Error(`Rejected with "${e?.message ?? e}" but expected ${pattern}`); }
  );
}
function corr() { return "flow-" + Math.random().toString(36).slice(2, 18); }

// ---------------------------------------------------------------
// Fixture database / storage / scheduler / context
// ---------------------------------------------------------------
const INDEXES = {
  by_actor_and_correlationId: ["actor", "correlationId"],
  by_updatedAt: ["updatedAt"],
  by_uploadId_and_tableKey: ["uploadId", "tableKey"],
  by_key: ["key"],
  by_uploadId: ["uploadId"],
};

class FixtureDatabase {
  constructor() {
    this.rows = new Map();
    this.seq = 0;
    this.systemMeta = new Map();
    this.system = {
      get: async (id) => this.systemMeta.get(id) ?? null,
    };
  }
  clone() {
    const d = new FixtureDatabase();
    d.rows = new Map(this.rows);
    d.seq = this.seq;
    d.systemMeta = new Map(this.systemMeta);
    return d;
  }
  async get(id) { const r = this.rows.get(id); return r ? structuredClone(r) : null; }
  async insert(table, value) {
    const id = `${table}:${++this.seq}`;
    this.rows.set(id, { ...structuredClone(value), _id: id });
    return id;
  }
  async patch(id, value) {
    assert.ok(this.rows.has(id), `patch: ${id} not found`);
    this.rows.set(id, { ...this.rows.get(id), ...structuredClone(value) });
  }
  query(table) {
    const db = this;
    let indexName = null;
    let eqs = [];
    let desc = false;
    const sel = {
      withIndex(name, cb) {
        assert.ok(INDEXES[name], `Unknown index ${name}`);
        indexName = name;
        const r = { eq(field, value) { eqs.push([field, value]); return r; } };
        cb?.(r);
        return sel;
      },
      order(d) { desc = d === "desc"; return sel; },
      async first() { const all = await sel.collect(); return all[0] ?? null; },
      async unique() {
        const all = await sel.collect();
        assert.ok(all.length <= 1, `Expected unique result, got ${all.length}`);
        return all[0] ?? null;
      },
      async collect() {
        const fields = INDEXES[indexName] ?? [];
        const all = [...db.rows.values()].filter(
          (r) => r._id.startsWith(`${table}:`) && eqs.every(([k, v]) => r[k] === v)
        );
        if (fields.length) {
          all.sort((a, b) => {
            for (const f of fields) {
              if (a[f] < b[f]) return desc ? 1 : -1;
              if (a[f] > b[f]) return desc ? -1 : 1;
            }
            return 0;
          });
        }
        return all.map((r) => structuredClone(r));
      },
      async take(n) { const all = await sel.collect(); return all.slice(0, n); },
      paginate({ cursor, numItems }) {
        return sel.collect().then((all) => {
          const start = cursor ? parseInt(cursor, 36) : 0;
          const page = all.slice(start, start + numItems);
          const isDone = start + numItems >= all.length;
          return { page: page.map((r) => structuredClone(r)), isDone, continueCursor: isDone ? null : String(start + numItems) };
        });
      },
    };
    return sel;
  }
}

let storageSeq = 0;
const storageBlobs = new Map();
function createStorage() {
  return {
    generateUploadUrl: async () => `https://fixture-storage/upload/${++storageSeq}`,
    getUrl: async (id) => `https://fixture-storage/file/${id}`,
    store: async (blob) => {
      const id = `_storage:${++storageSeq}`;
      storageBlobs.set(id, blob);
      return id;
    },
    get: async (id) => storageBlobs.get(id) ?? null,
    delete: async (id) => { storageBlobs.delete(id); },
  };
}

let scheduled = [];
function createScheduler() {
  return {
    runAfter: async (_delay, ref, args) => { scheduled.push({ ref, args }); },
  };
}

const admin = { userId: "users:admin", role: "superuser" };
const engineer = { userId: "users:engineer", role: "engineer" };
const viewer = { userId: "users:viewer", role: "viewer" };

function makeCtx(
  db,
  identity,
  storage,
  { uploadRow, datasetRow, existingDataset } = {}
) {
  const ctx = {
    db,
    storage: storage ?? createStorage(),
    scheduler: createScheduler(),
    fixtureUserId: identity?.userId ?? null,
    fixtureIdentity: identity ? { role: identity.role } : null,
    fixtureEmployeeDenied: identity?.blocked,
  };
  ctx.runQuery = async (ref, args) => {
    const r = String(ref);
    if (r === "employeeAccess:assertUserAccess") {
      if (identity?.blocked) throw new Error("Employee access denied");
      return null;
    }
    if (r === "users:getUserRole") return identity?.role ?? null;
    if (r === "configActions:getRolePolicyInternal") return null;
    if (r === "enterpriseUploads:loadInternal") return uploadRow ?? null;
    if (r === "enterpriseUploads:datasetInternal") return datasetRow ?? null;
    if (r === "enterpriseUploads:existingDatasetInternal") return existingDataset ?? null;
    throw new Error(`Unexpected runQuery: ${r}`);
  };
  ctx.runMutation = async (ref, args) => {
    const r = String(ref);
    if (r === "enterpriseUploads:markParsing") return uploads.markParsing.handler(ctx, args);
    if (r === "enterpriseUploads:finish") return uploads.finish.handler(ctx, args);
    if (r === "enterpriseUploads:publishInternal") return uploads.publishInternal.handler(ctx, args);
    throw new Error(`Unexpected runMutation: ${r}`);
  };
  return ctx;
}

function makeUpload(db, attrs = {}) {
  return db.insert("enterpriseUploads", {
    actor: admin.userId,
    correlationId: corr(),
    name: "test.csv",
    mime: "text/csv",
    status: "stored",
    message: "Ready.",
    revision: 0,
    generation: 0,
    updatedAt: Date.now(),
    ...attrs,
  });
}

function validMapping() {
  return {
    name: "Test Dataset",
    destination: "inventory",
    headerRow: 1,
    excludedRows: [],
    fields: [
      { column: 0, label: "SKU", role: "identifier", kind: "text", visible: true, metric: false },
      { column: 1, label: "Qty", role: "quantity", kind: "number", visible: true, metric: true },
    ],
  };
}

// =============================================================
// GROUP 1: Upload lifecycle (begin -> attach -> queue)
// =============================================================

await test("begin creates upload with status=stored and returns upload URL", async () => {
  const db = new FixtureDatabase();
  const ctx = makeCtx(db, admin);
  const result = await uploads.begin.handler(ctx, {
    name: "stock.csv", mime: "text/csv", correlationId: corr(),
  });
  assert.ok(result.uploadUrl);
  assert.equal(result.attached, false);
  const row = await db.get(result.uploadId);
  assert.equal(row.status, "stored");
  assert.equal(row.revision, 0);
  assert.equal(row.actor, admin.userId);
});

await test("begin idempotent for same actor+correlation, no new URL when attached", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, { storageId: "_storage:orig" });
  const row = await db.get(uploadId);
  const ctx = makeCtx(db, admin, createStorage());
  const result = await uploads.begin.handler(ctx, {
    name: row.name, mime: row.mime, correlationId: row.correlationId,
  });
  assert.equal(result.uploadId, uploadId);
  assert.equal(result.uploadUrl, null);
  assert.equal(result.attached, true);
});

await test("begin rejects same correlationId with different file", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, { name: "a.csv", mime: "text/csv" });
  const row = await db.get(uploadId);
  const ctx = makeCtx(db, admin);
  await reject(uploads.begin.handler(ctx, {
    name: "b.csv", mime: "text/csv", correlationId: row.correlationId,
  }), /different file/);
});

await test("begin rejects viewer without admin.system_settings.manage", async () => {
  const db = new FixtureDatabase();
  const ctx = makeCtx(db, viewer);
  await reject(uploads.begin.handler(ctx, { name: "s.csv", mime: "text/csv", correlationId: corr() }), /capability|authenticated/i);
});

await test("attach records storage metadata and marks ready for analysis", async () => {
  const db = new FixtureDatabase();
  db.systemMeta.set("_storage:orig", { size: 123, sha256: "sha-abc" });
  const uploadId = await makeUpload(db);
  const ctx = makeCtx(db, admin);
  await uploads.attach.handler(ctx, { uploadId, storageId: "_storage:orig" });
  const row = await db.get(uploadId);
  assert.equal(row.storageId, "_storage:orig");
  assert.equal(row.size, 123);
  assert.equal(row.sha256, "sha-abc");
  assert.equal(row.status, "stored");
});

await test("attach rejects a second different storageId (one original retained)", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, { storageId: "_storage:orig" });
  const ctx = makeCtx(db, admin);
  await reject(uploads.attach.handler(ctx, { uploadId, storageId: "_storage:other" }), /already retained/);
});

await test("queue schedules analysis and bumps generation+revision", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, {
    storageId: "_storage:orig", revision: 2, generation: 1, updatedAt: Date.now() - 30_000,
  });
  const ctx = makeCtx(db, admin);
  const result = await uploads.queue.handler(ctx, { uploadId });
  assert.equal(result.generation, 2);
  const row = await db.get(uploadId);
  assert.equal(row.status, "queued");
  assert.equal(row.revision, 3);
  assert.equal(row.generation, 2);
  assert.ok(scheduled.length >= 1, "scheduler received the process job");
});

await test("queue rejects when no original file transferred", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db);
  const ctx = makeCtx(db, admin);
  await reject(uploads.queue.handler(ctx, { uploadId }), /Transfer the original file/);
});

await test("queue active lease returns same generation without re-scheduling", async () => {
  const before = scheduled.length;
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, {
    storageId: "_storage:o", status: "queued", generation: 5, updatedAt: Date.now() - 1000,
  });
  const ctx = makeCtx(db, admin);
  const result = await uploads.queue.handler(ctx, { uploadId });
  assert.equal(result.generation, 5);
  assert.equal(scheduled.length, before, "no duplicate schedule for active lease");
});

// =============================================================
// GROUP 2: Full process action (parse + suggest + finish)
// =============================================================

await test("process parses CSV, stores analysis, and finishes as review", async () => {
  const db = new FixtureDatabase();
  const storage = createStorage();
  const csv = new TextEncoder().encode("SKU,Qty,Description\nA1,10,Widget\nB2,20,Gadget");
  storageBlobs.set("_storage:orig", new Blob([csv], { type: "text/csv" }));
  db.systemMeta.set("_storage:orig", { size: csv.length, sha256: "sha-csv" });
  const uploadId = await makeUpload(db, { storageId: "_storage:orig" });
  const row = await db.get(uploadId);
  row.status = "queued";
  row.generation = 1;
  await db.patch(uploadId, { status: "queued", generation: 1 });
  const ctx = makeCtx(db, admin, storage, { uploadRow: row });
  await actions.process.handler(ctx, {
    uploadId, generation: 1, actor: admin.userId,
  });
  const after = await db.get(uploadId);
  assert.equal(after.status, "review");
  assert.ok(after.parsedStorageId, "analysis stored");
  assert.ok(after.aiStatus);
  assert.equal(after.summaries.length, 1);
  assert.equal(after.summaries[0].rowCount, 3);
  const analysisBlob = await storage.get(after.parsedStorageId);
  const analysis = JSON.parse(await analysisBlob.text());
  const qty = analysis.tables[0].rows[1].cells[1];
  assert.equal(qty.display, "10", "parsed quantity display preserved");
  assert.equal(numeric(qty), 10, "parsed quantity converts to number via numeric()");
  assert.equal(analysis.suggestions["sheet_0"].fields[0].role, "identifier");
});

await test("process marks needs_attention and keeps original when parsing fails", async () => {
  const db = new FixtureDatabase();
  const storage = createStorage();
  storageBlobs.set("_storage:orig", new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: "application/octet-stream" }));
  db.systemMeta.set("_storage:orig", { size: 4, sha256: "sha-bad" });
  const uploadId = await makeUpload(db, { storageId: "_storage:orig" });
  const row = await db.get(uploadId);
  row.status = "queued"; row.generation = 1;
  await db.patch(uploadId, { status: "queued", generation: 1 });
  const ctx = makeCtx(db, admin, storage, { uploadRow: row });
  await actions.process.handler(ctx, { uploadId, generation: 1, actor: admin.userId });
  const after = await db.get(uploadId);
  assert.equal(after.status, "needs_attention");
  assert.ok(after.message.includes("retained"), "original retained messaging");
  assert.deepEqual(after.summaries, []);
});

await test("process uses recovery text when provided", async () => {
  const db = new FixtureDatabase();
  const storage = createStorage();
  const csv = new TextEncoder().encode("SKU,Qty\nA1,10");
  storageBlobs.set("_storage:recovery", new Blob([csv], { type: "text/plain" }));
  storageBlobs.set("_storage:orig", new Blob([new Uint8Array([9, 9, 9])], { type: "application/octet-stream" }));
  db.systemMeta.set("_storage:recovery", { size: csv.length, sha256: "sha-t" });
  const uploadId = await makeUpload(db, { storageId: "_storage:orig", textStorageId: "_storage:recovery" });
  const row = await db.get(uploadId);
  row.status = "queued"; row.generation = 1;
  await db.patch(uploadId, { status: "queued", generation: 1 });
  const ctx = makeCtx(db, admin, storage, { uploadRow: row });
  await actions.process.handler(ctx, { uploadId, generation: 1, actor: admin.userId });
  const after = await db.get(uploadId);
  assert.equal(after.status, "review");
  assert.ok(after.message.includes("recovery text"), "recovery-text source noted");
});

// =============================================================
// GROUP 3: Stale-generation protection
// =============================================================

await test("markParsing refuses stale generation", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, { status: "queued", generation: 2 });
  const ctx = makeCtx(db, admin);
  const ok1 = await uploads.markParsing.handler(ctx, { uploadId, generation: 2 });
  const ok2 = await uploads.markParsing.handler(ctx, { uploadId, generation: 3 });
  assert.equal(ok1, true);
  assert.equal(ok2, false);
});

await test("finish refuses stale generation and does not overwrite", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, { status: "queued", generation: 2, revision: 3 });
  const ctx = makeCtx(db, admin);
  const result = await uploads.finish.handler(ctx, {
    uploadId, generation: 1, status: "review", message: "stale", aiStatus: "x", summaries: [],
  });
  assert.equal(result, false);
  const row = await db.get(uploadId);
  assert.equal(row.status, "queued");
  assert.equal(row.revision, 3);
});

// =============================================================
// GROUP 4: Publish revision / idempotency / mutation guards
// =============================================================

await test("publishInternal creates snapshot dataset and audited event", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, {
    status: "review", revision: 1, parsedStorageId: "_storage:parsed", sha256: "sha-src",
  });
  const ctx = makeCtx(db, admin);
  const result = await uploads.publishInternal.handler(ctx, {
    uploadId, actor: admin.userId, parsedStorageId: "_storage:parsed", tableKey: "sheet_0",
    expectedRevision: 1, expectedDatasetRevision: 0, mapping: validMapping(),
    rowCount: 5, correlationId: corr(),
  });
  assert.equal(result.duplicate, false);
  const ds = await db.get(result.datasetId);
  assert.equal(ds.revision, 1);
  assert.equal(ds.sourceHash, "sha-src");
  assert.equal(ds.rowCount, 5);
  assert.equal(ds.actor, admin.userId);
  const audit = await db.query("enterpriseUploadAudit").withIndex("by_actor_and_correlationId", (q) => q.eq("actor", admin.userId)).take(10);
  assert.ok(audit.some((a) => a.operation === "publish_snapshot"), "publish_snapshot audited");
});

await test("publishInternal exact replay returns same datasetId with duplicate=true", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, {
    status: "published", revision: 1, parsedStorageId: "_storage:parsed", sha256: "h",
  });
  const cid = corr();
  const ctx = makeCtx(db, admin);
  const args = {
    uploadId, actor: admin.userId, parsedStorageId: "_storage:parsed", tableKey: "sheet_0",
    expectedRevision: 1, expectedDatasetRevision: 0, mapping: validMapping(),
    rowCount: 5, correlationId: cid,
  };
  const first = await uploads.publishInternal.handler(ctx, args);
  const second = await uploads.publishInternal.handler(ctx, args);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.datasetId, first.datasetId);
});

await test("publishInternal rejects changed request for the same correlationId", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, {
    status: "published", revision: 1, parsedStorageId: "_storage:parsed", sha256: "h",
  });
  const cid = corr();
  const ctx = makeCtx(db, admin);
  await uploads.publishInternal.handler(ctx, {
    uploadId, actor: admin.userId, parsedStorageId: "_storage:parsed", tableKey: "sheet_0",
    expectedRevision: 1, expectedDatasetRevision: 0, mapping: validMapping(),
    rowCount: 5, correlationId: cid,
  });
  await reject(uploads.publishInternal.handler(ctx, {
    uploadId, actor: admin.userId, parsedStorageId: "_storage:parsed", tableKey: "sheet_0",
    expectedRevision: 1, expectedDatasetRevision: 0,
    mapping: { ...validMapping(), name: "Changed" }, rowCount: 5, correlationId: cid,
  }), /request changed/);
});

await test("publishInternal rejects stale expectedRevision (upload changed)", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, {
    status: "review", revision: 2, parsedStorageId: "_storage:parsed", sha256: "h",
  });
  const ctx = makeCtx(db, admin);
  await reject(uploads.publishInternal.handler(ctx, {
    uploadId, actor: admin.userId, parsedStorageId: "_storage:parsed", tableKey: "sheet_0",
    expectedRevision: 1, expectedDatasetRevision: 0, mapping: validMapping(),
    rowCount: 5, correlationId: corr(),
  }), /upload changed/);
});

await test("publishInternal rejects when source still needs attention", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, {
    status: "needs_attention", revision: 1, parsedStorageId: "_storage:parsed", sha256: "h",
  });
  const ctx = makeCtx(db, admin);
  await reject(uploads.publishInternal.handler(ctx, {
    uploadId, actor: admin.userId, parsedStorageId: "_storage:parsed", tableKey: "sheet_0",
    expectedRevision: 1, expectedDatasetRevision: 0, mapping: validMapping(),
    rowCount: 5, correlationId: corr(),
  }), /requires attention|changed/);
});

await test("publish action refuses analysis status needs_attention", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, { status: "needs_attention", revision: 1 });
  const analysis = {
    tables: [{
      key: "sheet_0", name: "T", hidden: false, columnCount: 2, headerRow: 1,
      rows: [{ row: 1, cells: [{ value: "SKU", display: "SKU" }, { value: "Qty", display: "Qty" }] }],
      warnings: [],
    }],
    warnings: ["bad"], status: "needs_attention",
    suggestions: { sheet_0: validMapping() }, aiStatus: "",
  };
  const storage = createStorage();
  const analysisId = await storage.store(new Blob([JSON.stringify(analysis)], { type: "application/json" }));
  const ctx = makeCtx(db, admin, storage, { uploadRow: { _id: uploadId, revision: 1, parsedStorageId: analysisId } });
  await reject(actions.publish.handler(ctx, {
    uploadId, parsedStorageId: analysisId, tableKey: "sheet_0",
    expectedRevision: 1, expectedDatasetRevision: 0,
    mapping: validMapping(), correlationId: corr(),
  }), /requires attention/);
});

await test("publishInternal dataset is a reporting snapshot with no inventory/SAP fields", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, { status: "review", revision: 1, parsedStorageId: "_storage:parsed", sha256: "h" });
  const ctx = makeCtx(db, admin);
  const result = await uploads.publishInternal.handler(ctx, {
    uploadId, actor: admin.userId, parsedStorageId: "_storage:parsed", tableKey: "sheet_0",
    expectedRevision: 1, expectedDatasetRevision: 0, mapping: validMapping(),
    rowCount: 5, correlationId: corr(),
  });
  const ds = await db.get(result.datasetId);
  for (const forbidden of ["qoh", "sapStatus", "stockId", "sapStaging", "transactions"]) {
    assert.ok(!(forbidden in ds), `dataset must not carry ${forbidden}`);
  }
  assert.equal(typeof ds.rowCount, "number");
  assert.equal(typeof ds.revision, "number");
  assert.equal(typeof ds.mapping.name, "string");
});

// =============================================================
// GROUP 5: Dataset read action and RBAC
// =============================================================

await test("dataset action requires matching inventory.read permission", async () => {
  const db = new FixtureDatabase();
  const datasetRow = {
    _id: "enterpriseDatasets:1", uploadId: "enterpriseUploads:1", tableKey: "sheet_0",
    parsedStorageId: "_storage:parsed", mapping: validMapping(),
    rowCount: 2, revision: 1, sourceHash: "h", actor: admin.userId,
  };
  const table = {
    key: "sheet_0", name: "T", hidden: false, columnCount: 2, headerRow: 1,
    warnings: [],
    rows: [
      { row: 1, cells: [{ value: "SKU", display: "SKU" }, { value: "Qty", display: "Qty" }] },
      { row: 2, cells: [{ value: "A", display: "A" }, { value: "10", display: "10" }] },
      { row: 3, cells: [{ value: "B", display: "B" }, { value: "20", display: "20" }] },
    ],
  };
  const analysis = { tables: [table], status: "review", warnings: [], suggestions: {}, aiStatus: "" };
  const storage = createStorage();
  const analysisId = await storage.store(new Blob([JSON.stringify(analysis)], { type: "application/json" }));
  const uploadRow = { _id: "enterpriseUploads:1", parsedStorageId: analysisId, revision: 1, status: "published" };
  const ctx = makeCtx(db, engineer, storage, { datasetRow, existingDataset: datasetRow });
  datasetRow.parsedStorageId = analysisId;
  const out = await actions.dataset.handler(ctx, { datasetId: datasetRow._id });
  assert.equal(out.totalRows, 2, "data rows selected above header");
  assert.equal(out.rows[0].cells[0].value, "A");
  assert.equal(out.metrics[0].sum, 30, "metric sums published snapshot rows");
});

await test("dataset action gates destination: viewer reads production via rem.read", async () => {
  const db = new FixtureDatabase();
  const datasetRow = {
    _id: "enterpriseDatasets:1", uploadId: "enterpriseUploads:1", tableKey: "sheet_0",
    parsedStorageId: "_storage:x",
    mapping: { ...validMapping(), destination: "production" },
    rowCount: 1, revision: 1, sourceHash: "h", actor: admin.userId,
  };
  const storage = createStorage();
  const analysisId = await storage.store(new Blob([JSON.stringify({ tables: [{ key: "sheet_0", name: "T", hidden: false, columnCount: 2, headerRow: 1, rows: [{ row: 1, cells: [{ value: "SKU", display: "SKU" }, { value: "Qty", display: "Qty" }] }, { row: 2, cells: [{ value: "A", display: "A" }, { value: "10", display: "10" }] }], warnings: [] }], status: "review", warnings: [], suggestions: {}, aiStatus: "" })], { type: "application/json" }));
  datasetRow.parsedStorageId = analysisId;
  const ctx = makeCtx(db, viewer, storage, { datasetRow });
  const out = await actions.dataset.handler(ctx, { datasetId: datasetRow._id });
  assert.equal(out.totalRows, 1, "viewer with rem.read can read production datasets");
});

await test("dataset action rejects unauthenticated reads", async () => {
  const db = new FixtureDatabase();
  const datasetRow = {
    _id: "enterpriseDatasets:1", uploadId: "enterpriseUploads:1", tableKey: "sheet_0",
    parsedStorageId: "_storage:x",
    mapping: validMapping(),
    rowCount: 1, revision: 1, sourceHash: "h", actor: admin.userId,
  };
  const ctx = makeCtx(db, undefined, createStorage(), { datasetRow });
  await reject(actions.dataset.handler(ctx, { datasetId: datasetRow._id }), /authenticated|capa/i);
});

await test("datasets query requires inventory.read AND rem.read", async () => {
  const db = new FixtureDatabase();
  const ctx = makeCtx(db, viewer);
  const out = await uploads.datasets.handler(ctx, {});
  assert.deepEqual(out.items, []);
  assert.equal(out.nextCursor, null);
});

await test("upload list query is admin-only", async () => {
  const db = new FixtureDatabase();
  const ctx = makeCtx(db, engineer);
  await reject(uploads.list.handler(ctx, {}), /capability/i);
});

// =============================================================
// GROUP 6: Recovery text path
// =============================================================

await test("attachText retains recovery text and bumps revision", async () => {
  const db = new FixtureDatabase();
  db.systemMeta.set("_storage:txt", { size: 512 });
  const uploadId = await makeUpload(db, { storageId: "_storage:orig", revision: 3, updatedAt: Date.now() - 60_000 });
  const ctx = makeCtx(db, admin);
  await uploads.attachText.handler(ctx, { uploadId, textStorageId: "_storage:txt" });
  const row = await db.get(uploadId);
  assert.equal(row.textStorageId, "_storage:txt");
  assert.equal(row.revision, 4);
});

await test("attachText rejects without an original upload", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db);
  const ctx = makeCtx(db, admin);
  await reject(uploads.attachText.handler(ctx, { uploadId, textStorageId: "_storage:txt" }), /Original upload not found/);
});

await test("attachText rejects during an active analysis lease", async () => {
  const db = new FixtureDatabase();
  const uploadId = await makeUpload(db, { storageId: "_storage:orig", status: "queued", updatedAt: Date.now() - 1000 });
  const ctx = makeCtx(db, admin);
  await reject(uploads.attachText.handler(ctx, { uploadId, textStorageId: "_storage:txt" }), /current analysis/);
});

// =============================================================
// GROUP 7: Number format and value safety
// =============================================================

await test("US format: '1,234.50' -> 1234.5", () => {
  assert.equal(numeric({ value: "1,234.50", display: "1,234.50" }, "us"), 1234.5);
});

await test("EU format: '1.234,50' -> 1234.5", () => {
  assert.equal(numeric({ value: "1.234,50", display: "1.234,50" }, "eu"), 1234.5);
});

await test("default plain format leaves ambiguous '1,234.50' null", () => {
  assert.equal(numeric({ value: "1,234.50", display: "1,234.50" }), null);
  assert.equal(numeric({ value: "1.234,50", display: "1.234,50" }), null);
});

await test("issue/uncached cells never count as zero", () => {
  assert.equal(numeric({ value: 0, display: "0", issue: "Formula has no cached result" }), null);
  assert.equal(numeric({ value: "0", display: "0", issue: "Source formula/error value: #REF!" }), null);
  assert.equal(numeric({ value: null, display: "" }), null);
});

await test("leading-zero text identifiers are not coerced to quantities", () => {
  assert.equal(numeric({ value: "00123", display: "00123" }), null);
  assert.equal(numeric({ value: "0", display: "0" }), 0);
});

await test("dateValue rejects invalid calendar dates without inventing values", () => {
  assert.equal(dateValue({ value: "2026-02-30", display: "2026-02-30" }, "iso"), null);
  assert.equal(dateValue({ value: "2026-04-01", display: "2026-04-01" }, "iso"), Date.parse("2026-04-01T00:00:00.000Z"));
});

// =============================================================
// GROUP 8: Mapping validation guards
// =============================================================

await test("validateMapping rejects dropped columns (must keep every source column)", () => {
  const table = {
    key: "s", name: "S", hidden: false, columnCount: 3, headerRow: 1,
    rows: [{ row: 1, cells: [{ value: "A", display: "A" }, { value: "B", display: "B" }, { value: "C", display: "C" }] }],
    warnings: [],
  };
  const m = validMapping();
  m.fields = m.fields.slice(0, 1); // only 1 field for 3 columns
  assert.throws(() => validateMapping(table, m), /column/);
});

await test("suggestMapping keeps every unknown column as extra (no invention)", () => {
  const table = {
    key: "s", name: "S", hidden: false, columnCount: 1, headerRow: 0,
    rows: [{ row: 0, cells: [{ value: "Weird Col", display: "Weird Col" }] }],
    warnings: [],
  };
  const m = suggestMapping(table);
  assert.equal(m.fields.length, 1);
  assert.equal(m.fields[0].role, "extra");
});

// =============================================================
// Summary
// =============================================================
console.log(`\nACTUAL_ENTERPRISE_UPLOAD_FLOW_CHECK: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);