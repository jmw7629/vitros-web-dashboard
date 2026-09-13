// Render the real component and CSS with a synthetic data-hook boundary.
// No application route, credentials, backend request, or source workbook is used.
// Optional: REM_BROWSER_ARTIFACT_DIR, REM_BROWSER_EXECUTABLE_PATH,
// and Playwright's standard PLAYWRIGHT_BROWSERS_PATH.
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
const harness = fs.mkdtempSync(path.join(os.tmpdir(), "vitros-rem-browser-"));
const artifacts = process.env.REM_BROWSER_ARTIFACT_DIR
  ? path.resolve(process.env.REM_BROWSER_ARTIFACT_DIR)
  : path.join(harness, "artifacts");
const component = path.join(root, "src/components/vitros/RemOperationalRecords.tsx");
const css = path.join(root, "src/index.css");
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const datasets = ["field_status", "lvcc_reviews", "install_parts", "certified_parts", "summary_targets"];
const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];
const report = {
  sourceHash: hash(component), cssHash: hash(css), syntheticHarness: true,
  productionAuthUntouched: true, checks: [], pageErrors: [], consoleErrors: [], externalRequests: [],
};
fs.mkdirSync(artifacts, { recursive: true });
fs.symlinkSync(path.join(root, "node_modules"), path.join(harness, "node_modules"), "junction");
fs.writeFileSync(path.join(harness, "package.json"), JSON.stringify({ type: "module" }));
fs.writeFileSync(path.join(harness, "index.html"), `<!doctype html>
<html lang="en" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<title>Synthetic REM browser regression</title></head>
<body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>`);
fs.writeFileSync(path.join(harness, "entry.tsx"), `
import React from "react";
import { createRoot } from "react-dom/client";
import { RemOperationalRecords } from "@rem-under-test";
import "./harness.css";
const dataset = new URLSearchParams(location.search).get("dataset") || "field_status";
createRoot(document.getElementById("root")!).render(
  <main><p className="mb-4 text-sm font-semibold">Synthetic REM browser regression</p>
    <RemOperationalRecords dataset={dataset as any} title={dataset.replaceAll("_", " ")} />
  </main>
);`);
fs.writeFileSync(path.join(harness, "harness.css"), `
@import ${JSON.stringify(normalizePath(css))};
@source ${JSON.stringify(normalizePath(path.join(root, "src")))};
body { margin: 0; background: #0c111b; color: #f1f5f9; }
main { max-width: 1200px; margin: auto; padding: 24px; }
@media (max-width: 600px) { main { padding: 12px; } }
`);

// Deliberate source cases: zero count vs FPY, recorded vs listed reviews,
// a source-date discrepancy, noncanonical product family, and an absent month.
fs.writeFileSync(path.join(harness, "mock-hook.ts"), `
const templates: Record<string, Record<string, unknown>> = {
  field_status: {
    batch: "BATCH", product: "VITROS", orderReference: "2026-01", release: 0,
    finalLine: 2, releaseFpyPct: 50, partsAtInstallUsd: 12.345,
    cleanliness: "Recorded finding", status: "Released", sourcePostingDate: "TBD",
    partsNotCertified: "J101, J102", comment: "Synthetic source comment.",
  },
  lvcc_reviews: {
    partNumber: "J77000", weekNumber: 2, weekStart: "2026-01-05",
    sourceWeekStart: "2025-01-06", recordedTotal: 2, listedCount: 1,
    totalDifference: -1, sourceNumericText: { recordedTotal: "02" },
  },
  install_parts: {
    serviceOrder: "00001234", equipmentNumber: "J56001234", partNumber: "J101",
    quantity: 2, costUsd: 12.345, partCostUsd: 12.345, completedAt: "2026-01-05",
    productFamily: "INTEGRATED SYS", country: "A long synthetic country name",
    equipmentPartKey: "J56001234:J101", yearMonth: "2026-01",
    serviceMemo: "=Source text remains text",
  },
  certified_parts: {
    serviceOrder: "00001234", equipmentNumber: "J56001234", partNumber: "J101",
    partLineNumber: "001", laborLineNumber: "002", lineType: "Part", quantity: 2,
    partCostUsd: 12.345, allCostUsd: 20.12345, equipmentPartKey: "J56001234:J101",
  },
  summary_targets: {
    product: "VITROS", quarter: "Q1", targetValue: 45, annualTargetValue: 180,
    trackerPlanValue: 48, planVariance: 3,
  },
};
export function useRemOperationalData(args: any) {
  let records = Array.from({ length: 126 }, (_, index) => ({
    dataset: args.dataset, sourceKey: args.dataset + ":" + index,
    sourceSheet: args.dataset === "lvcc_reviews" ? "LVCC DHR Reviews" : "Synthetic " + args.dataset,
    sourceRow: index + (args.dataset === "lvcc_reviews" ? 8 : 2),
    data: {
      ...templates[args.dataset],
      ...(args.dataset === "field_status" ? { batch: "BATCH-" + String(index).padStart(4, "0") } : {}),
      ...(args.dataset === "lvcc_reviews" ? {
        reviewIds: [{ slot: 1, value: "001234", sourceCell: "F" + (index + 8) }],
      } : {}),
    } as Record<string, unknown>,
  }));
  if (args.query) records = records.filter(row => JSON.stringify(row).toLowerCase().includes(args.query.toLowerCase()));
  if (args.product) records = records.filter(row => (row.data.product || row.data.productFamily) === args.product);
  return {
    records: records.slice(args.offset, args.offset + args.limit), total: records.length,
    hasMore: args.offset + args.limit < records.length, offset: args.offset, limit: args.limit,
    loadedAt: Date.UTC(2026, 0, 5), isLoading: false, isAuthenticated: true, error: null, refresh() {},
  };
}
`);

let server;
let browser;
try {
  await build({
    configFile: false, root: harness, cacheDir: path.join(harness, ".vite"),
    plugins: [{
      name: "synthetic-rem-data-boundary", enforce: "pre",
      resolveId(id) {
        if (id === "@rem-under-test") return component;
        if (id.endsWith("hooks/useRemOperationalData")) return path.join(harness, "mock-hook.ts");
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
    ...(process.env.REM_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.REM_BROWSER_EXECUTABLE_PATH } : {}),
  });
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      page.on("pageerror", error => report.pageErrors.push(String(error)));
      page.on("console", message => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
      await page.route("**/*", route => {
        if (route.request().url().startsWith(`${base}/`)) return route.continue();
        report.externalRequests.push(route.request().url());
        return route.abort();
      });
      for (const dataset of datasets) {
        await page.goto(`${base}/?dataset=${dataset}`);
        await page.getByRole("status").filter({ hasText: "126 matching records" }).waitFor();
        const region = page.getByRole("region", { name: `${dataset.replaceAll("_", " ")} scrollable table` });
        const documentOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        const tableGeometry = await region.evaluate(el => {
          const compare = () => Math.abs(el.querySelector("thead th").getBoundingClientRect().left - el.querySelector("tbody th").getBoundingClientRect().left);
          const before = compare();
          el.scrollLeft = 300;
          return { before, after: compare(), scrollLeft: el.scrollLeft };
        });
        assert.equal(documentOverflow, false, `${dataset} overflows the ${viewport.width}px document`);
        assert.ok(tableGeometry.before < 1 && tableGeometry.after < 1, `${dataset} header and body drift apart`);
        if (viewport.width === 390) assert.ok(tableGeometry.scrollLeft > 0, "Mobile table must exercise horizontal scrolling");
        report.checks.push({ viewport: viewport.width, dataset, documentOverflow, headerBodyAligned: true, ...tableGeometry });
        await region.evaluate(el => { el.scrollLeft = 0; });
        await page.screenshot({ path: path.join(artifacts, `${dataset}-${viewport.width}.png`), fullPage: true });

        if (dataset === "lvcc_reviews") {
          const show = page.getByRole("button", { name: "Show source details for J77000, row 8", exact: true });
          const detailsId = await show.getAttribute("aria-controls");
          assert.ok(detailsId, "Expansion button needs a controlled details ID");
          await show.focus();
          await show.press("Enter");
          const hide = page.getByRole("button", { name: "Hide source details for J77000, row 8", exact: true });
          assert.equal(await hide.getAttribute("aria-expanded"), "true", "Enter must expand the same row");
          await page.getByText("Recorded review IDs", { exact: true }).waitFor();
          for (const requestedScrollLeft of [0, 300, 10_000]) {
            await region.evaluate((el, left) => { el.scrollLeft = left; }, requestedScrollLeft);
            const bounds = await region.evaluate((el, id) => {
              const panel = document.getElementById(id).querySelector("td > div").getBoundingClientRect();
              const region = el.getBoundingClientRect();
              const source = document.getElementById(id).querySelector("strong").getBoundingClientRect();
              return {
                panelLeft: panel.left, panelRight: panel.right, panelWidth: panel.width,
                sourceLeft: source.left, sourceRight: source.right,
                regionLeft: region.left, regionRight: region.right, regionWidth: region.width,
                actualScrollLeft: el.scrollLeft,
              };
            }, detailsId);
            assert.ok(bounds.panelLeft >= bounds.regionLeft - 1 && bounds.panelRight <= bounds.regionRight + 1,
              `Expanded provenance is horizontally clipped at ${viewport.width}px / scroll ${requestedScrollLeft}`);
            assert.ok(bounds.sourceLeft >= bounds.regionLeft && bounds.sourceRight <= bounds.regionRight,
              "Source provenance text must be visible at every horizontal scroll position");
            assert.ok(bounds.panelWidth >= bounds.regionWidth - 2, "Details should use the visible table width");
            report.checks.push({ viewport: viewport.width, detailsKeyboard: true, requestedScrollLeft, ...bounds });
          }
          await page.screenshot({ path: path.join(artifacts, `lvcc-details-${viewport.width}.png`), fullPage: true });
          const sourceCell = page.getByText("F8", { exact: true });
          await sourceCell.scrollIntoViewIfNeeded();
          const cell = await sourceCell.boundingBox();
          const visibleRegion = await region.boundingBox();
          assert.ok(cell && visibleRegion && cell.x >= visibleRegion.x && cell.x + cell.width <= visibleRegion.x + visibleRegion.width,
            "Recorded review source cell must remain within the visible table width");
          await page.screenshot({ path: path.join(artifacts, `lvcc-review-ids-${viewport.width}.png`), fullPage: true });
          await hide.focus();
          await hide.press("Enter");
          assert.equal(await page.getByRole("button", { name: "Show source details for J77000, row 8", exact: true }).getAttribute("aria-expanded"), "false");
        }
        if (dataset === "field_status") {
          await page.getByRole("searchbox", { name: "Search source records" }).fill("BATCH-0042");
          await page.getByRole("status").filter({ hasText: "1 matching records" }).waitFor();
          report.checks.push({ viewport: viewport.width, debouncedSearch: true });
        }
      }
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(report.pageErrors, [], "Browser page errors");
  assert.deepEqual(report.consoleErrors, [], "Browser console errors");
  assert.deepEqual(report.externalRequests, [], "Synthetic harness attempted an external request");
  report.passed = true;
  console.log("REM_OPERATIONAL_BROWSER=PASS (synthetic component boundary; live authenticated acceptance remains separate)");
} catch (error) {
  report.passed = false;
  report.failure = error instanceof Error ? error.stack : String(error);
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  console.log(`REM_BROWSER_ARTIFACTS=${artifacts}`);
}
