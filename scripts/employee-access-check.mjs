// Synthetic execution of production barrier/guard handlers. No provider or business writes.
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";
const v = new Proxy({}, { get: () => () => ({}) });
function load(path, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  } });
  return exports;
}
const access = load("convex/employeeAccess.ts", {
  "convex/values": { v }, "./_generated/server": { internalMutation: x => x, internalQuery: x => x },
});
const rows = new Map();
let sequence = 0;
const ctx = { db: {
  async get(id) { return rows.get(id) ?? null; },
  async delete(id) { rows.delete(id); },
  async insert(table, values) { const id = `${table}:${++sequence}`; rows.set(id, { ...values, _id: id }); return id; },
  async patch(id, values) { rows.set(id, { ...rows.get(id), ...values }); },
  query(table) { return { withIndex(_index, constrain) {
    const predicates = [];
    const q = { eq(key, value) { predicates.push([key, value]); return q; } };
    constrain(q);
    return { async unique() {
      const matches = [...rows.values()].filter(row => row._id.startsWith(`${table}:`) && predicates.every(([key, value]) => row[key] === value));
      assert.ok(matches.length < 2, "indexed uniqueness");
      return matches[0] ?? null;
    } };
  } }; },
} };
const employeeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = await ctx.db.insert("users", { role: "engineer" });
await ctx.db.insert("authAccounts", { userId: actor, provider: "vitros-role", providerAccountId: `employee:${employeeId}` });
const internal = { employeeAccess: { assertUserAccess: "access" }, users: { getUserRole: "role" } };
const guard = load("convex/authGuard.ts", {
  "@convex-dev/auth/server": { getAuthUserId: async () => actor },
  "./employeeAccess": access, "./_generated/api": { internal },
});
const actionCtx = { async runQuery(ref, args) {
  if (ref === "access") return access.assertUserAccess.handler(ctx, args);
  if (ref === "role") return (await ctx.db.get(args.userId)).role;
  throw new Error("Unexpected query");
} };
const begin = (correlationId, expectedVersion, requestKey = correlationId) => access.beginTransition.handler(ctx, { employeeId, correlationId, expectedVersion, requestKey });
const complete = (operationId, version, active) => access.completeTransition.handler(ctx, { operationId, employeeId, version, active });
const blocked = () => assert.rejects(access.assertEmployeeAccess(ctx, employeeId), /suspended/);
await assert.rejects(guard.requireCapability(ctx, "rem.write"), /suspended/);
await access.provisionVerifiedEmployeeAccess.handler(ctx, { employeeId });
await guard.requireCapability(ctx, "rem.write");
await guard.requireCapability(actionCtx, "inventory.write");
const deactivation = await begin("deactivate", 1);
await blocked();
await assert.rejects(guard.requireCapability(ctx, "rem.write"), /suspended/);
await assert.rejects(guard.requireCapability(actionCtx, "inventory.write"), /suspended/);
await assert.rejects(begin("other", 1), /Retry the original request/);
await assert.rejects(begin("deactivate", 1, "changed"), /different employee change/);
assert.equal(await begin("deactivate", 1), deactivation);
await access.rejectTransition.handler(ctx, { operationId: deactivation });
await blocked(); // another invocation may still commit
await complete(deactivation, 2, false);
await blocked(); // confirmed deactivation denies existing sessions
const activation = await begin("activate", 2);
await blocked(); // concurrent sign-in cannot grant access while SQL is pending
await assert.rejects(access.provisionVerifiedEmployeeAccess.handler(ctx, { employeeId }), /suspended/);
await assert.rejects(complete(activation, 4, true), /matching committed receipt/);
await blocked();
await complete(activation, 3, true);
await access.assertEmployeeAccess(ctx, employeeId);
await guard.requireCapability(ctx, "rem.write");
// Old completed replay cannot undo a newer deactivation or clear its pending state.
const nextDeactivation = await begin("deactivate-next", 3);
assert.equal(await begin("activate", 2), activation);
await complete(activation, 3, true);
await blocked();
await complete(nextDeactivation, 4, false);
await complete(activation, 3, true);
await blocked();
// A known SQL rollback restores the prior blocked status. Identical corrected retry
// reacquires the barrier, while an opaque/unknown outcome remains pending.
const rejected = await begin("retry", 4);
await access.rejectTransition.handler(ctx, { operationId: rejected });
await blocked();
assert.equal(await begin("retry", 4), rejected);
await blocked();
await complete(rejected, 5, true);
await access.assertEmployeeAccess(ctx, employeeId);
const uncertain = await begin("uncertain", 5);
await assert.rejects(begin("new-after-uncertain", 5), /Retry the original request/);
await blocked();
assert.equal(await begin("uncertain", 5), uncertain);
await complete(uncertain, 6, false);
await blocked();
// Lost version-conflict response leaves one unknown invocation. A verified
// superseding SQL version safely resolves it, without a timeout/counter guess.
const lostConflict = await begin("lost-conflict", 6);
await begin("lost-conflict", 6);
await assert.rejects(access.rejectTransition.handler(ctx, { operationId: lostConflict, supersededVersion: 6 }), /superseding version/);
await blocked();
await access.rejectTransition.handler(ctx, { operationId: lostConflict, supersededVersion: 7 });
assert.equal(rows.get(lostConflict).status, "rejected");
const afterProof = await begin("after-proof", 7);
await access.rejectTransition.handler(ctx, { operationId: lostConflict, supersededVersion: 8 });
await blocked(); // old proof cannot clear the newer pending operation
await complete(afterProof, 8, true);
await access.assertEmployeeAccess(ctx, employeeId);
// An admin edit can reach a rollout employee before their first fresh login.
// Confirmed rollback must restore missing state, not create permanent deactivation.
const rolloutId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rolloutArgs = { employeeId: rolloutId, correlationId: "rollout-failure", requestKey: "rollout-failure", expectedVersion: 1 };
const rolloutOp = await access.beginTransition.handler(ctx, rolloutArgs);
await assert.rejects(access.provisionVerifiedEmployeeAccess.handler(ctx, { employeeId: rolloutId }), /suspended/);
await access.rejectTransition.handler(ctx, { operationId: rolloutOp });
await assert.rejects(access.assertEmployeeAccess(ctx, rolloutId), /suspended/); // absence still denies
assert.equal([...rows.values()].some(row => row._id.startsWith("employeeAccessBarriers:") && row.employeeId === rolloutId), false);
await access.provisionVerifiedEmployeeAccess.handler(ctx, { employeeId: rolloutId });
await access.assertEmployeeAccess(ctx, rolloutId);
// Rejected restart snapshots the current, now-present allowed barrier.
await access.beginTransition.handler(ctx, rolloutArgs);
assert.equal(rows.get(rolloutOp).previousMissing, false);
await access.rejectTransition.handler(ctx, { operationId: rolloutOp });
await access.assertEmployeeAccess(ctx, rolloutId);
// A previously confirmed block survives failed edits and cannot be provisioned away.
const blockRollout = await access.beginTransition.handler(ctx, { ...rolloutArgs, correlationId: "rollout-deactivate", requestKey: "rollout-deactivate" });
await access.completeTransition.handler(ctx, { operationId: blockRollout, employeeId: rolloutId, version: 2, active: false });
const blockedEdit = await access.beginTransition.handler(ctx, { ...rolloutArgs, correlationId: "blocked-edit", requestKey: "blocked-edit", expectedVersion: 2 });
await access.rejectTransition.handler(ctx, { operationId: blockedEdit });
await assert.rejects(access.provisionVerifiedEmployeeAccess.handler(ctx, { employeeId: rolloutId }), /suspended/);
// A single future-version SQL rejection releases its pending barrier, but a
// prior unknown invocation remains blocked when the known current call rejects.
const futureOne = await begin("future-one", 99);
await access.rejectTransition.handler(ctx, { operationId: futureOne });
await access.assertEmployeeAccess(ctx, employeeId);
const futureUnknown = await begin("future-unknown", 99);
await begin("future-unknown", 99);
await access.rejectTransition.handler(ctx, { operationId: futureUnknown });
await blocked();
assert.equal(rows.get(futureUnknown).inFlight, 1);
console.log("MISSING_BARRIER_ROLLBACK_RESTART_AND_CONFIRMED_BLOCK=PASS");
console.log("EMPLOYEE_ACCESS_BARRIER=PASS");
console.log("EXISTING_SESSIONS_PENDING_SIGNIN_GUARDS_CORRELATION_REPLAY_RECOVERY=PASS");
console.log("CONCURRENT_SAME_REQUEST_REJECTION_CANNOT_RELEASE_PENDING_WRITE=PASS");
console.log("NOTE=synthetic interleavings; production Convex OCC and live database deployment remain separate gates");
