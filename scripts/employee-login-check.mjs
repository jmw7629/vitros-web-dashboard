// Executes the real Convex auth boundary with synthetic RPC responses.
// SQL behavior is separately exercised by database/tests/employee_login.sql.
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";
const exports = {};
let authConfig;
let createAccountCalls = 0;
let accessDenied = false;
const accessChecks = [];
let fetchCalls = 0;
let responseRows = [];
let responseOk = true;
const validators = new Proxy({}, { get: () => () => ({}) });
const source = ts.transpileModule(fs.readFileSync("convex/auth.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(source, {
  exports,
  process: { env: { SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-key" } },
  require(path) {
    if (path === "convex/values") return { v: validators };
    if (path === "./_generated/server") return { internalAction: x => x, query: x => x };
    if (path === "./_generated/api") return { internal: { auth: { validateRoleSelection: "validate-role" }, employeeAccess: { assertUserAccess: "assert-user-access", provisionVerifiedEmployeeAccess: "provision-verified-access" } } };
    if (path === "@convex-dev/auth/server") return { convexAuth: config => { authConfig = config; return {}; }, async createAccount() { createAccountCalls++; return { user: { _id: "existing-user" } }; }, getAuthUserId() {} };
    if (path === "@convex-dev/auth/providers/Password") return { Password: x => x };
    if (path === "@convex-dev/auth/providers/ConvexCredentials") return { ConvexCredentials: x => x };
    if (path === "lucia") return { Scrypt: class {} };
    if (path === "./testAuth" || path === "./ViktorSpacesEmail") return {};
    if (path === "./employeeAccess") return { assertEmployeeAccess: async (_ctx, id) => { accessChecks.push(id); if (accessDenied) throw new Error("Employee access blocked"); } };
    throw new Error(`Unexpected dependency ${path}`);
  },
  async fetch(url, options) {
    fetchCalls++;
    assert.equal(url, "https://synthetic.invalid/rest/v1/rpc/resolve_active_employee_login");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(options.headers.Authorization, "Bearer synthetic-key");
    assert.deepEqual(JSON.parse(options.body), { p_initials: "AB" });
    return { ok: responseOk, json: async () => responseRows };
  },
});
const login = initials => exports.validateRoleSelection.handler({}, { role: "engineer", initials });
const employee = { id: "11111111-1111-1111-1111-111111111111", name: "Synthetic AB", initials: "AB", active: true };
responseRows = [employee];
const identity = await login(" ab ");
assert.equal(identity.accountId, `employee:${employee.id}`);
assert.equal(identity.name, employee.name);
assert.equal(identity.role, "engineer");
assert.deepEqual(Object.keys(identity).sort(), ["accountId", "name", "role"]);
for (const rows of [[], [employee, employee], [{ ...employee, active: false }], [{ ...employee, active: null }], [{ ...employee, initials: "ZZ" }], [{ ...employee, id: "bad-id" }], [{ ...employee, name: " " }], {}]) {
  responseRows = rows;
  await assert.rejects(login("AB"), /not active or are ambiguous/);
}
const beforeInvalid = fetchCalls;
for (const initials of ["", "ABCDE", "A B", "A*", "AB&active=true"]) {
  await assert.rejects(login(initials), /initials are invalid/);
}
assert.equal(fetchCalls, beforeInvalid);
responseOk = false;
await assert.rejects(login("AB"), /identity verification is unavailable/);
console.log("EMPLOYEE_CANONICAL_LOGIN_BOUNDARY=PASS");
console.log("INVALID_AMBIGUOUS_INACTIVE_MISMATCH_PROVIDER_FAILURE=PASS");

const callback = authConfig.callbacks.afterUserCreatedOrUpdated;
const patches = [];
const ctx = { db: { patch: async (id, patch) => patches.push({ id, patch }) } };
const args = { provider: { id: "vitros-role" }, userId: "synthetic-user", profile: { name: "Synthetic AB", role: "engineer", employeeId: employee.id } };
await callback(ctx, args);
assert.equal(patches.length, 1);
assert.equal(patches[0].patch.employeeId, employee.id);
assert.equal(accessChecks[0], employee.id);
accessDenied = true;
await assert.rejects(callback(ctx, args), /Employee access blocked/);
assert.equal(patches.length, 1, "blocked identity cannot acquire role");
await assert.rejects(callback(ctx, { ...args, profile: { name: "Synthetic", role: "engineer" } }), /Invalid server-issued employee identity/);
assert.equal(patches.length, 1);
const beforeSuperuser = accessChecks.length;
await callback(ctx, { ...args, profile: { name: "Superuser", role: "superuser" } });
assert.equal(patches.length, 2);
assert.equal(accessChecks.length, beforeSuperuser);
console.log("EMPLOYEE_LOGIN_CALLBACK_BARRIER=PASS");

// Installed Convex Auth returns existing accounts without the profile callback.
// Exercise that path explicitly; only the post-createAccount query can deny it.
const provider = authConfig.providers.find(provider => provider.id === "vitros-role");
let existingDenied = true;
let verificationDenied = false;
let provisionDenied = false;
const provisionChecks = [];
const postAccountChecks = [];
const authorizeCtx = {
  async runAction(ref) {
    assert.equal(ref, "validate-role");
    if (verificationDenied) throw new Error("Employee initials are not active or are ambiguous");
    return identity;
  },
  async runMutation(ref, args) {
    assert.equal(ref, "provision-verified-access");
    assert.equal(args.employeeId, employee.id);
    provisionChecks.push(args.employeeId);
    if (provisionDenied) throw new Error("Employee access is suspended");
  },
  async runQuery(ref, args) {
    assert.equal(ref, "assert-user-access");
    assert.equal(args.userId, "existing-user");
    assert.ok(createAccountCalls > 0);
    postAccountChecks.push(args.userId);
    if (existingDenied) throw new Error("Employee access is suspended");
  },
};
const callbackChecksBefore = accessChecks.length;
await assert.rejects(provider.authorize({ role: "engineer", initials: "AB" }, authorizeCtx), /Employee access is suspended/);
assert.equal(accessChecks.length, callbackChecksBefore, "existing-account mock must skip profile callback");
assert.equal(postAccountChecks.length, 1);
existingDenied = false;
assert.equal((await provider.authorize({ role: "engineer", initials: "AB" }, authorizeCtx)).userId, "existing-user");
assert.equal(postAccountChecks.length, 2);
console.log("EMPLOYEE_EXISTING_ACCOUNT_LOGIN_BARRIER=PASS");

assert.equal(provisionChecks.length, 2, "verified active login provisions before either new/existing account resolution");
const accountCount = createAccountCalls;
provisionDenied = true;
await assert.rejects(provider.authorize({ role: "engineer", initials: "AB" }, authorizeCtx), /Employee access is suspended/);
assert.equal(createAccountCalls, accountCount, "blocked/pending access cannot proceed to account resolution");
const provisionsBeforeInactive = provisionChecks.length;
verificationDenied = true;
await assert.rejects(provider.authorize({ role: "engineer", initials: "AB" }, authorizeCtx), /not active or are ambiguous/);
assert.equal(provisionChecks.length, provisionsBeforeInactive, "inactive or ambiguous identity cannot provision a barrier");
assert.equal(createAccountCalls, accountCount);
console.log("EMPLOYEE_VERIFIED_LOGIN_PROVISION_ORDER=PASS");
