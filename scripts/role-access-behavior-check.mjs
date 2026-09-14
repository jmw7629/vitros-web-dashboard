// Execute actual production auth/identity/guard/limiter handlers. The indexed DB
// and action dispatch are synthetic; serialized mutations model Convex's atomic
// mutation contract. No live backend, password value, or business writes.
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";

const v = new Proxy({}, { get: () => () => ({}) });
const registered = { query: x => x, mutation: x => x, internalQuery: x => x, internalMutation: x => x, internalAction: x => x };
const internal = {
  auth: { validateRoleSelection: "validate" },
  users: { getUserRole: "role" },
  employeeAccess: { assertUserAccess: "access", provisionVerifiedEmployeeAccess: "provision" },
  roleSignInLimiter: { reserveSuperuserAttempt: "reserve", releaseSuccessfulSuperuserAttempt: "release" },
};
const rows = new Map(); let sequence = 0; let now = 1_800_000_000_000;
let actorId = null; let config; let verifierCalls = 0; let fetchCalls = 0; let providerActive = false;
let mutationTail = Promise.resolve();
const env = { SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-only", VITROS_SUPERUSER_PASSWORD_HASH: "synthetic-hash" };
const db = {
  async get(id) { return rows.get(id) ?? null; },
  async insert(table, value) { const id = `${table}:${++sequence}`; rows.set(id, { ...value, _id: id }); return id; },
  async patch(id, value) { rows.set(id, { ...rows.get(id), ...value }); },
  async delete(id) { rows.delete(id); },
  query(table) { return { withIndex(index, filter) {
    const conditions = []; const q = { eq(key, value) { conditions.push([key, value]); return q; } }; filter(q);
    assert.ok(["userIdAndProvider", "by_key", "by_employeeId"].includes(index));
    return { async unique() {
      const found = [...rows.values()].filter(row => row._id.startsWith(`${table}:`) && conditions.every(([key, value]) => row[key] === value));
      assert.ok(found.length <= 1); return found[0] ?? null;
    } };
  } }; },
};
const ctx = { db };
const employee = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", initials: "AB", name: "Synthetic employee", active: true };
const dependencies = {
  "convex/values": { v }, "./_generated/server": registered, "./_generated/api": { internal },
  "@convex-dev/auth/providers/Password": { Password: x => x },
  "@convex-dev/auth/providers/ConvexCredentials": { ConvexCredentials: x => x },
  "./testAuth": {}, "./ViktorSpacesEmail": {},
  "lucia": { Scrypt: class { async verify(hash, secret) {
    verifierCalls++;
    const limit = [...rows.values()].find(row => row.key === "superuser");
    assert.ok(limit?.reservations.length > 0, "reserve atomically before expensive verification");
    if (hash === "synthetic-malformed") throw new Error("private malformed hash detail");
    return hash === "synthetic-hash" && secret === "synthetic-correct-secret";
  } } },
  "@convex-dev/auth/server": {
    getAuthUserId: async () => actorId,
    convexAuth: c => { config = c; return {}; },
    async createAccount(_ctx, args) {
      assert.equal(args.provider, "vitros-role");
      let account = [...rows.values()].find(row => row._id.startsWith("authAccounts:") && row.providerAccountId === args.account.id);
      if (!account) {
        const userId = await db.insert("users", {});
        await db.insert("authAccounts", { userId, provider: "vitros-role", providerAccountId: args.account.id });
        await config.callbacks.afterUserCreatedOrUpdated(ctx, { userId, provider: { id: "vitros-role" }, profile: args.profile });
        account = { userId };
      }
      return { user: await db.get(account.userId) };
    },
  },
};
function load(name) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(`convex/${name}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, {
    exports, process: { env }, Date: { now: () => now },
    require: key => { assert.ok(key in dependencies, `Unexpected dependency ${key}`); return dependencies[key]; },
    fetch: async () => { fetchCalls++; return { ok: true, json: async () => providerActive ? [employee] : [] }; },
  });
  dependencies[`./${name}`] = exports; return exports;
}
const identity = load("roleIdentity"); const access = load("employeeAccess"); const limiter = load("roleSignInLimiter");
const users = load("users"); const guard = load("authGuard"); const auth = load("auth");
const actionCtx = {
  runMutation(ref, args) {
    const handlers = { reserve: limiter.reserveSuperuserAttempt, release: limiter.releaseSuccessfulSuperuserAttempt, provision: access.provisionVerifiedEmployeeAccess };
    assert.ok(ref in handlers);
    const result = mutationTail.then(() => handlers[ref].handler(ctx, args)); mutationTail = result.catch(() => {}); return result;
  },
  runQuery(ref, args) {
    if (ref === "access") return access.assertUserAccess.handler(ctx, args);
    if (ref === "role") return users.getUserRole.handler(ctx, args);
    throw new Error(`Unexpected query ${ref}`);
  },
  runAction(ref, args) { assert.equal(ref, "validate"); return auth.validateRoleSelection.handler(actionCtx, args); },
};
const provider = config.providers.find(p => p.id === "vitros-role");
const enter = params => provider.authorize(params, actionCtx);
const limit = () => [...rows.values()].find(row => row.key === "superuser");
const wrong = () => auth.validateRoleSelection.handler(actionCtx, { role: "superuser", secret: "synthetic-wrong-secret" });
const correct = () => auth.validateRoleSelection.handler(actionCtx, { role: "superuser", secret: "synthetic-correct-secret" });
let checks = 0;
async function test(name, callback) { await callback(); checks++; console.log(`PASS ${name}`); }

await test("Engineer enters without credentials or provider fetch and caller identity claims are ignored", async () => {
  const result = await enter({ role: "engineer", accountId: "superuser", employeeId: employee.id, name: "Impostor", sharedEngineer: false });
  actorId = result.userId;
  assert.equal(fetchCalls, 0); assert.equal(verifierCalls, 0);
  const projected = await auth.currentUser.handler(ctx, {});
  assert.equal(projected.role, "engineer"); assert.equal(projected.name, identity.SHARED_ENGINEER_NAME);
  const audit = await users.getUserAuditIdentity.handler(ctx, { userId: actorId }); assert.equal(audit.employeeId, null);
  assert.equal([...rows.values()].filter(row => row._id.startsWith("employeeAccessBarriers:")).length, 0);
});
const sharedUserId = actorId;
await test("poisoned shared profiles and existing accounts cannot acquire admin privileges or employee attribution", async () => {
  await db.patch(actorId, { role: "superuser", name: "Impostor", employeeId: employee.id });
  assert.equal((await enter({ role: "engineer" })).userId, sharedUserId, "existing account skips profile callback");
  for (const context of [ctx, actionCtx]) {
    await guard.requireCapability(context, "inventory.read"); await guard.requireCapability(context, "rem.write");
    for (const capability of ["inventory.admin", "admin.users.manage", "admin.system_settings.manage"]) await assert.rejects(guard.requireCapability(context, capability), /Missing capability/);
  }
  assert.equal((await auth.currentUser.handler(ctx, {})).role, "engineer");
  const audit = await users.getUserAuditIdentity.handler(ctx, { userId: actorId });
  assert.equal(audit.name, identity.SHARED_ENGINEER_NAME); assert.equal(audit.employeeId, null); assert.equal(audit.role, "engineer");
  await assert.rejects(users.updateMyProfile.handler(ctx, { name: "Impostor" }), /disabled/);
});
await test("explicit invalid or inactive employee initials never fall back to shared access", async () => {
  for (const initials of ["", "ABCDE", "A B", null, {}, 17]) await assert.rejects(enter({ role: "engineer", initials }), /initials are invalid/);
  await assert.rejects(enter({ role: "engineer", initials: "AB" }), /not active or are ambiguous/);
  await assert.rejects(enter({ role: "administrator" }), /Invalid VITROS role/);
});
await test("named employee access barriers and retired generic sessions remain enforced", async () => {
  providerActive = true; const named = await enter({ role: "engineer", initials: "AB" }); actorId = named.userId;
  const barrier = [...rows.values()].find(row => row._id.startsWith("employeeAccessBarriers:"));
  await guard.requireCapability(ctx, "inventory.write"); await db.patch(barrier._id, { blocked: true });
  await assert.rejects(guard.requireCapability(ctx, "inventory.write"), /suspended/);
  await assert.rejects(enter({ role: "engineer", initials: "AB" }), /suspended/);
  actorId = await db.insert("users", { role: "engineer" });
  await db.insert("authAccounts", { userId: actorId, provider: "vitros-role", providerAccountId: "engineer:generic" });
  await assert.rejects(guard.requireCapability(actionCtx, "inventory.read"), /fresh canonical/);
  actorId = sharedUserId; await guard.requireCapability(actionCtx, "inventory.read");
});
await test("missing config and empty secrets fail without creating authority", async () => {
  const hash = env.VITROS_SUPERUSER_PASSWORD_HASH; delete env.VITROS_SUPERUSER_PASSWORD_HASH;
  await assert.rejects(correct(), /not configured/); env.VITROS_SUPERUSER_PASSWORD_HASH = hash;
  for (const secret of ["", "x".repeat(257)]) await assert.rejects(auth.validateRoleSelection.handler(actionCtx, { role: "superuser", secret }), /verification failed/);
  assert.equal(limit(), undefined);
});
await test("failed custom credential verification reserves and retains attempts; only success refunds itself", async () => {
  await assert.rejects(wrong(), /verification failed/); assert.equal(limit().reservations.length, 1);
  assert.equal((await correct()).role, "superuser"); assert.equal(limit().reservations.length, 1);
  env.VITROS_SUPERUSER_PASSWORD_HASH = "synthetic-malformed";
  await assert.rejects(correct(), /verification failed/); assert.equal(limit().reservations.length, 2);
  env.VITROS_SUPERUSER_PASSWORD_HASH = "synthetic-hash";
});
await test("concurrent credential attempts obey the six-slot atomic mutation budget", async () => {
  const before = verifierCalls;
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, wrong));
  assert.equal(attempts.filter(x => x.status === "rejected").length, 20);
  assert.equal(verifierCalls - before, 4); assert.equal(limit().reservations.length, 6);
  const exhausted = verifierCalls; await assert.rejects(correct(), /verification failed/); assert.equal(verifierCalls, exhausted);
});
await test("expiry recovers access and late prior-window success cannot refill the new budget", async () => {
  const old = { windowStartedAt: limit().windowStartedAt, reservationId: limit().reservations[0] };
  now += 60 * 60 * 1000;
  await assert.rejects(wrong(), /verification failed/); assert.equal(limit().reservations.length, 1);
  await actionCtx.runMutation("release", old); assert.equal(limit().reservations.length, 1);
  await actionCtx.runMutation("release", { windowStartedAt: limit().windowStartedAt, reservationId: "unissued" }); assert.equal(limit().reservations.length, 1);
  const signedIn = await enter({ role: "superuser", secret: "synthetic-correct-secret" }); actorId = signedIn.userId;
  await guard.requireCapability(ctx, "inventory.admin"); assert.equal(limit().reservations.length, 1);
  actorId = null; await assert.rejects(guard.requireCapability(ctx, "inventory.read"), /Not authenticated/);
});
console.log(`ROLE_ACCESS_BEHAVIOR=PASS checks=${checks} (production handlers; synthetic auth/storage and atomic mutation dispatch)`);
