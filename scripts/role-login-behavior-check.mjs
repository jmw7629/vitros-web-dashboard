// Executes the production RoleLogin component with real React. Auth, routing,
// role hints and the dialog portal are synthetic boundaries. Native browser
// keyboard/focus behavior and live server authentication require separate checks.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(process.env.VITROS_TEST_NODE_MODULES
  ? path.join(path.resolve(process.env.VITROS_TEST_NODE_MODULES), "test-entry.cjs")
  : import.meta.url);
const ts = require("typescript");
const React = require("react");
const { create, act } = require("react-test-renderer");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = fs.readFileSync(new URL("../src/pages/RoleLogin.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  fileName: "RoleLogin.tsx",
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
const Dialog = ({ open, children }) => open ? React.createElement("div", { "data-dialog-root": true }, children) : null;
const DialogContent = props => React.createElement("section", { ...props, role: "dialog" });
const DialogTitle = props => React.createElement("h2", props);
const DialogDescription = props => React.createElement("p", props);
const Icon = () => React.createElement("svg", { "aria-hidden": true });


const moduleCache = new Map();
function loadRoleConfig(relative) {
  const url = new URL(relative, import.meta.url);
  if (moduleCache.has(url.href)) return moduleCache.get(url.href).exports;
  const module = { exports: {} }; moduleCache.set(url.href, module);
  const output = ts.transpileModule(fs.readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, require: name => {
    if (name.startsWith(".")) return loadRoleConfig(new URL(name + ".ts", url).href);
    return require(name);
  }, Map, Set, Date, Intl, console });
  return module.exports;
}
const actualRoleRoutes = loadRoleConfig("../src/lib/dashboardRoutes.ts");

async function harness(publishedValues = new Map()) {
  const requests = []; const navigations = []; const roleHints = []; const timeline = []; const focuses = [];
  const imports = {
    "../hooks/useConfig": { useConfig: () => ({ publishedValues }) },
    "../lib/dashboardRoutes": actualRoleRoutes,
    "react-router-dom": { useNavigate: () => destination => { navigations.push(destination); timeline.push("navigate"); } },
    "@convex-dev/auth/react": { useAuthActions: () => ({ signIn: (provider, args) => new Promise((resolve, reject) => {
      requests.push({ provider, args, resolve: result => { timeline.push("auth-resolved"); resolve(result); }, reject });
    }) }) },
    "../hooks/useRole": { useRole: () => ({ setRole: role => { roleHints.push(role); timeline.push("role-hint"); } }) },
    "lucide-react": { Box: Icon, Shield: Icon, Wrench: Icon },
    "../components/ui/dialog": { Dialog, DialogContent, DialogTitle, DialogDescription },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, require: name => Object.hasOwn(imports, name) ? imports[name] : require(name), console,
  }, { filename: "RoleLogin.component-under-test.js" });
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(exports.RoleLogin), { createNodeMock: element => element.type === "button" ? { focus: () => focuses.push("button") } : null });
  });
  const root = () => renderer.root;
  const button = label => {
    const found = root().findAllByType("button").filter(node => text(node).startsWith(label));
    assert.equal(found.length, 1, `Expected one ${label} button`); return found[0];
  };
  const input = () => root().findByType("input");
  const alerts = () => root().findAllByProps({ role: "alert" });
  return {
    root, renderer, button, input, alerts, requests, navigations, roleHints, timeline, focuses,
    click: async label => { await act(async () => button(label).props.onClick()); },
    password: async value => { await act(async () => input().props.onChange({ target: { value } })); },
    settle: async result => { await act(async () => requests.at(-1).resolve(result)); },
    reject: async () => { await act(async () => requests.at(-1).reject(new Error("synthetic private provider detail"))); },
    close: async () => { await act(async () => renderer.unmount()); },
  };
}
let checks = 0;
async function test(name, run) { await run(); checks++; console.log(`PASS ${name}`); }

await test("Engineer requires active employee initials before authentication", async () => {
  const h = await harness();
  assert.equal(h.requests.length, 0, "mount must not sign in automatically");
  assert.equal(h.button("Engineer").props.type, "button");
  assert.notEqual(h.button("Engineer").props.tabIndex, -1, "native role button remains keyboard reachable");
  await h.click("Engineer");
  assert.equal(h.requests.length, 0, "opening identity dialog must not authenticate");
  assert.equal(h.root().findAllByProps({ role: "dialog" }).length, 1);
  assert.equal(h.input().props.type, "text");
  assert.equal(h.input().props.autoComplete, "off");
  assert.equal(h.root().findByType("label").props.htmlFor, h.input().props.id);
  await h.password("ab");
  assert.equal(h.input().props.value, "AB");
  await h.click("Continue");
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].provider, "vitros-role");
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].args)), { role: "engineer", initials: "AB" });
  assert.deepEqual(h.navigations, []); assert.deepEqual(h.roleHints, []);
  assert.equal(h.input().props.disabled, true);
  await h.settle({ signingIn: true });
  assert.deepEqual(h.timeline, ["auth-resolved", "role-hint", "navigate"]);
  assert.deepEqual(h.roleHints, ["engineer"]); assert.deepEqual(h.navigations, ["/engineer-dashboard"]);
  assert.equal(h.root().findAllByProps({ role: "dialog" }).length, 0); await h.close();
});

await test("Engineer initials are bounded and invalid identity never dispatches", async () => {
  const h = await harness(); await h.click("Engineer");
  await h.click("Continue");
  assert.equal(h.requests.length, 0); assert.equal(h.alerts().length, 1);
  assert.match(text(h.alerts()[0]), /active employee initials/i);
  await h.password("a b-c_12345");
  assert.equal(h.input().props.value, "ABC1", "input keeps only four canonical alphanumerics");
  assert.equal(h.alerts().length, 1, "stale validation stays visible until submit/reopen");
  await h.click("Continue"); assert.equal(h.requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].args)), { role: "engineer", initials: "ABC1" });
  await h.settle({ signingIn: true }); await h.close();
});

await test("same-tick repeated Engineer submission dispatches only once and cannot dismiss in flight", async () => {
  const h = await harness(); await h.click("Engineer"); await h.password("AB");
  const submit = h.button("Continue").props.onClick; const cancel = h.button("Cancel").props.onClick;
  await act(async () => { submit(); submit(); cancel(); });
  assert.equal(h.requests.length, 1); assert.equal(h.button("Verifying").props.disabled, true); assert.equal(h.button("Cancel").props.disabled, true);
  const content = h.root().findByType(DialogContent); let prevented = 0;
  await act(async () => {
    content.props.onEscapeKeyDown({ preventDefault: () => prevented++ });
    content.props.onInteractOutside({ preventDefault: () => prevented++ });
    h.root().findAllByType(Dialog).find(node => node.props.open).props.onOpenChange(false);
  });
  assert.equal(prevented, 2); assert.equal(h.root().findAllByProps({ role: "dialog" }).length, 1);
  await h.settle({ signingIn: true }); assert.deepEqual(h.navigations, ["/engineer-dashboard"]); await h.close();
});

await test("Engineer provider rejection exposes safe retry without assigning a role", async () => {
  const h = await harness(); await h.click("Engineer"); await h.password("AB"); await h.click("Continue"); await h.reject();
  assert.deepEqual(h.navigations, []); assert.deepEqual(h.roleHints, []); assert.equal(h.alerts().length, 1);
  assert.match(text(h.alerts()[0]), /Unable to verify active employee initials/); assert(!text(h.root()).includes("private provider detail"));
  assert.equal(h.input().props["aria-describedby"], h.alerts()[0].props.id);
  assert.equal(h.input().props.disabled, false);
  await h.click("Continue"); assert.equal(h.requests.length, 2);
  await h.settle({ signingIn: true }); assert.deepEqual(h.navigations, ["/engineer-dashboard"]); await h.close();
});

await test("resolved incomplete Engineer authentication never navigates", async () => {
  for (const result of [{ signingIn: false }, {}, undefined, null, { signingIn: "true" }]) {
    const h = await harness(); await h.click("Engineer"); await h.password("AB"); await h.click("Continue"); await h.settle(result);
    assert.deepEqual(h.navigations, []); assert.deepEqual(h.roleHints, []); assert.equal(h.alerts().length, 1); await h.close();
  }
});

await test("Superuser password remains a server credential and navigation waits for successful authentication", async () => {
  const h = await harness(); await h.click("Superuser");
  assert.equal(h.requests.length, 0); assert.equal(h.root().findAllByProps({ role: "dialog" }).length, 1);
  assert.equal(h.input().props.type, "password"); assert.equal(h.input().props.autoComplete, "current-password");
  assert.equal(h.root().findByType("label").props.htmlFor, h.input().props.id);
  await h.password("synthetic-auth-fixture"); await h.click("Login");
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].provider, "vitros-role");
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].args)), { role: "superuser", secret: "synthetic-auth-fixture" });
  assert.deepEqual(h.navigations, []); assert.deepEqual(h.roleHints, []); assert.equal(h.input().props.disabled, true);
  assert.equal(h.button("Verifying").props.disabled, true); assert.equal(h.button("Cancel").props.disabled, true);
  await h.settle({ signingIn: true }); assert.deepEqual(h.timeline, ["auth-resolved", "role-hint", "navigate"]);
  assert.deepEqual(h.roleHints, ["superuser"]); assert.deepEqual(h.navigations, ["/dashboard"]); assert.equal(h.root().findAllByType("input").length, 0); await h.close();
});

await test("wrong Superuser credential and incomplete authentication keep the dialog open without navigation", async () => {
  const h = await harness(); await h.click("Superuser"); await h.password("synthetic-rejected-fixture"); await h.click("Login"); await h.reject();
  assert.deepEqual(h.navigations, []); assert.deepEqual(h.roleHints, []); assert.equal(h.alerts().length, 1);
  assert.equal(text(h.alerts()[0]), "Superuser verification failed"); assert.equal(h.input().props["aria-invalid"], true);
  assert.equal(h.input().props["aria-describedby"], h.alerts()[0].props.id); assert(!text(h.root()).includes("private provider detail"));
  await h.click("Login"); await h.settle({ signingIn: false }); assert.deepEqual(h.navigations, []);
  assert.equal(h.root().findAllByProps({ role: "dialog" }).length, 1); assert.equal(h.input().props.disabled, false); await h.close();
});

await test("Enter submission, repeated keyboard events and dialog dismissal respect the in-flight guard", async () => {
  const h = await harness(); await h.click("Superuser"); await h.password("synthetic-keyboard-fixture");
  const keydown = h.input().props.onKeyDown; const login = h.button("Login").props.onClick; const cancel = h.button("Cancel").props.onClick;
  let prevented = 0;
  await act(async () => { keydown({ key: "a", preventDefault: () => prevented++ }); }); assert.equal(h.requests.length, 0);
  await act(async () => {
    keydown({ key: "Enter", preventDefault: () => prevented++ });
    keydown({ key: "Enter", preventDefault: () => prevented++ }); login(); cancel();
  });
  assert.equal(h.requests.length, 1); assert.equal(prevented, 2);
  const content = h.root().findByType(DialogContent);
  const onCloseAutoFocus = content.props.onCloseAutoFocus;
  await act(async () => {
    content.props.onEscapeKeyDown({ preventDefault: () => prevented++ });
    content.props.onInteractOutside({ preventDefault: () => prevented++ });
    h.root().findAllByType(Dialog).find(node => node.props.open).props.onOpenChange(false);
  });
  assert.equal(prevented, 4); assert.equal(h.root().findAllByProps({ role: "dialog" }).length, 1);
  await h.reject(); await h.click("Cancel"); assert.equal(h.root().findAllByProps({ role: "dialog" }).length, 0);
  await act(async () => onCloseAutoFocus({ preventDefault: () => prevented++ }));
  assert.equal(h.focuses.length, 1, "dialog close requests focus restoration to its native trigger"); await h.close();
});

await test("empty Superuser input never dispatches and reopening clears stale errors and credentials", async () => {
  const h = await harness(); await h.click("Superuser"); await h.click("Login");
  assert.equal(h.requests.length, 0); assert.equal(h.alerts().length, 1);
  await h.password("synthetic-cancelled-fixture"); await h.click("Cancel"); await h.click("Superuser");
  assert.equal(h.input().props.value, ""); assert.equal(h.alerts().length, 0); await h.close();
});


await test("Superuser login follows the validated published default route", async () => {
  const h = await harness(new Map([["roles.superuserDefaultRoute", "/stock-summary"]]));
  await h.click("Superuser"); await h.password("synthetic-auth-fixture"); await h.click("Login");
  assert.deepEqual(h.navigations, []);
  await h.settle({ signingIn: true }); assert.deepEqual(h.navigations, ["/stock-summary"]);
  await h.close();
});

console.log(`ROLE_LOGIN_BEHAVIOR=PASS checks=${checks} (real React component; synthetic auth/dialog boundaries)`);
