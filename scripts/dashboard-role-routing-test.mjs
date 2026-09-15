/**
 * Dashboard role routing behavior tests.
 *
 * Transpiles and loads actual TS modules via concatenated bundle,
 * then exercises configContract, configDefaults, and dashboardRoutes functions.
 *
 * Run: node scripts/dashboard-role-routing-test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

// ─── Bundle TS modules into single transpiled unit ─────────────────────

const configDefaultsSrc = fs.readFileSync("convex/configDefaults.ts", "utf8");
const configContractSrc = fs.readFileSync("convex/configContract.ts", "utf8");
const dashboardRoutesSrc = fs.readFileSync("src/lib/dashboardRoutes.ts", "utf8");

// Replace import/export statements to create a single bundle
function stripImportsExports(code) {
  return code
    .replace(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export\s+/gm, "");
}

const defaultsClean = stripImportsExports(configDefaultsSrc);
const contractClean = stripImportsExports(configContractSrc);
const routesClean = stripImportsExports(dashboardRoutesSrc);

// Build a single file: defaults first, then contract (which references defaults), then routes
const bundle = `
${defaultsClean}
${contractClean}
${routesClean}

// Re-export everything needed for tests
export {
  ROLE_ROUTE_DEFAULTS,
  CONFIG_ENTRIES,
  ALL_CONFIG_KEYS,
  getConfigEntry,
  validateConfigValue,
  getRoleDefaultRoute,
  getAllRoleDefaultRoutes,
  isRouteAccessibleByRole,
  filterNavItemsForRole,
  ROLE_ROUTE_KEYS,
};
`;

const transpiled = ts.transpileModule(bundle, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const mod = await import(
  "data:text/javascript;base64," + Buffer.from(transpiled).toString("base64")
);

const {
  ROLE_ROUTE_DEFAULTS,
  CONFIG_ENTRIES,
  ALL_CONFIG_KEYS,
  getConfigEntry,
  validateConfigValue,
  getRoleDefaultRoute,
  getAllRoleDefaultRoutes,
  isRouteAccessibleByRole,
  filterNavItemsForRole,
  ROLE_ROUTE_KEYS,
} = mod;

test("AI administration is restricted to Superuser", () => {
  assert.equal(isRouteAccessibleByRole("/ai-administration", "superuser"), true);
  assert.equal(isRouteAccessibleByRole("/ai-administration", "engineer"), false);
  assert.equal(isRouteAccessibleByRole("/ai-administration", "viewer"), false);
});

// ─── 1. configDefaults ROLE_ROUTE_DEFAULTS ─────────────────────────────

console.log("\n[1] ROLE_ROUTE_DEFAULTS values");

test("superuserDefaultRoute is /dashboard", () => {
  assert.equal(ROLE_ROUTE_DEFAULTS.superuserDefaultRoute, "/dashboard");
});

test("engineerDefaultRoute is /engineer-dashboard", () => {
  assert.equal(ROLE_ROUTE_DEFAULTS.engineerDefaultRoute, "/engineer-dashboard");
});

test("viewerDefaultRoute is /dashboard", () => {
  assert.equal(ROLE_ROUTE_DEFAULTS.viewerDefaultRoute, "/dashboard");
});

test("no enterprise-dashboard in role route defaults", () => {
  assert.notEqual(ROLE_ROUTE_DEFAULTS.superuserDefaultRoute, "/enterprise-dashboard");
  assert.notEqual(ROLE_ROUTE_DEFAULTS.engineerDefaultRoute, "/enterprise-dashboard");
  assert.notEqual(ROLE_ROUTE_DEFAULTS.viewerDefaultRoute, "/enterprise-dashboard");
});

// ─── 2. configContract validateConfigValue for role route keys ──────────

console.log("\n[2] validateConfigValue accepts role route keys");

test("validates superuserDefaultRoute with known route", () => {
  const r = validateConfigValue("roles.superuserDefaultRoute", "/dashboard");
  assert.equal(r.valid, true, JSON.stringify(r));
});

test("validates engineerDefaultRoute with known route", () => {
  const r = validateConfigValue("roles.engineerDefaultRoute", "/engineer-dashboard");
  assert.equal(r.valid, true, JSON.stringify(r));
});

test("validates viewerDefaultRoute with known route", () => {
  const r = validateConfigValue("roles.viewerDefaultRoute", "/dashboard");
  assert.equal(r.valid, true, JSON.stringify(r));
});

test("rejects non-string value for role route", () => {
  const r = validateConfigValue("roles.superuserDefaultRoute", 123);
  assert.equal(r.valid, false);
  assert.ok(r.error);
});

test("rejects empty string for role route", () => {
  const r = validateConfigValue("roles.engineerDefaultRoute", "");
  assert.equal(r.valid, false);
});

// ─── 3. configContract CONFIG_ENTRIES has role route entries ─────────────

console.log("\n[3] CONFIG_ENTRIES has role route entries");

test("roles.superuserDefaultRoute entry exists with correct metadata", () => {
  const e = getConfigEntry("roles.superuserDefaultRoute");
  assert.ok(e, "entry must exist");
  assert.equal(e.category, "roles");
  assert.equal(e.valueType, "string");
  assert.equal(e.public, true);
});

test("roles.engineerDefaultRoute entry exists with correct metadata", () => {
  const e = getConfigEntry("roles.engineerDefaultRoute");
  assert.ok(e, "entry must exist");
  assert.equal(e.category, "roles");
  assert.equal(e.valueType, "string");
  assert.equal(e.public, true);
});

test("roles.viewerDefaultRoute entry exists with correct metadata", () => {
  const e = getConfigEntry("roles.viewerDefaultRoute");
  assert.ok(e, "entry must exist");
  assert.equal(e.category, "roles");
  assert.equal(e.valueType, "string");
  assert.equal(e.public, true);
});

test("all three role route keys in ALL_CONFIG_KEYS", () => {
  assert.ok(ALL_CONFIG_KEYS.includes("roles.superuserDefaultRoute"), "superuser key present");
  assert.ok(ALL_CONFIG_KEYS.includes("roles.engineerDefaultRoute"), "engineer key present");
  assert.ok(ALL_CONFIG_KEYS.includes("roles.viewerDefaultRoute"), "viewer key present");
});

// ─── 4. getRoleDefaultRoute behavior ────────────────────────────────────

console.log("\n[4] getRoleDefaultRoute resolution");

test("returns /engineer-dashboard for engineer with empty config", () => {
  const r = getRoleDefaultRoute("engineer", new Map());
  assert.equal(r, "/engineer-dashboard");
});

test("returns /dashboard for superuser with empty config", () => {
  const r = getRoleDefaultRoute("superuser", new Map());
  assert.equal(r, "/dashboard");
});

test("returns /dashboard for viewer with empty config", () => {
  const r = getRoleDefaultRoute("viewer", new Map());
  assert.equal(r, "/dashboard");
});

test("uses published config value when valid", () => {
  const published = new Map([["roles.engineerDefaultRoute", "/engineer-dashboard"]]);
  const r = getRoleDefaultRoute("engineer", published);
  assert.equal(r, "/engineer-dashboard");
});

test("rejects engineer-configured /enterprise-dashboard (inaccessible)", () => {
  const published = new Map([["roles.engineerDefaultRoute", "/enterprise-dashboard"]]);
  const r = getRoleDefaultRoute("engineer", published);
  assert.equal(r, "/engineer-dashboard", "must fall back to safe default");
});

test("rejects engineer-configured /sap-staging (inaccessible)", () => {
  const published = new Map([["roles.engineerDefaultRoute", "/sap-staging"]]);
  const r = getRoleDefaultRoute("engineer", published);
  assert.equal(r, "/engineer-dashboard", "must fall back to safe default");
});

test("rejects invalid/unknown route string", () => {
  const published = new Map([["roles.superuserDefaultRoute", "/nonexistent-page"]]);
  const r = getRoleDefaultRoute("superuser", published);
  assert.equal(r, "/dashboard", "must fall back to safe default");
});

test("overlay takes priority over published", () => {
  const published = new Map([["roles.superuserDefaultRoute", "/engineer-dashboard"]]);
  const overlay = new Map([["roles.superuserDefaultRoute", "/dashboard"]]);
  const r = getRoleDefaultRoute("superuser", published, overlay);
  assert.equal(r, "/dashboard");
});

test("overlay rejected if inaccessible for role", () => {
  const overlay = new Map([["roles.engineerDefaultRoute", "/enterprise-dashboard"]]);
  const r = getRoleDefaultRoute("engineer", new Map(), overlay);
  assert.equal(r, "/engineer-dashboard", "must fall back to safe default");
});

// ─── 5. getAllRoleDefaultRoutes ──────────────────────────────────────────

console.log("\n[5] getAllRoleDefaultRoutes");

test("returns correct defaults for all roles", () => {
  const r = getAllRoleDefaultRoutes(new Map());
  assert.equal(r.superuser, "/dashboard");
  assert.equal(r.engineer, "/engineer-dashboard");
  assert.equal(r.viewer, "/dashboard");
});

// ─── 6. isRouteAccessibleByRole behavior ────────────────────────────────

console.log("\n[6] isRouteAccessibleByRole");

test("superuser can access all routes", () => {
  for (const route of ["/dashboard", "/enterprise-dashboard", "/sap-staging", "/sap-analytics", "/scan-kiosk"]) {
    assert.ok(isRouteAccessibleByRole(route, "superuser"), `superuser must access ${route}`);
  }
});

test("engineer blocked from /enterprise-dashboard", () => {
  assert.equal(isRouteAccessibleByRole("/enterprise-dashboard", "engineer"), false);
});

test("engineer blocked from /sap-staging", () => {
  assert.equal(isRouteAccessibleByRole("/sap-staging", "engineer"), false);
});

test("engineer blocked from /sap-analytics", () => {
  assert.equal(isRouteAccessibleByRole("/sap-analytics", "engineer"), false);
});

test("engineer allowed on /scan-kiosk", () => {
  assert.ok(isRouteAccessibleByRole("/scan-kiosk", "engineer"));
});

test("engineer allowed on /engineer-dashboard", () => {
  assert.ok(isRouteAccessibleByRole("/engineer-dashboard", "engineer"));
});

test("engineer allowed on /dashboard", () => {
  assert.ok(isRouteAccessibleByRole("/dashboard", "engineer"));
});

test("viewer blocked from /scan-kiosk", () => {
  assert.equal(isRouteAccessibleByRole("/scan-kiosk", "viewer"), false);
});

test("viewer blocked from /incoming-stock", () => {
  assert.equal(isRouteAccessibleByRole("/incoming-stock", "viewer"), false);
});

test("viewer blocked from /rem/import", () => {
  assert.equal(isRouteAccessibleByRole("/rem/import", "viewer"), false);
});

test("viewer allowed on /dashboard", () => {
  assert.ok(isRouteAccessibleByRole("/dashboard", "viewer"));
});

test("viewer allowed on /stock-summary", () => {
  assert.ok(isRouteAccessibleByRole("/stock-summary", "viewer"));
});

// ─── 7. filterNavItemsForRole behavior ──────────────────────────────────

console.log("\n[7] filterNavItemsForRole");

test("filters engineer blocked items from nav", () => {
  const items = [
    { path: "/dashboard", label: "Dashboard" },
    { path: "/enterprise-dashboard", label: "Enterprise" },
    { path: "/sap-staging", label: "SAP" },
    { path: "/scan-kiosk", label: "Scan" },
  ];
  const filtered = filterNavItemsForRole(items, "engineer");
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map(i => i.path), ["/dashboard", "/scan-kiosk"]);
});

test("filters viewer blocked items from nav", () => {
  const items = [
    { path: "/dashboard", label: "Dashboard" },
    { path: "/scan-kiosk", label: "Scan" },
    { path: "/incoming-stock", label: "Incoming" },
    { path: "/stock-summary", label: "Stock" },
  ];
  const filtered = filterNavItemsForRole(items, "viewer");
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map(i => i.path), ["/dashboard", "/stock-summary"]);
});

test("superuser keeps all items", () => {
  const items = [
    { path: "/dashboard", label: "A" },
    { path: "/enterprise-dashboard", label: "B" },
    { path: "/sap-staging", label: "C" },
  ];
  const filtered = filterNavItemsForRole(items, "superuser");
  assert.equal(filtered.length, 3);
});

// ─── 8. ROLE_ROUTE_KEYS match CONFIG_ENTRIES keys ──────────────────────

console.log("\n[8] ROLE_ROUTE_KEYS consistency");

test("all ROLE_ROUTE_KEYS map to valid CONFIG_ENTRIES", () => {
  for (const [role, key] of Object.entries(ROLE_ROUTE_KEYS)) {
    const entry = getConfigEntry(key);
    assert.ok(entry, `ROLE_ROUTE_KEYS.${role} = "${key}" must have a CONFIG_ENTRIES entry`);
  }
});

// ─── 9. App.tsx route wiring (source verification for JSX structure) ────

console.log("\n[9] App.tsx route wiring");

const appSrc = fs.readFileSync("src/App.tsx", "utf8");

test("/rem/reports renders RemReports (canonical)", () => {
  assert.ok(appSrc.includes('<Route path="/rem/reports" element={<RemReports'),
    "/rem/reports must render RemReports");
});

test("/rem/reports-v2 is Navigate alias to /rem/reports", () => {
  assert.ok(
    appSrc.includes('path="/rem/reports-v2"') && appSrc.includes('<Navigate to="/rem/reports" replace'),
    "/rem/reports-v2 must be a Navigate to /rem/reports"
  );
});

test("no old Reports component import in App.tsx", () => {
  assert.ok(!appSrc.includes('import { Reports } from'), "Reports import must not exist in App.tsx");
});

test("RoleGuard component wraps admin routes", () => {
  assert.ok(appSrc.includes('function RoleGuard'), "RoleGuard must be defined");
  assert.ok(appSrc.includes('isRouteAccessibleByRole'), "RoleGuard must use isRouteAccessibleByRole");
});

test("enterprise-dashboard wrapped in RoleGuard", () => {
  const enterpriseMatch = appSrc.match(/path="\/enterprise-dashboard" element=\{[\s\S]*?\}/);
  assert.ok(enterpriseMatch, "enterprise-dashboard route must exist");
  assert.ok(enterpriseMatch[0].includes("RoleGuard"), "enterprise-dashboard must be wrapped in RoleGuard");
});

test("sap-staging wrapped in RoleGuard", () => {
  const sapMatch = appSrc.match(/path="\/sap-staging" element=\{[\s\S]*?\}/);
  assert.ok(sapMatch, "sap-staging route must exist");
  assert.ok(sapMatch[0].includes("RoleGuard"), "sap-staging must be wrapped in RoleGuard");
});

// ─── Summary ────────────────────────────────────────────────────────────

console.log(`\n━━━ Dashboard Role Routing: ${passed}/${total} passed, ${failed} failed ━━━`);
process.exit(failed > 0 ? 1 : 0);
