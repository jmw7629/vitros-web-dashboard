// Execute the real internal query with a mocked indexed database; no live identity data.
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";

const source = ts.transpileModule(fs.readFileSync("convex/employeeIdentity.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exports = {};
const validators = new Proxy({}, { get: () => () => ({}) });
vm.runInNewContext(source, {
  exports,
  require(path) {
    if (path === "convex/values") return { v: validators };
    if (path === "./_generated/server") return { internalQuery: (definition) => definition };
    throw new Error(`Unexpected dependency ${path}`);
  },
});
const handler = exports.resolveEmployeeActorIds.handler;
let reads = 0;
let accounts = [];
const ctx = { db: { query(table) {
  assert.equal(table, "authAccounts");
  return { withIndex(index, constrain) {
    assert.equal(index, "providerAndAccountId");
    const conditions = [];
    const q = { eq(...args) { conditions.push(args); return q; } };
    constrain(q);
    assert.deepEqual(conditions[0], ["provider", "vitros-role"]);
    assert.equal(conditions[1][0], "providerAccountId");
    assert.match(conditions[1][1], /^employee:[0-9a-f-]{36}$/);
    return { async take(limit) {
      assert.equal(limit, 2);
      reads += 1;
      return accounts;
    } };
  } };
} } };
const id = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
assert.equal((await handler(ctx, { employeeIds: [] })).length, 0);
assert.equal(reads, 0);
accounts = [{ userId: "verified-actor", secret: "synthetic-never-return", emailVerified: "synthetic-private" }];
const matched = await handler(ctx, { employeeIds: [id, id.toLowerCase()] });
assert.equal(matched.length, 1);
assert.equal(matched[0].employeeId, id.toLowerCase());
assert.equal(matched[0].actorId, "verified-actor");
assert.deepEqual(Object.keys(matched[0]), ["employeeId", "actorId"]);
assert.equal(reads, 1);
accounts = [];
assert.equal((await handler(ctx, { employeeIds: [id] }))[0].actorId, null);
accounts = [{ userId: "one" }, { userId: "two" }];
assert.equal((await handler(ctx, { employeeIds: [id] }))[0].actorId, null);
const beforeInvalid = reads;
await assert.rejects(handler(ctx, { employeeIds: [id, "invalid"] }), /Invalid canonical employee id/);
await assert.rejects(handler(ctx, { employeeIds: Array(501).fill(id) }), /exceeds 500/);
assert.equal(reads, beforeInvalid, "invalid requests must not read account rows");
const ids = Array.from({ length: 500 }, (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`);
accounts = [];
assert.equal((await handler(ctx, { employeeIds: ids })).length, 500);
assert.equal(reads - beforeInvalid, 500, "one bounded indexed lookup per distinct UUID");
console.log("EMPLOYEE_IDENTITY_LOOKUP=PASS");
console.log("EMPTY_DEDUP_CANONICAL_MATCH_MISSING_AMBIGUOUS=PASS");
console.log("MAX500_INVALID_BEFORE_DATABASE_NO_SECRET_FIELDS=PASS");
