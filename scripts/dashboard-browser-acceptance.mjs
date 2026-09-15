// Synthetic browser harness for EngineerDashboard, InventoryReports, ExecutiveReport
// No production credentials, no external requests, no source edits
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { chromium } from "playwright";
import { build, normalizePath } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const harness = fs.mkdtempSync(path.join(os.tmpdir(), "vitros-dashboard-browser-"));
const artifacts = process.env.DASHBOARD_BROWSER_ARTIFACT_DIR ? path.resolve(process.env.DASHBOARD_BROWSER_ARTIFACT_DIR) : path.join(harness, "artifacts");
const components = [
  "src/pages/inventory/EngineerDashboard.tsx",
  "src/pages/reports/InventoryReports.tsx",
  "src/pages/reports/ExecutiveReport.tsx",
];
const css = path.join(root, "src/index.css");
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const report = {
  sourceHashes: Object.fromEntries(components.map(c => [path.basename(c), hash(path.join(root, c))])),
  cssHash: hash(css),
  syntheticHarness: true,
  productionAuthUntouched: true,
  checks: [],
  pageErrors: [],
  consoleErrors: [],
  externalRequests: [],
};

fs.mkdirSync(artifacts, { recursive: true });
fs.symlinkSync(path.join(root, "node_modules"), path.join(harness, "node_modules"), "junction");
fs.writeFileSync(path.join(harness, "package.json"), JSON.stringify({ type: "module" }));

// Synthetic data matching the Part, Transaction, Kit types from useConvexData
const syntheticParts = [
  { _id: "p1", partNumber: "J101", description: "Filter Assembly", type: "Required", qoh: 45, minQty: 20, maxQty: 100, onPlan: true, binLocation: "A-01", module: "VITROS", unitCost: 12.50, lastActivity: "2026-09-10", status: "OK" },
  { _id: "p2", partNumber: "J102", description: "Reagent Bottle", type: "Required", qoh: 5, minQty: 10, maxQty: 50, onPlan: true, binLocation: "A-02", module: "VITROS", unitCost: 8.75, lastActivity: "2026-09-12", status: "LOW" },
  { _id: "p3", partNumber: "J103", description: "Cuvette Tray", type: "Required", qoh: 0, minQty: 15, maxQty: 60, onPlan: true, binLocation: "A-03", module: "VITROS", unitCost: 22.00, lastActivity: "2026-09-01", status: "OUT" },
  { _id: "p4", partNumber: "J104", description: "Calibration Std", type: "Optional", qoh: 120, minQty: 10, maxQty: 80, onPlan: false, binLocation: "B-01", module: "VITROS", unitCost: 45.00, lastActivity: "2026-09-14", status: "OVER" },
  { _id: "p5", partNumber: "J201", description: "Waste Container", type: "Required", qoh: 30, minQty: 25, maxQty: 80, onPlan: true, binLocation: "A-04", module: "VISION", unitCost: 18.00, lastActivity: "2026-09-13", status: "OK" },
  { _id: "p6", partNumber: "J202", description: "Cleaning Solution", type: "Required", qoh: 8, minQty: 12, maxQty: 40, onPlan: true, binLocation: "A-05", module: "VISION", unitCost: 15.50, lastActivity: "2026-09-11", status: "LOW" },
];

const now = Date.now();
const syntheticTransactions = [
  { _id: "t1", timestamp: now - 3600000, user: "ENG001", mode: "OUT", partNumber: "J101", description: "Filter Assembly", qty: -2, qtyBefore: 47, qtyAfter: 45, sapStatus: "NOT_PUSHED", archived: false },
  { _id: "t2", timestamp: now - 7200000, user: "ENG002", mode: "RECEIVE", partNumber: "J102", description: "Reagent Bottle", qty: 10, qtyBefore: 0, qtyAfter: 10, sapStatus: "NOT_PUSHED", archived: false },
  { _id: "t3", timestamp: now - 10800000, user: "ENG001", mode: "OUT", partNumber: "J103", description: "Cuvette Tray", qty: -1, qtyBefore: 1, qtyAfter: 0, sapStatus: "NOT_PUSHED", archived: false },
  { _id: "t4", timestamp: now - 86400000, user: "ENG003", mode: "IN", partNumber: "J104", description: "Calibration Std", qty: 20, qtyBefore: 100, qtyAfter: 120, sapStatus: "POSTED", archived: false },
  { _id: "t5", timestamp: now - 172800000, user: "ENG002", mode: "OUT", partNumber: "J201", description: "Waste Container", qty: -5, qtyBefore: 35, qtyAfter: 30, sapStatus: "NOT_PUSHED", archived: false },
];

const syntheticKits = [
  { _id: "k1", kitId: "KIT-001", name: "VITROS PM Kit", basePartNumber: "J101", revision: "3", components: [
    { partNumber: "J101", description: "Filter Assembly", qtyRequired: 2 },
    { partNumber: "J102", description: "Reagent Bottle", qtyRequired: 4 },
    { partNumber: "J103", description: "Cuvette Tray", qtyRequired: 1 },
  ]},
  { _id: "k2", kitId: "KIT-002", name: "VISION Cal Kit", basePartNumber: "J201", revision: "2", components: [
    { partNumber: "J201", description: "Waste Container", qtyRequired: 1 },
    { partNumber: "J202", description: "Cleaning Solution", qtyRequired: 2 },
  ]},
];

// Mock hook for useConvexData
const mockUseConvexData = `
import { createContext, useContext } from "react";

const syntheticData = {
  parts: ${JSON.stringify(syntheticParts)},
  transactions: ${JSON.stringify(syntheticTransactions)},
  kits: ${JSON.stringify(syntheticKits)},
  sapRecords: [],
  cycleSchedules: [],
  cycleResults: [],
  batches: [],
  stockLog: [],
  employees: [],
  employeesError: null,
  settings: [],
  analyzers: [],
  lvccItems: [],
  annualTargets: [],
  staffMembers: [],
  weeklyNotes: [],
  weeklyBuildPlan: [],
  trackerWeekly: [],
  isLoading: false,
  error: null,
  totalSKUs: ${syntheticParts.length},
  totalQOH: ${syntheticParts.reduce((s, p) => s + p.qoh, 0)},
  outCount: ${syntheticParts.filter(p => p.qoh <= 0).length},
  lowCount: ${syntheticParts.filter(p => p.qoh > 0 && p.qoh < p.minQty).length},
  okCount: ${syntheticParts.filter(p => p.qoh >= p.minQty && p.qoh <= p.maxQty).length},
  overCount: ${syntheticParts.filter(p => p.qoh > p.maxQty).length},
  onPlanCount: ${syntheticParts.filter(p => p.onPlan).length},
  refresh: async () => {},
  scanPart: async () => {},
  updatePart: async () => {},
  deletePart: async () => {},
  createPart: async () => {},
  markAsReady: async () => {},
  markExported: async () => {},
  updateSapStatus: async () => {},
  listEmployees: async () => [],
  getEmployee: async () => null,
  addEmployee: async () => { throw new Error("not implemented"); },
  updateEmployee: async () => { throw new Error("not implemented"); },
  toggleEmployeeActive: async () => { throw new Error("not implemented"); },
};

const ConvexDataContext = createContext(syntheticData);

export function useConvexData() {
  return useContext(ConvexDataContext);
}
`;

// Mock hook for useConfig
const mockUseConfig = `
import { useMemo } from "react";
import { getConfigDefault } from "${normalizePath(path.join(root, "convex/configContract.ts"))}";

export function useConfig() {
  const getNavItems = useMemo(() => {
    return (section) => [];
  }, []);

  const getDashboardModules = useMemo(() => {
    return () => [];
  }, []);

  const getStockSummaryColumns = useMemo(() => {
    return () => [];
  }, []);

  const getTransactionSearchFields = useMemo(() => {
    return () => [];
  }, []);

  const getReportDefinitions = useMemo(() => {
    return () => [];
  }, []);

  const isFeatureEnabled = useMemo(() => {
    return () => false;
  }, []);

  return {
    get: key => {
      const value = structuredClone(getConfigDefault(key));
      if (key === "engineer.view" && new URLSearchParams(location.search).has("custom")) {
        value.title = "Bench operations"; value.cards.forEach((row, i) => row.visible = i === 0);
        value.cards[0].title = "Bench parts"; value.cards[0].size = "full";
        value.quickActions.forEach(row => { row.visible = row.path === "/dhr-scanner"; if (row.visible) row.label = "Open bench DHR"; });
        value.inventoryStatus.visible = false; value.recentTransactions.limit = 1;
      }
      return value;
    },
    publishedValues: new Map(),
    isLoading: false,
    getNavItems,
    getDashboardModules,
    getStockSummaryColumns,
    getTransactionSearchFields,
    getReportDefinitions,
    isFeatureEnabled,
  };
}
`;

fs.writeFileSync(path.join(harness, "mock-useConvexData.ts"), mockUseConvexData);
fs.writeFileSync(path.join(harness, "mock-useConfig.ts"), mockUseConfig);
fs.writeFileSync(path.join(harness, "mock-useInventoryReport.ts"),
  "export function useInventoryReport(period) { return {items: " + JSON.stringify(syntheticTransactions) + ".filter(t => t.timestamp >= period.start.getTime() && t.timestamp <= period.end.getTime()), isLoading:false,error:null,loadedAt:Date.now(),refresh:()=>{}}; }");


fs.writeFileSync(path.join(harness, "index.html"), `<!doctype html>
<html lang="en" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<title>Synthetic Dashboard Browser Regression</title></head>
<body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>`);

fs.writeFileSync(path.join(harness, "entry.tsx"), `
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { EngineerDashboard } from "@components/EngineerDashboard";
import { InventoryReports } from "@components/InventoryReports";
import { ExecutiveReport } from "@components/ExecutiveReport";
import "./harness.css";

const view = new URLSearchParams(location.search).get("view") || "engineer";

function App() {
  return (
    <BrowserRouter>
      <main style={{ padding: 24, maxWidth: 1400, margin: "auto" }}>
        <p className="mb-4 text-sm font-semibold" style={{ color: "#f1f5f9" }}>Synthetic Dashboard Browser Regression — {view}</p>
        {view === "engineer" && <EngineerDashboard />}
        {view === "inventory-reports" && <InventoryReports />}
        {view === "executive-report" && <ExecutiveReport />}
      </main>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
`);

fs.writeFileSync(path.join(harness, "harness.css"), `
@import ${JSON.stringify(normalizePath(css))};
@source ${JSON.stringify(normalizePath(path.join(root, "src")))};
body { margin: 0; background: #0c111b; color: #f1f5f9; }
`);

let server;
let browser;
try {
  await build({
    configFile: false, root: harness, cacheDir: path.join(harness, ".vite"),
    plugins: [{
      name: "synthetic-dashboard-components", enforce: "pre",
      resolveId(id) {
        if (id === "@components/EngineerDashboard") return path.join(root, "src/pages/inventory/EngineerDashboard.tsx");
        if (id === "@components/InventoryReports") return path.join(root, "src/pages/reports/InventoryReports.tsx");
        if (id === "@components/ExecutiveReport") return path.join(root, "src/pages/reports/ExecutiveReport.tsx");
        if (id.endsWith("hooks/useConvexData")) return path.join(harness, "mock-useConvexData.ts");
        if (id.endsWith("hooks/useInventoryReport")) return path.join(harness, "mock-useInventoryReport.ts");
        if (id.endsWith("hooks/useConfig")) return path.join(harness, "mock-useConfig.ts");
      },
    }, react(), tailwind()],
    resolve: { alias: { "@": path.join(root, "src") } },
    build: { outDir: path.join(harness, "dist"), emptyOutDir: true },
  });

  const dist = path.join(harness, "dist");
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
  server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      const file = path.resolve(dist, pathname === "/" ? "index.html" : `.${pathname}`);
      if (path.relative(dist, file).startsWith("..") || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
      res.end(fs.readFileSync(file));
    } catch {
      res.writeHead(400).end();
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch({
    headless: true,
    ...(process.env.DASHBOARD_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.DASHBOARD_BROWSER_EXECUTABLE_PATH } : {}),
  });

  const views = ["engineer", "inventory-reports", "executive-report"];
  const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];

  for (const view of views) {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        page.on("pageerror", error => report.pageErrors.push(`[${view}/${viewport.width}px] ${error}`));
        page.on("console", message => { if (message.type() === "error") report.consoleErrors.push(`[${view}/${viewport.width}px] ${message.text()}`); });
        await page.route("**/*", route => {
          if (route.request().url().startsWith(`${base}/`)) return route.continue();
          report.externalRequests.push(`[${view}/${viewport.width}px] ${route.request().url()}`);
          return route.abort();
        });

        await page.goto(`${base}/?view=${view}`);
        await page.waitForLoadState("networkidle");

        // Check no document overflow
        const documentOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(documentOverflow, false, `${view} overflows the ${viewport.width}px document`);

        if (view === "engineer") {
          // Verify EngineerDashboard key elements
          const header = await page.locator("h1:has-text('Engineer Dashboard')").count();
          assert.equal(header, 1, "EngineerDashboard header missing");

          const kpiCards = await page.locator(".grid.grid-cols-2.md\\:grid-cols-4 > div").count();
          assert.ok(kpiCards >= 7, `Expected at least 7 KPI cards, got ${kpiCards}`);

          const quickActions = await page.locator("text=Scan Kiosk").count();
          assert.equal(quickActions, 1, "Quick action 'Scan Kiosk' missing");

          const inventoryStatus = await page.locator("text=Inventory Status").count();
          assert.equal(inventoryStatus, 1, "Inventory Status section missing");

          const recentTx = await page.locator("text=Recent Transactions").count();
          assert.equal(recentTx, 1, "Recent Transactions section missing");

          // Verify KPI labels render (values are computed from data)
          const totalPartsLabel = await page.locator("text=Total Parts").count();
          assert.ok(totalPartsLabel > 0, "Total Parts KPI label missing");

          const healthLabel = await page.locator("text=Health %").count();
          assert.ok(healthLabel > 0, "Health % KPI label missing");

          const stockOutsLabel = await page.locator("text=Stock-Outs").count();
          assert.ok(stockOutsLabel > 0, "Stock-Outs KPI label missing");

          const reorderLabel = await page.locator("text=Reorder Needed").count();
          assert.ok(reorderLabel > 0, "Reorder Needed KPI label missing");

          report.checks.push({ view, viewport: viewport.width, kpiCards, documentOverflow: false, elementsPresent: true });
        }

        if (view === "inventory-reports") {
          // Verify InventoryReports key elements
          const header = await page.locator("h2:has-text('Inventory Reports')").count();
          assert.equal(header, 1, "InventoryReports header missing");

          const periodSelector = await page.locator("select#period-type").count();
          assert.equal(periodSelector, 1, "Period type selector missing");

          const statsStrip = await page.locator(".grid.grid-cols-2.sm\\:grid-cols-4 > .card-embossed, .grid.grid-cols-2.sm\\:grid-cols-4 > div[class*='rounded']").count();
          assert.ok(statsStrip >= 4, `Expected at least 4 stat cards, got ${statsStrip}`);

          const statusBreakdown = await page.locator("text=Inventory Status").count();
          assert.equal(statusBreakdown, 1, "Inventory Status Breakdown missing");

          report.checks.push({ view, viewport: viewport.width, documentOverflow: false, elementsPresent: true });
        }

        if (view === "executive-report") {
          // Verify ExecutiveReport key elements
          const header = await page.locator("h1:has-text('VITROS Inventory — Executive Summary')").count();
          assert.equal(header, 1, "ExecutiveReport header missing");

          const healthGauge = await page.locator("text=Overall Inventory Health Score").count();
          assert.equal(healthGauge, 1, "Health gauge missing");

          const summaryStats = await page.locator(".grid.grid-cols-2.md\\:grid-cols-4 > .card-embossed").count();
          assert.ok(summaryStats >= 4, `Expected at least 4 summary cards, got ${summaryStats}`);

          // Check required stock-outs table if present
          const requiredStockouts = await page.locator("text=Required Stock-Outs").count();
          // May be 0 or 1 depending on data

          report.checks.push({ view, viewport: viewport.width, documentOverflow: false, elementsPresent: true });
        }

        await page.screenshot({ path: path.join(artifacts, `${view}-${viewport.width}.png`), fullPage: true });
        if (view === "engineer") {
          await page.goto(`${base}/?view=engineer&custom=1`); await page.waitForLoadState("networkidle");
          assert.equal(await page.getByRole("heading", { name: "Bench operations" }).count(), 1);
          assert.equal(await page.getByText("Bench parts", { exact: true }).count(), 1);
          assert.equal(await page.getByText("Health %", { exact: true }).count(), 0);
          assert.equal(await page.getByRole("heading", { name: "Inventory Status" }).count(), 0);
          assert.equal(await page.getByRole("button", { name: /Open bench DHR/ }).count(), 1);
          assert.equal(await page.getByText("J102", { exact: true }).count(), 0);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await page.screenshot({ path: path.join(artifacts, `engineer-custom-${viewport.width}.png`), fullPage: true });
          report.checks.push({ view: "engineer-custom", viewport: viewport.width, documentOverflow: false, elementsPresent: true });
        }
      } finally {
        await context.close();
      }
    }
  }

  assert.deepEqual(report.pageErrors, [], "Browser page errors: " + JSON.stringify(report.pageErrors));
  assert.deepEqual(report.consoleErrors, [], "Browser console errors: " + JSON.stringify(report.consoleErrors));
  assert.deepEqual(report.externalRequests, [], "Synthetic harness attempted an external request: " + JSON.stringify(report.externalRequests));

  report.passed = true;
  console.log(`DASHBOARD_BROWSER=PASS checks=${report.checks.length} (synthetic component boundary; live authenticated acceptance remains separate)`);
} catch (error) {
  report.passed = false;
  report.failure = error instanceof Error ? error.stack : String(error);
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  console.log(`DASHBOARD_BROWSER_ARTIFACTS=${artifacts}`);
}
