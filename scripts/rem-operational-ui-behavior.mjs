// Executes the production hook/component with real React. Convex and time are
// controlled at their boundaries; this is not a live browser/network test.
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
const XLSX = require("xlsx");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function clock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const listeners = new Map();
  return {
    window: {
      setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
      clearTimeout: (id) => timers.delete(id),
    },
    document: {
      visibilityState: "visible",
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
    },
    async advance(milliseconds) {
      const end = now + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        await act(async () => next[1].callback());
      }
      now = end;
    },
    get timerCount() { return timers.size; },
    get listenerCount() { return listeners.size; },
  };
}

function productionModule(file, mocks, scheduler) {
  const result = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports, require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    window: scheduler.window, document: scheduler.document,
    Math: Object.assign(Object.create(Math), { random: () => 0 }), Blob, console,
  }, { filename: file });
  return exports;
}

const record = (key) => ({ dataset: "field_status", sourceKey: key, sourceSheet: "Field Status VITROS", sourceRow: 4, data: { batch: key, product: "VITROS", release: 0 } });
const page = (key, offset = 0) => ({ records: [record(key)], total: 200, offset, limit: 100, hasMore: true });

async function hookBehavior() {
  const scheduler = clock();
  let auth = { isAuthenticated: true, isLoading: false };
  let pulse = { version: 0, updatedAt: 0 };
  const requests = [];
  const action = (args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject }));
  const { useRemOperationalData } = productionModule("src/hooks/useRemOperationalData.ts", {
    "convex/react": { useAction: () => action, useConvexAuth: () => auth, useQuery: () => pulse },
    "../../convex/_generated/api": { api: { remOperationalImportActions: { listOperationalRecords: {} }, realtimePulse: { watch: {} } } },
  }, scheduler);
  let latest;
  function Probe(props) { latest = useRemOperationalData(props); return null; }
  let renderer;
  let props = { dataset: "field_status", query: " old ", planYear: 2026, limit: 900 };
  await act(async () => { renderer = create(React.createElement(Probe, props)); });
  assert.equal(requests[0].args.limit, 100, "server requests are bounded");
  assert.equal(requests[0].args.query, "old");
  assert.equal(requests[0].args.planYear, 2026);

  props = { ...props, query: "new" };
  await act(async () => renderer.update(React.createElement(Probe, props)));
  await act(async () => requests[1].resolve(page("new")));
  await act(async () => requests[0].resolve(page("old")));
  assert.equal(latest.records[0].sourceKey, "new", "old search response cannot replace newer data");

  props = { ...props, offset: 100 };
  await act(async () => renderer.update(React.createElement(Probe, props)));
  assert.equal(latest.records.length, 0, "changing page does not label stale rows as the new page");
  assert.equal(requests[2].args.offset, 100);
  await act(async () => requests[2].reject(new Error("private provider diagnostic")));
  assert.equal(latest.error.includes("private"), false, "provider details are not exposed");
  await act(async () => latest.refresh());
  await act(async () => requests[3].resolve(page("page-two", 100)));
  assert.equal(latest.error, null);

  pulse = { version: 1, updatedAt: 1 };
  await act(async () => renderer.update(React.createElement(Probe, props)));
  await scheduler.advance(20);
  pulse = { version: 2, updatedAt: 2 };
  await act(async () => renderer.update(React.createElement(Probe, props)));
  await scheduler.advance(20);
  assert.equal(requests.length, 5, "pulse burst keeps its earliest read instead of starving it");
  pulse = { version: 3, updatedAt: 3 };
  await act(async () => renderer.update(React.createElement(Probe, props)));
  await scheduler.advance(40);
  assert.equal(requests.length, 5, "pulse during a pending read queues one reconciliation");
  await act(async () => requests[4].resolve(page("pulse-one", 100)));
  assert.equal(requests.length, 6);
  assert.equal(requests[5].args.offset, 100, "background reads retain selected page");
  auth = { isAuthenticated: false, isLoading: false };
  await act(async () => renderer.update(React.createElement(Probe, props)));
  await act(async () => requests[5].resolve(page("signed-out-response", 100)));
  assert.equal(latest.records.length, 0, "sign out clears records and invalidates pending responses");
  await act(async () => renderer.unmount());
  assert.equal(scheduler.timerCount, 0, "timers cleaned up");
  assert.equal(scheduler.listenerCount, 0, "visibility listener cleaned up");
  console.log("REM_OPERATIONAL_HOOK_RACES=PASS");
}

async function componentBehavior() {
  const scheduler = clock();
  const requests = [];
  const saved = [];
  let data = {
    records: [{ dataset: "lvcc_reviews", sourceKey: "review-1", sourceSheet: "LVCC DHR Reviews", sourceRow: 8,
      data: { partNumber: "001234", weekNumber: 2, weekStart: "2026-01-05", sourceWeekStart: "2025-01-06", recordedTotal: 2, listedCount: 1, totalDifference: -1,
        reviewIds: [{ slot: 1, value: "=1+1", sourceCell: "F8" }], sourceNumericText: { recordedTotal: "02" } } }],
    total: 60, hasMore: true, loadedAt: 1789300000000, isLoading: false, isAuthenticated: true, error: null, refresh() {},
  };
  const NativeButton = ({ children, variant, size, ...props }) => React.createElement("button", props, children);
  const NativeCard = ({ children, ...props }) => React.createElement("div", props, children);
  const Icon = () => React.createElement("svg");
  const { RemOperationalRecords } = productionModule("src/components/vitros/RemOperationalRecords.tsx", {
    "../../hooks/useRemOperationalData": { useRemOperationalData: (args) => { requests.push(args); return data; } },
    "../ui/button": { Button: NativeButton },
    "./SharedComponents": { WebCard: NativeCard, theme: {} },
    "lucide-react": { ChevronDown: Icon, ChevronLeft: Icon, ChevronRight: Icon, Download: Icon, RefreshCw: Icon, Search: Icon },
    "file-saver": { saveAs: (blob, filename) => saved.push({ blob, filename }) },
  }, scheduler);
  let renderer;
  await act(async () => { renderer = create(React.createElement(RemOperationalRecords, { dataset: "lvcc_reviews", title: "LVCC review source", planYear: 2026 })); });
  const root = () => renderer.root;
  const text = () => JSON.stringify(renderer.toJSON());
  const nodeText = (node) => typeof node === "string" ? node : node.children.map(nodeText).join("");
  const select = (suffix) => root().findAllByType("select").find((node) => node.props.id?.endsWith(suffix));
  assert.equal(select("-year").props.disabled, true, "parent-selected plan year is explicit and fixed");
  assert.equal(requests.at(-1).planYear, 2026);
  assert.equal(root().findAllByType("thead").length, 1, "one table owns header and rows");
  assert.ok(root().findByType("caption"), "native table has an accessible caption");
  const expand = root().findAllByType("button").find((node) => node.props["aria-expanded"] === false);
  await act(async () => expand.props.onClick());
  assert.match(text(), /Recorded total/);
  assert.match(text(), /Listed IDs/);
  assert.match(text(), /F8/);
  assert.match(text(), /2025-01-06/);
  assert.match(text(), /Blank/, "absent optional source values remain explicit blanks");

  const exportButton = root().findAllByType("button").find((node) => nodeText(node).includes("Export page"));
  await act(async () => { exportButton.props.onClick(); for (let i = 0; i < 10; i++) await Promise.resolve(); });
  assert.equal(saved.length, 1);
  const workbook = XLSX.read(await saved[0].blob.arrayBuffer(), { type: "array" });
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets["Source records"]).length, 1, "export is the displayed page only");
  const exported = XLSX.utils.sheet_to_json(workbook.Sheets["Source records"])[0];
  assert.equal(exported.partNumber, "001234", "leading zero identifiers remain strings");
  const reviews = workbook.Sheets["Review IDs"];
  const formulaText = Object.values(reviews).find((cell) => cell?.v === "=1+1");
  assert.equal(formulaText.t, "s");
  assert.equal(formulaText.f, undefined, "source text never becomes a formula");
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets["Recorded numeric text"])[0].recordedText, "02");

  await scheduler.advance(300);
  const input = root().findByType("input");
  await act(async () => input.props.onChange({ target: { value: "new batch" } }));
  assert.equal(requests.at(-1).query, "", "search waits for debounce");
  await scheduler.advance(299);
  assert.equal(requests.at(-1).query, "");
  await scheduler.advance(1);
  assert.equal(requests.at(-1).query, "new batch");
  const next = root().findAllByType("button").find((node) => nodeText(node).includes("Next"));
  await act(async () => next.props.onClick());
  assert.equal(requests.at(-1).offset, 50);
  await act(async () => select("-limit").props.onChange({ target: { value: "100" } }));
  assert.equal(requests.at(-1).limit, 100);
  assert.equal(requests.at(-1).offset, 0);
  data = { ...data, records: [], total: 0, error: "Read failed" };
  await act(async () => renderer.update(React.createElement(RemOperationalRecords, { dataset: "lvcc_reviews", title: "LVCC review source", planYear: 2026 })));
  assert.equal(root().findAllByProps({ role: "alert" }).length, 1);
  assert.ok(root().findAllByType("button").some((node) => node.props.children === "Retry"));
  await act(async () => renderer.unmount());
  assert.equal(scheduler.timerCount, 0);
  data = { ...data, error: null, records: [], total: 0 };
  await act(async () => { renderer = create(React.createElement(RemOperationalRecords, { dataset: "install_parts", title: "Installation source", planYear: 2026 })); });
  assert.equal(root().findAllByType("select").length, 1, "source product family is not recast as a canonical product enum");
  assert.equal(requests.at(-1).planYear, undefined, "service history spans workbook years even when a parent provides a year");
  const family = root().findByProps({ placeholder: "Source product family" });
  await act(async () => family.props.onChange({ target: { value: "INTEGRATED SYS" } }));
  assert.equal(requests.at(-1).product, undefined);
  await scheduler.advance(300);
  assert.equal(requests.at(-1).product, "INTEGRATED SYS", "exact source family is passed without invented mapping");
  await act(async () => renderer.unmount());
  assert.equal(scheduler.timerCount, 0);
  data = { ...data, total: 60, hasMore: true };
  await act(async () => { renderer = create(React.createElement(RemOperationalRecords, { dataset: "field_status", title: "Field status" })); });
  assert.equal(select("-year").props.disabled, false, "annual source views have a usable plan-year selector");
  await act(async () => root().findAllByType("button").find((node) => nodeText(node).includes("Next")).props.onClick());
  assert.equal(requests.at(-1).offset, 50);
  await act(async () => select("-year").props.onChange({ target: { value: "2025" } }));
  assert.equal(requests.at(-1).planYear, 2025);
  assert.equal(requests.at(-1).offset, 0, "changing plan year resets pagination");
  await act(async () => renderer.unmount());
  assert.equal(scheduler.timerCount, 0);
  console.log("REM_OPERATIONAL_TABLE_EXPORT=PASS");
}

await hookBehavior();
await componentBehavior();
console.log("REM_OPERATIONAL_UI_BEHAVIOR=PASS (React boundary tests; live browser acceptance pending)");
