import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import ts from "typescript";
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/employeeOperationIdentity.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports, crypto: webcrypto, TextEncoder });
const identity = exports.employeeOperationIdentity;
const original = await identity("actor-one", "ABC", "UPDATE", 4, { initials: " xy ", name: "Test", active: false });
assert.equal(original, await identity("actor-one", "abc", "UPDATE", 4, { active: false, name: "Test", initials: "XY" }));
for (const args of [
 ["actor-two", "ABC", "UPDATE", 4, { initials: "XY", name: "Test", active: false }],
 ["actor-one", "ABC", "UPDATE", 5, { initials: "XY", name: "Test", active: false }],
 ["actor-one", "ABC", "UPDATE", 4, { initials: "XY", name: "Test", active: true }],
 ["actor-one", "ABC", "ACTIVATE", 4],
 ["actor-one", "ABC", "DEACTIVATE", 4],
]) assert.notEqual(original, await identity(...args));
assert.notEqual(await identity("a", "id", "ACTIVATE", 1), await identity("a", "id", "DEACTIVATE", 1));
assert.notEqual(await identity("a", "id", "UPDATE", 1, {}), await identity("a", "id", "UPDATE", 1, { active: false }));
await assert.rejects(identity(undefined, "id", "ACTIVATE", 1), /Sign in/);
assert.match(original, /^employee:v1:[a-f0-9]{64}$/);
console.log("EMPLOYEE_RETRY_IDENTITY=PASS canonical replay, actor/version/payload separation, anonymous rejection");
