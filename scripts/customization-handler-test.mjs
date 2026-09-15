import assert from "node:assert/strict";
import { loadReal } from "./customization-real-loader.mjs";

// Executes the complete production modules. Only Convex registration, identity
// lookups and the database transport are fixtures. The transaction emulator
// proves handler intent, not Convex's distributed OCC implementation.
const actions = loadReal("configActions");
const contract = loadReal("configContract");
const guard = loadReal("authGuard");
const copy = (x) => structuredClone(x);
const admin = { userId: "users:admin", role: "superuser" };
const other = { userId: "users:other", role: "superuser" };
const engineer = { userId: "users:engineer", role: "engineer" };
const unboundedReads = new Set();
const indexes = {
  by_key: ["key"], by_owner: ["owner"], by_key_and_version: ["key", "version"],
  by_correlationId: ["correlationId"], by_appliedAt: ["appliedAt"], by_timestamp: ["timestamp"],
};

class FixtureDatabase {
  constructor() { this.rows = new Map(); this.sequence = 0; this.reads = []; this.writes = 0; this.failInsert = null; }
  clone() { const db = new FixtureDatabase(); db.rows = copy(this.rows); db.sequence = this.sequence; db.failInsert = this.failInsert; return db; }
  async get(id) { return copy(this.rows.get(id) ?? null); }
  async insert(table, value) {
    if (this.failInsert?.(table, value)) throw new Error("Synthetic storage failure");
    const id = `${table}:${++this.sequence}`;
    this.rows.set(id, { ...copy(value), _id: id, _creationTime: this.sequence }); this.writes++;
    return id;
  }
  async patch(id, value) { assert.ok(this.rows.has(id)); this.rows.set(id, { ...this.rows.get(id), ...copy(value) }); this.writes++; }
  async delete(id) { this.rows.delete(id); this.writes++; }
  query(table) {
    const database = this; let index = null, equals = [], descending = false;
    const selection = {
      withIndex(name, callback) {
        assert.ok(indexes[name], `Unknown fixture index ${name}`); index = name;
        const range = { eq(field, value) { assert.equal(field, indexes[name][equals.length]); equals.push([field, value]); return range; } };
        callback?.(range); return selection;
      },
      order(direction) { descending = direction === "desc"; return selection; },
      async take(limit) {
        assert.ok(Number.isInteger(limit) && limit >= 0);
        database.reads.push({ table, index, equals: copy(equals), limit });
        const fields = [...(indexes[index] ?? []), "_creationTime"];
        const selected = [...database.rows.values()].filter(row => row._id.startsWith(`${table}:`) && equals.every(([key, value]) => row[key] === value));
        selected.sort((a, b) => { for (const field of fields) { if (a[field] < b[field]) return descending ? 1 : -1; if (a[field] > b[field]) return descending ? -1 : 1; } return 0; });
        return copy(selected.slice(0, limit));
      },
      async first() { return (await selection.take(1))[0] ?? null; },
      async collect() { unboundedReads.add(table); return selection.take(Number.MAX_SAFE_INTEGER); },
    };
    return selection;
  }
}

function context(db, identity) {
  const ctx = { db, fixtureUserId: identity?.userId ?? null, fixtureIdentity: identity, fixtureEmployeeDenied: identity?.blocked };
  ctx.runQuery = async (ref, args) => {
    if (ref === "employeeAccess:assertUserAccess") { if (identity?.blocked) throw new Error("Employee access denied"); return null; }
    if (ref === "users:getUserRole") return identity?.role ?? null;
    if (ref === "configActions:getRolePolicyInternal") return actions.getRolePolicyInternal.handler({ ...ctx, db }, args);
    throw new Error(`Unexpected internal query ${ref}`);
  };
  return ctx;
}
let db;
async function call(name, args = {}, identity = admin, readOnly = false) {
  const working = db.clone();
  const result = await actions[name].handler(context(working, identity), copy(args));
  if (readOnly) { assert.equal(working.writes, 0, `${name} wrote during read`); db.reads.push(...working.reads); }
  else db = working;
  return copy(result);
}
const read = (name, args = {}, identity = admin) => call(name, args, identity, true);
const rows = (table) => [...db.rows.values()].filter(row => row._id.startsWith(`${table}:`));
const snapshot = () => JSON.stringify([...db.rows]);
let correlation = 0;
const cid = () => `fixture-${++correlation}`;
async function create(key, value, identity = admin) { return call("createDraft", { key, value, correlationId: cid() }, identity); }
async function publish(draft, version = draft.baseVersion) {
  return call("publishDraft", { draftId: draft.draftId, expectedDraftRevision: draft.revision, expectedValueDigest: contract.valueDigest(draft.value), expectedPublishedVersion: version, correlationId: cid() });
}
async function importArgs(entries, correlationId = cid()) {
  const payload = { schemaVersion: 1, entries };
  const preview = await read("previewImportConfig", { payload, correlationId });
  return { payload, expectedPayloadDigest: preview.payloadDigest, correlationId, expectedVersions: preview.entries.filter(e => e.action === "add" || e.action === "update").map(e => ({ key: e.key, version: e.currentVersion })) };
}
let passes = 0, failures = 0;
async function test(name, run) {
  db = new FixtureDatabase();
  try { await run(); passes++; console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}

await test("administration requires authentication and server role", async () => {
  for (const identity of [null, engineer]) {
    for (const name of ["listPublishedAdmin", "listDrafts", "getAuditLog", "exportConfig"])
      await assert.rejects(read(name, {}, identity), /Not authenticated|Missing capability/);
    await assert.rejects(create("brand.appTitle", "Denied", identity), /Not authenticated|Missing capability/);
  }
  assert.equal(rows("configAuditLog").length, 0);
  assert.equal(actions.createAuditEntry, undefined);
});

await test("draft queries and edits are limited to their owner", async () => {
  const own = await create("brand.appTitle", "One");
  const theirs = await create("brand.appTitle", "Two", other);
  assert.deepEqual((await read("listDrafts")).map(d => d.draftId), [own.draftId]);
  const foreignRead = await read("getDraft", { draftId: theirs.draftId }).catch(e => { assert.match(e.message, /owner|access|Forbidden/); return null; });
  assert.equal(foreignRead, null);
  for (const name of ["updateDraft", "deleteDraft"])
    await assert.rejects(call(name, { draftId: theirs.draftId, expectedRevision: 1, value: "Denied", correlationId: cid() }), /owner/);
});

await test("revision and exact content review prevent stale publication", async () => {
  const original = await create("brand.appTitle", "Before");
  const updated = await call("updateDraft", { draftId: original.draftId, expectedRevision: 1, value: "After", correlationId: cid() });
  await assert.rejects(publish(original), /Draft conflict/);
  await assert.rejects(call("updateDraft", { draftId: original.draftId, expectedRevision: 1, value: "Lost", correlationId: cid() }), /Draft conflict/);
  await assert.rejects(publish({ ...updated, value: "Unreviewed" }), /reviewed content/);
  assert.equal((await publish(updated)).value, "After");
  assert.equal(rows("configVersions").length, 1);
});

await test("published revision conflicts and exact historical rollback", async () => {
  const first = await create("brand.appTitle", "Version One");
  const competing = await create("brand.appTitle", "Competing");
  await publish(first);
  await assert.rejects(publish(competing), /Version conflict/);
  await publish(await create("brand.appTitle", "Version Two"));
  const result = await call("rollbackToVersion", { key: "brand.appTitle", targetVersion: 1, expectedCurrentVersion: 2, correlationId: cid() });
  assert.equal(result.version, 3); assert.equal(result.value, "Version One");
  assert.deepEqual(rows("configVersions").map(row => row.value), ["Version One", "Version Two", "Version One"]);
  const audit = rows("configAuditLog").at(-1);
  assert.equal(audit.previousValue, "Version Two"); assert.equal(audit.newValue, "Version One");
  assert.equal(audit.actor, admin.userId); assert.equal(audit.capability, "admin.system_settings.manage");
  await assert.rejects(call("rollbackToVersion", { key: "brand.appTitle", targetVersion: 99, expectedCurrentVersion: 3, correlationId: cid() }), /Unknown published version/);
});

await test("published presentation data excludes private role policy and actors", async () => {
  await publish(await create("brand.appTitle", "Visible"));
  await publish(await create("roles.policy", copy(contract.DEFAULT_ROLE_CAPABILITIES)));
  const result = await read("listPublished", {}, null);
  assert.deepEqual(result.map(r => r.key), ["brand.appTitle"]);
  assert.equal("publishedBy" in result[0], false);
  assert.equal(await read("getPublished", { key: "roles.policy" }, null), null);
});

await test("actual export roundtrip and preview never write", async () => {
  await publish(await create("brand.appTitle", "Round Trip"));
  const payload = await read("exportConfig");
  assert.equal(contract.validateImportEnvelope(payload).valid, true);
  const before = snapshot();
  const preview = await read("previewImportConfig", { payload, correlationId: cid() });
  assert.equal(snapshot(), before); assert.equal(preview.unchanged, 1);
  const result = await call("applyImportConfig", { payload, expectedVersions: [], expectedPayloadDigest: preview.payloadDigest, correlationId: cid() });
  assert.equal(result.unchanged, 1); assert.equal(rows("configVersions").length, 1);
});

await test("empty export imports safely", async () => {
  const payload = await read("exportConfig");
  const preview = await read("previewImportConfig", { payload, correlationId: cid() });
  const result = await call("applyImportConfig", { payload, expectedVersions: [], expectedPayloadDigest: preview.payloadDigest, correlationId: cid() });
  assert.equal(result.adds + result.updates, 0); assert.equal(rows("configPublished").length, 0);
});

await test("atomic import verifies digest, all versions and exact retry", async () => {
  const args = await importArgs([{ key: "brand.appTitle", value: "Imported" }, { key: "brand.sidebarTitle", value: "Sidebar" }]);
  const before = snapshot();
  await assert.rejects(call("applyImportConfig", { ...args, expectedPayloadDigest: "different" }), /reviewed preview/);
  await assert.rejects(call("applyImportConfig", { ...args, expectedVersions: [{ key: "brand.appTitle", version: 0 }, { key: "brand.sidebarTitle", version: 1 }] }), /Version conflict/);
  assert.equal(snapshot(), before);
  const result = await call("applyImportConfig", args); assert.equal(result.adds, 2);
  const after = snapshot(); assert.equal((await call("applyImportConfig", args)).duplicate, true); assert.equal(snapshot(), after);
  const changed = await importArgs([{ key: "brand.appTitle", value: "Changed" }], args.correlationId);
  await assert.rejects(call("applyImportConfig", changed), /different payload/);
  assert.equal(snapshot(), after);
});

await test("a failure after first batch write commits neither config nor audit", async () => {
  const args = await importArgs([{ key: "brand.appTitle", value: "First" }, { key: "brand.sidebarTitle", value: "Second" }]);
  const before = snapshot();
  db.failInsert = (table, value) => table === "configVersions" && value.key === "brand.sidebarTitle";
  await assert.rejects(call("applyImportConfig", args), /Synthetic storage failure/);
  assert.equal(snapshot(), before); assert.equal(rows("configAuditLog").length, 0);
});

await test("role policy restricts optional capabilities but cannot widen or lock out recovery", async () => {
  const policy = copy(contract.DEFAULT_ROLE_CAPABILITIES); policy.engineer = ["inventory.read", "rem.read"];
  await publish(await create("roles.policy", policy));
  await assert.rejects(guard.requireCapability(context(db, engineer), "inventory.write"), /disabled by role policy/);
  await guard.requireCapability(context(db, engineer), "inventory.read");
  const forged = { engineer: ["inventory.admin"], superuser: [] };
  assert.equal(contract.effectiveRoleCapabilities("engineer", forged).includes("inventory.admin"), false);
  assert.equal(contract.effectiveRoleCapabilities("superuser", forged).includes("admin.system_settings.manage"), true);
  await assert.rejects(guard.requireCapability(context(db, { ...admin, blocked: true }), "admin.system_settings.manage"), /Employee access denied/);
  const actionCtx = context(db, engineer); delete actionCtx.db;
  await assert.rejects(guard.requireCapability(actionCtx, "inventory.write"), /disabled by role policy/);
});

await test("strict registry rejects inherited names and malformed metadata", async () => {
  for (const key of ["toString", "constructor", "__proto__"]) {
    assert.equal(contract.getConfigEntry(key), undefined);
    assert.equal(contract.validateConfigValue(key, "Rejected").valid, false);
    assert.deepEqual([...contract.effectiveRoleCapabilities(key, {})], []);
  }
  for (const extra of [{ exportedAt: -1 }, { exportedAt: "yesterday" }])
    assert.equal(contract.validateImportEnvelope({ schemaVersion: 1, entries: [], ...extra }).valid, false);
  for (const version of [-1, "one", 1.5])
    assert.equal(contract.validateImportEnvelope({ schemaVersion: 1, entries: [{ key: "brand.appTitle", value: "Valid", version }] }).valid, false);
  assert.equal(contract.validateConfigValue("forms.partMasterFields", []).valid, false);
  assert.notEqual(contract.valueDigest("x".repeat(100000) + "A"), contract.valueDigest("x".repeat(100000) + "B"));
});

await test("open drafts and idempotency receipts remain bounded", async () => {
  for (let i = 0; i < 20; i++) await create("brand.appTitle", `Draft ${i}`);
  await assert.rejects(create("brand.appTitle", "Excess"), /Too many open drafts/);
  for (let i = 0; i < 103; i++) await call("applyImportConfig", await importArgs([{ key: "brand.appTitle", value: `Import ${i}` }]));
  assert.equal(rows("configImportReceipts").length, 100);
  assert.equal(rows("configVersions").length, 103);
  assert.ok(rows("configAuditLog").length >= 103);
});

await test("all 35 actual registry defaults validate and invalid types fail", async () => {
  const entries = contract.getAllConfigEntries(); assert.equal(entries.length, 35);
  const exported = { schemaVersion: 1, entries: [] };
  for (const entry of entries) {
    const value = copy(entry.defaultValue);
    assert.equal(contract.validateConfigValue(entry.key, value).valid, true, entry.key);
    assert.equal(contract.getConfigRequiredCapability(entry.key), "admin.system_settings.manage");
    assert.ok(contract.CATEGORY_LABELS[entry.category]); assert.ok(contract.CATEGORY_ICONS[entry.category]);
    assert.equal(contract.validateConfigValue(entry.key, null).valid, false, entry.key);
    const invalid = typeof value === "boolean" ? "true" : typeof value === "number" ? NaN : typeof value === "string" ? 123 : { arbitraryScript: "rejected" };
    assert.equal(contract.validateConfigValue(entry.key, invalid).valid, false, entry.key);
    exported.entries.push({ key: entry.key, value });
  }
  assert.equal(contract.validateImportEnvelope(exported).valid, true);
  const duplicate = { ...exported, entries: [exported.entries[0], exported.entries[0]] };
  assert.equal(contract.validateImportEnvelope(duplicate).valid, false);
  for (const key of ["OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "features.dhrEnabled", "inventory.qoh", "audit.entries"]) {
    assert.equal(contract.validateConfigValue(key, "forbidden").valid, false);
    assert.equal(contract.isPublicConfigKey(key), false);
  }
});


await test("every exercised config query uses bounded reads", async () => { assert.deepEqual([...unboundedReads], []); });

console.log(`ACTUAL_CUSTOMIZATION_HANDLERS: ${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
