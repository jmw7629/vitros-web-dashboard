import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Loader: executes actual production .ts via transpile + vm sandbox
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = new Map();

const refs = new Proxy(
  {},
  { get: (_, mod) => new Proxy({}, { get: (_, fn) => String(mod) + ":" + String(fn) }) }
);

const register = (definition) => definition;
const framework = {
  query: register,
  mutation: register,
  internalQuery: register,
  internalMutation: register,
  action: register,
  internalAction: register,
};

const validators = new Proxy(
  {},
  { get: (_, name) => (...args) => ({ kind: name, args }) }
);

function loadReal(name) {
  if (modules.has(name)) return modules.get(name);
  const filename = path.join(ROOT, "convex", name + ".ts");
  const source = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const syntax = (result.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  );
  assert.equal(
    syntax.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(syntax, {
      getCurrentDirectory: () => ROOT,
      getCanonicalFileName: (x) => x,
      getNewLine: () => "\n",
    })
  );
  const module = { exports: {} };
  modules.set(name, module.exports);
  const require = (dep) => {
    if (dep === "./_generated/server") return framework;
    if (dep === "./_generated/api") return { internal: refs, api: refs };
    if (dep === "convex/values") return { v: validators };
    if (dep === "convex/server") {
      const table = { index: () => table };
      return { defineTable: () => table };
    }
    if (dep === "@convex-dev/auth/server")
      return { getAuthUserId: async (ctx) => ctx.fixtureUserId ?? null };
    if (dep === "./employeeAccess")
      return {
        assertUserEmployeeAccess: async (ctx) => {
          if (ctx.fixtureEmployeeDenied)
            throw new Error("Employee access denied");
        },
      };
    if (dep === "./roleIdentity")
      return {
        resolveServerIdentity: async (ctx) => ctx.fixtureIdentity ?? null,
      };
    if (dep === "./configContract")
      return {
        effectiveRoleCapabilities: (role) => {
          const caps = {
            superuser: [
              "inventory.read", "inventory.write", "inventory.admin",
              "ai.ocr", "rem.read", "rem.write",
              "admin.system_settings.manage", "admin.users.manage", "admin.audit.read",
            ],
            engineer: [
              "inventory.read", "inventory.write", "ai.ocr", "rem.read", "rem.write",
            ],
            viewer: ["inventory.read", "rem.read"],
          };
          return caps[role] ?? [];
        },
      };
    if (dep === "./zenRuntime")
      return {
        runZen: async () => ({
          text: '{"tables":[]}',
          model: "test-stub",
        }),
      };
    if (dep.startsWith("./")) return loadReal(dep.slice(2));
    throw new Error("Unexpected dependency: " + dep);
  };
  vm.runInNewContext(
    result.outputText,
    {
      module,
      exports: module.exports,
      require,
      console,
      process,
      Date,
      JSON,
      Math,
      Set,
      Map,
      Error,
      TypeError,
      Uint8Array,
      TextEncoder,
      TextDecoder,
    },
    { filename, timeout: 10000 }
  );
  return module.exports;
}

// ---------------------------------------------------------------------------
// Load production modules
// ---------------------------------------------------------------------------

const mapping = loadReal("enterpriseMapping");
const uploads = loadReal("enterpriseUploads");

assert.equal(typeof mapping.numeric, "function");
assert.equal(typeof mapping.suggestMapping, "function");
assert.equal(typeof mapping.validateMapping, "function");
assert.equal(typeof mapping.selectedRows, "function");
assert.equal(typeof mapping.metrics, "function");
assert.equal(typeof mapping.dateValue, "function");
assert.equal(typeof mapping.acceptAISuggestions, "function");
assert.equal(typeof uploads.begin, "object");
assert.equal(typeof uploads.begin.handler, "function");
assert.equal(typeof uploads.attach.handler, "function");
assert.equal(typeof uploads.queue.handler, "function");
assert.equal(typeof uploads.list.handler, "function");
assert.equal(typeof uploads.get.handler, "function");
assert.equal(typeof uploads.datasets.handler, "function");
assert.equal(typeof uploads.markParsing.handler, "function");
assert.equal(typeof uploads.finish.handler, "function");
assert.equal(typeof uploads.publishInternal.handler, "function");

// ---------------------------------------------------------------------------
// Fixture database with Convex-like query API
// ---------------------------------------------------------------------------

const INDEXES = {
  by_actor_and_correlationId: ["actor", "correlationId"],
  by_updatedAt: ["updatedAt"],
  by_uploadId_and_tableKey: ["uploadId", "tableKey"],
  by_key: ["key"],
  userIdAndProvider: ["userId", "provider"],
  by_uploadId: ["uploadId"],
};

class FixtureDatabase {
  constructor() {
    this.rows = new Map();
    this.seq = 0;
    this.writes = 0;
    this.reads = [];
    this.system = {
      get: async (id) => {
        const meta = storageMeta.get(id);
        return meta ? { _id: id, size: meta.size, sha256: meta.sha256 } : null;
      },
    };
  }
  clone() {
    const d = new FixtureDatabase();
    d.rows = new Map(this.rows);
    d.seq = this.seq;
    d.writes = this.writes;
    d.reads = this.reads;
    d.system = this.system;
    return d;
  }
  async get(id) {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }
  async insert(table, value) {
    const id = `${table}:${++this.seq}`;
    this.rows.set(id, { ...structuredClone(value), _id: id });
    this.writes++;
    return id;
  }
  async patch(id, value) {
    assert.ok(this.rows.has(id), `patch: ${id} not found`);
    this.rows.set(id, { ...this.rows.get(id), ...structuredClone(value) });
    this.writes++;
  }
  query(table) {
    const db = this;
    let indexName = null;
    let eqs = [];
    let desc = false;
    const sel = {
      withIndex(name, cb) {
        assert.ok(INDEXES[name], `Unknown index ${name}`);
        indexName = name;
        const r = {
          eq(field, value) {
            eqs.push([field, value]);
            return r;
          },
        };
        cb?.(r);
        return sel;
      },
      order(d) {
        desc = d === "desc";
        return sel;
      },
      filter() {
        return sel;
      },
      async first() {
        const all = await sel.collect();
        return all[0] ?? null;
      },
      async unique() {
        const all = await sel.collect();
        assert.ok(all.length <= 1, `Expected unique result, got ${all.length}`);
        return all[0] ?? null;
      },
      async collect() {
        const fields = INDEXES[indexName] ?? [];
        const all = [...db.rows.values()].filter(
          (r) => r._id.startsWith(`${table}:`) && eqs.every(([k, v]) => r[k] === v)
        );
        all.sort((a, b) => {
          for (const f of fields) {
            if (a[f] < b[f]) return desc ? 1 : -1;
            if (a[f] > b[f]) return desc ? -1 : 1;
          }
          return 0;
        });
        return all.map((r) => structuredClone(r));
      },
      async take(n) {
        const all = await sel.collect();
        return all.slice(0, n);
      },
      paginate({ cursor, numItems }) {
        return sel.collect().then((all) => {
          const start = cursor ? parseInt(cursor, 36) : 0;
          const page = all.slice(start, start + numItems);
          const isDone = start + numItems >= all.length;
          return {
            page: page.map((r) => structuredClone(r)),
            isDone,
            continueCursor: isDone ? null : String(start + numItems),
          };
        });
      },
    };
    return sel;
  }
}

// ---------------------------------------------------------------------------
// Fixture storage (Blob objects keyed by id)
// ---------------------------------------------------------------------------

let storageSeq = 0;
const storageBlobs = new Map();
const storageMeta = new Map();

function createStorage() {
  return {
    generateUploadUrl: async () => `https://fixture-storage/upload/${++storageSeq}`,
    getUrl: async (id) => `https://fixture-storage/file/${id}`,
    store: async (blob) => {
      const id = `_storage:${++storageSeq}`;
      storageBlobs.set(id, blob);
      storageMeta.set(id, { size: blob.size, sha256: "fixture-sha256-" + id });
      return id;
    },
    get: async (id) => storageBlobs.get(id) ?? null,
    delete: async (id) => {
      storageBlobs.delete(id);
      storageMeta.delete(id);
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture scheduler
// ---------------------------------------------------------------------------

let scheduled = [];
function createScheduler() {
  return {
    runAfter: async (_delay, ref, args) => {
      scheduled.push({ ref, args });
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture context builder
// ---------------------------------------------------------------------------

const admin = { userId: "users:admin", role: "superuser" };
const engineer = { userId: "users:engineer", role: "engineer" };
const viewer = { userId: "users:viewer", role: "viewer" };

function makeCtx(db, identity, storage) {
  const ctx = {
    db,
    storage: storage ?? createStorage(),
    scheduler: createScheduler(),
    fixtureUserId: identity?.userId ?? null,
    fixtureIdentity: identity ? { role: identity.role } : null,
    fixtureEmployeeDenied: identity?.blocked,
  };
  // Stub for "runQuery" path in authGuard (action ctx branch)
  ctx.runQuery = async (ref, args) => {
    if (ref === "employeeAccess:assertUserAccess") {
      if (identity?.blocked) throw new Error("Employee access denied");
      return null;
    }
    if (ref === "users:getUserRole") return identity?.role ?? null;
    if (ref === "configActions:getRolePolicyInternal") return null;
    throw new Error(`Unexpected runQuery: ${ref}`);
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passes = 0;
let failures = 0;
let currentTest = "";
let defects = [];

async function test(name, fn) {
  currentTest = name;
  try {
    await fn();
    passes++;
    console.log(`PASS ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL ${name}: ${e.message}`);
    if (e.stack) console.error(e.stack.split("\n").slice(1, 3).join("\n"));
  }
}

function reject(promise, pattern) {
  return promise.then(
    () => { throw new Error(`Expected rejection matching ${pattern} but resolved`); },
    (e) => {
      if (pattern && !pattern.test(e.message))
        throw new Error(`Rejected with "${e.message}" but expected ${pattern}`);
    }
  );
}

function corr() {
  return "test-" + Math.random().toString(36).slice(2, 18);
}

function makeTable(overrides = {}) {
  return {
    key: "table-1",
    name: "Test Table",
    hidden: false,
    columnCount: 4,
    headerRow: 1,
    rows: [
      {
        row: 1,
        cells: [
          { value: "SKU", display: "SKU" },
          { value: "Qty", display: "Qty" },
          { value: "Date", display: "Date" },
          { value: "Cost", display: "Cost" },
        ],
      },
      {
        row: 2,
        cells: [
          { value: "00123", display: "00123" },
          { value: "10", display: "10" },
          { value: "2025-06-15", display: "2025-06-15" },
          { value: "5.50", display: "5.50" },
        ],
      },
      {
        row: 3,
        cells: [
          { value: "00456", display: "00456" },
          { value: "25.5", display: "25.5" },
          { value: "2025-07-20", display: "2025-07-20" },
          { value: "12.00", display: "12.00" },
        ],
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function makeMapping(overrides = {}) {
  return {
    name: "Test Dataset",
    destination: "inventory",
    headerRow: 1,
    excludedRows: [],
    fields: [
      { column: 0, label: "SKU", role: "identifier", kind: "text", visible: true, metric: false },
      { column: 1, label: "Qty", role: "quantity", kind: "number", visible: true, metric: true },
      { column: 2, label: "Date", role: "date", kind: "date", visible: true, metric: false },
      { column: 3, label: "Cost", role: "cost", kind: "number", visible: true, metric: true },
    ],
    ...overrides,
  };
}

function makeUpload(db, attrs = {}) {
  return db.insert("enterpriseUploads", {
    actor: admin.userId,
    correlationId: corr(),
    name: "test.csv",
    mime: "text/csv",
    status: "stored",
    message: "Ready.",
    revision: 0,
    generation: 0,
    updatedAt: Date.now(),
    ...attrs,
  });
}

// ===========================================================================
// 1. NUMERIC PARSER
// ===========================================================================

await test("numeric: normal number values", () => {
  assert.equal(mapping.numeric({ value: 42, display: "42" }), 42);
  assert.equal(mapping.numeric({ value: -3.14, display: "-3.14" }), -3.14);
  assert.equal(mapping.numeric({ value: "100", display: "100" }), 100);
  assert.equal(mapping.numeric({ value: "0.5", display: "0.5" }), 0.5);
  assert.equal(mapping.numeric({ value: "-7", display: "-7" }), -7);
});

await test("numeric: null/undefined/error cells return null, not zero", () => {
  assert.equal(mapping.numeric(undefined), null);
  assert.equal(mapping.numeric({ value: null, display: "" }), null);
  assert.equal(mapping.numeric({ value: "", display: "" }), null);
  assert.equal(mapping.numeric({ value: "N/A", display: "N/A", issue: "error" }), null);
  assert.equal(mapping.numeric({ value: 0, display: "0", issue: "formula error" }), null);
});

await test("numeric: ambiguous separators and units are not coerced", () => {
  // Thousand separators — comma inside number is ambiguous
  assert.equal(mapping.numeric({ value: "1,000", display: "1,000" }), null);
  // Percentage
  assert.equal(mapping.numeric({ value: "50%", display: "50%" }), null);
  // Units
  assert.equal(mapping.numeric({ value: "10 kg", display: "10 kg" }), null);
  // Range
  assert.equal(mapping.numeric({ value: "5-10", display: "5-10" }), null);
  // Leading text
  assert.equal(mapping.numeric({ value: "approx 5", display: "approx 5" }), null);
});

await test("numeric: leading-zero strings stay text (never coerced)", () => {
  // "00123" is a text identifier, not the quantity 123. Coercing it would
  // invent a numeric value, so it must return null.
  assert.equal(mapping.numeric({ value: "00123", display: "00123" }), null);
  assert.equal(mapping.numeric({ value: "000", display: "000" }), null);
  assert.equal(mapping.numeric({ value: "0", display: "0" }), 0);
  assert.equal(mapping.numeric({ value: "0.5", display: "0.5" }), 0.5);
});

await test("numeric: explicit numberFormat US '1,234.50' -> 1234.5", () => {
  assert.equal(mapping.numeric({ value: "1,234.50", display: "1,234.50" }, "us"), 1234.5);
  assert.equal(mapping.numeric({ value: "12,345", display: "12,345" }, "us"), 12345);
  assert.equal(mapping.numeric({ value: "-1,234.50", display: "-1,234.50" }, "us"), -1234.5);
});

await test("numeric: explicit numberFormat EU '1.234,50' -> 1234.5", () => {
  assert.equal(mapping.numeric({ value: "1.234,50", display: "1.234,50" }, "eu"), 1234.5);
  assert.equal(mapping.numeric({ value: "1.234", display: "1.234" }, "eu"), 1234);
  assert.equal(mapping.numeric({ value: "1234,50", display: "1234,50" }, "eu"), 1234.5);
});

await test("numeric: default plain keeps ambiguous separators null", () => {
  assert.equal(mapping.numeric({ value: "1,234.50", display: "1,234.50" }), null, "ambiguous comma must stay null by default");
  assert.equal(mapping.numeric({ value: "1.234,50", display: "1.234,50" }), null, "ambiguous dot must stay null by default");
  assert.equal(mapping.numeric({ value: "1234.5", display: "1234.5" }), 1234.5, "unambiguous decimal parses");
});

await test("numeric: Infinity/NaN finite check", () => {
  assert.equal(mapping.numeric({ value: Infinity, display: "Infinity" }), null);
  assert.equal(mapping.numeric({ value: -Infinity, display: "-Infinity" }), null);
  // NaN is typeof "number" but Number.isFinite returns false
  assert.equal(mapping.numeric({ value: NaN, display: "NaN" }), null);
});

// ===========================================================================
// 2. DATE VALUE
// ===========================================================================

await test("dateValue: ISO format parsing", () => {
  const d = "2025-06-15";
  assert.equal(mapping.dateValue({ value: d, display: d }, undefined), Date.parse(d));
  const dt = "2025-06-15T10:30:00Z";
  assert.equal(mapping.dateValue({ value: dt, display: dt }, undefined), Date.parse(dt));
});

await test("dateValue: MDY format", () => {
  const cell = { value: "06/15/2025", display: "06/15/2025" };
  const result = mapping.dateValue(cell, "mdy");
  assert.ok(result !== null, "MDY should parse");
  const d = new Date(result);
  assert.equal(d.getUTCFullYear(), 2025);
  assert.equal(d.getUTCMonth(), 5); // June
  assert.equal(d.getUTCDate(), 15);
});

await test("dateValue: DMY format", () => {
  const cell = { value: "15/06/2025", display: "15/06/2025" };
  const result = mapping.dateValue(cell, "dmy");
  assert.ok(result !== null, "DMY should parse");
  const d = new Date(result);
  assert.equal(d.getUTCFullYear(), 2025);
  assert.equal(d.getUTCMonth(), 5);
  assert.equal(d.getUTCDate(), 15);
});

await test("dateValue: no format returns null for ambiguous dates", () => {
  assert.equal(mapping.dateValue({ value: "06/15/2025", display: "06/15/2025" }, undefined), null);
  assert.equal(mapping.dateValue({ value: "15/06/2025", display: "15/06/2025" }, undefined), null);
});

await test("dateValue: invalid dates excluded with no fabricated values", () => {
  // Feb 30 is invalid
  const cell = { value: "02/30/2025", display: "02/30/2025" };
  assert.equal(mapping.dateValue(cell, "mdy"), null, "Feb 30 must be rejected");
  // Feb 29 in non-leap year
  const cell2 = { value: "02/29/2023", display: "02/29/2023" };
  assert.equal(mapping.dateValue(cell2, "mdy"), null, "Feb 29 in 2023 must be rejected");
  // Leap year Feb 29 is valid
  const cell3 = { value: "02/29/2024", display: "02/29/2024" };
  assert.ok(mapping.dateValue(cell3, "mdy") !== null, "Feb 29 in 2024 should be accepted");
});

await test("dateValue: error/issue cells return null", () => {
  assert.equal(mapping.dateValue({ value: "2025-06-15", display: "2025-06-15", issue: "error" }, undefined), null);
});

await test("dateValue: non-string values return null", () => {
  assert.equal(mapping.dateValue({ value: 123, display: "123" }, "mdy"), null);
});

// ===========================================================================
// 3. SUGGEST MAPPING
// ===========================================================================

await test("suggestMapping: auto-maps columns by header inference", () => {
  const table = makeTable();
  const m = mapping.suggestMapping(table);
  assert.equal(m.name, "Test Table");
  assert.equal(m.fields.length, 4);
  assert.equal(m.fields[0].role, "identifier");
  assert.equal(m.fields[1].role, "quantity");
  assert.equal(m.fields[2].role, "date");
  assert.equal(m.fields[3].role, "cost");
  assert.equal(m.destination, "inventory");
});

await test("suggestMapping: production destination when stage/plan/actual present", () => {
  const table = {
    ...makeTable(),
    columnCount: 5,
    rows: [
      {
        row: 1,
        cells: [
          { value: "SKU", display: "SKU" },
          { value: "Stage", display: "Stage" },
          { value: "Plan", display: "Plan" },
          { value: "Actual", display: "Actual" },
          { value: "Cost", display: "Cost" },
        ],
      },
      {
        row: 2,
        cells: [
          { value: "001", display: "001" },
          { value: "Assembly", display: "Assembly" },
          { value: "100", display: "100" },
          { value: "90", display: "90" },
          { value: "5", display: "5" },
        ],
      },
    ],
  };
  const m = mapping.suggestMapping(table);
  assert.equal(m.destination, "production");
});

// ===========================================================================
// 4. VALIDATE MAPPING — duplicate dashboard roles rejected
// ===========================================================================

await test("validateMapping: rejects duplicate dashboard roles", () => {
  const table = makeTable();
  const m = makeMapping();
  // Duplicate "quantity" role on a different column
  m.fields[3] = { column: 3, label: "Extra Qty", role: "quantity", kind: "number", visible: true, metric: true };
  assert.throws(() => mapping.validateMapping(table, m), /Map each dashboard role once/);
});

await test("validateMapping: rejects dropped columns (must keep all)", () => {
  const table = makeTable();
  const m = makeMapping();
  m.fields = m.fields.slice(0, 3); // Drop cost column
  assert.throws(() => mapping.validateMapping(table, m), /Keep every source column/);
});

await test("validateMapping: hidden columns are hidden, not deleted", () => {
  const table = makeTable();
  const m = makeMapping();
  // Mark cost as extra (hidden) — still present in fields
  m.fields[3] = { ...m.fields[3], role: "extra", visible: false, metric: false };
  assert.doesNotThrow(() => mapping.validateMapping(table, m));
  assert.equal(m.fields.length, 4, "All 4 columns still in mapping");
});

await test("validateMapping: rejects empty/overlong name", () => {
  const table = makeTable();
  const m = makeMapping({ name: "" });
  assert.throws(() => mapping.validateMapping(table, m), /1–180/);
  m.name = "x".repeat(200);
  assert.throws(() => mapping.validateMapping(table, m), /1–180/);
});

await test("validateMapping: metric must be numeric kind", () => {
  const table = makeTable();
  const m = makeMapping();
  m.fields[1] = { ...m.fields[1], kind: "text", metric: true };
  assert.throws(() => mapping.validateMapping(table, m), /Only numeric fields can be summarized/);
});

await test("validateMapping: excluded rows must exist", () => {
  const table = makeTable();
  const m = makeMapping({ excludedRows: [99] });
  assert.throws(() => mapping.validateMapping(table, m), /Excluded rows must exist/);
});

// ===========================================================================
// 5. SELECTED ROWS — hidden columns hidden not deleted
// ===========================================================================

await test("selectedRows: returns data rows above header, excludes excluded rows", () => {
  const table = makeTable();
  const m = makeMapping({ excludedRows: [3] });
  const rows = mapping.selectedRows(table, m);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].row, 2);
});

// ===========================================================================
// 6. METRICS — sum, reported, unreported
// ===========================================================================

await test("metrics: computes sum/reported/unreported for metric fields", () => {
  const table = makeTable();
  const m = makeMapping();
  const result = mapping.metrics(table, m);
  assert.equal(result.length, 2); // qty and cost
  const qty = result.find((r) => r.column === 1);
  assert.equal(qty.sum, 35.5); // 10 + 25.5
  assert.equal(qty.reported, 2);
  assert.equal(qty.unreported, 0);
  const cost = result.find((r) => r.column === 3);
  assert.equal(cost.sum, 17.5); // 5.50 + 12.00
});

await test("metrics: unreported rows counted when cell is null/empty", () => {
  const table = makeTable();
  table.rows.push({
    row: 4,
    cells: [
      { value: "00789", display: "00789" },
      { value: null, display: "" },
      { value: "2025-08-01", display: "2025-08-01" },
      { value: "", display: "" },
    ],
  });
  const m = makeMapping();
  const result = mapping.metrics(table, m);
  const qty = result.find((r) => r.column === 1);
  assert.equal(qty.sum, 35.5);
  assert.equal(qty.reported, 2);
  assert.equal(qty.unreported, 1);
});

await test("metrics: ambiguous separator values not counted", () => {
  const table = makeTable();
  table.rows.push({
    row: 4,
    cells: [
      { value: "X", display: "X" },
      { value: "1,000", display: "1,000" },
      { value: "2025-08-01", display: "2025-08-01" },
      { value: "50%", display: "50%" },
    ],
  });
  const m = makeMapping();
  const result = mapping.metrics(table, m);
  const qty = result.find((r) => r.column === 1);
  assert.equal(qty.sum, 35.5);
  assert.equal(qty.reported, 2); // "1,000" not counted
});

// ===========================================================================
// 7. ACCEPT AI SUGGESTIONS — AI cannot invent data/drop fields/override labels
// ===========================================================================

await test("acceptAISuggestions: with null proposal returns base suggestions", () => {
  const table = makeTable();
  const result = mapping.acceptAISuggestions(table, null);
  assert.equal(result.fields.length, 4);
  assert.equal(result.fields[0].role, "identifier");
});

await test("acceptAISuggestions: AI cannot invent new columns", () => {
  const table = makeTable();
  const proposal = {
    fields: [
      { column: 0, role: "identifier" },
      { column: 1, role: "quantity" },
      { column: 2, role: "date" },
      { column: 3, role: "cost" },
      { column: 99, role: "description" }, // non-existent column
    ],
  };
  const result = mapping.acceptAISuggestions(table, proposal);
  // Column 99 should be ignored; only 4 fields exist
  assert.equal(result.fields.length, 4);
});

await test("acceptAISuggestions: AI cannot drop columns", () => {
  const table = makeTable();
  const proposal = {
    fields: [
      { column: 0, role: "identifier" },
      // columns 1-3 omitted
    ],
  };
  const result = mapping.acceptAISuggestions(table, proposal);
  // All 4 original columns preserved; omitted ones keep base role
  assert.equal(result.fields.length, 4);
});

await test("acceptAISuggestions: AI cannot override labels", () => {
  const table = makeTable();
  const proposal = {
    fields: [
      { column: 0, role: "identifier", label: "HACKED" },
      { column: 1, role: "quantity" },
      { column: 2, role: "date" },
      { column: 3, role: "cost" },
    ],
  };
  const result = mapping.acceptAISuggestions(table, proposal);
  // Labels come from table headers, not from AI proposal
  assert.equal(result.fields[0].label, "SKU");
});

await test("acceptAISuggestions: AI cannot invent unknown roles", () => {
  const table = makeTable();
  const proposal = {
    fields: [
      { column: 0, role: "hacker_role" },
      { column: 1, role: "quantity" },
      { column: 2, role: "date" },
      { column: 3, role: "cost" },
    ],
  };
  const result = mapping.acceptAISuggestions(table, proposal);
  assert.equal(result.fields[0].role, "identifier"); // unknown role ignored, kept as base
});

await test("acceptAISuggestions: duplicate roles collapsed to extra", () => {
  const table = makeTable();
  const proposal = {
    fields: [
      { column: 0, role: "quantity" },
      { column: 1, role: "quantity" }, // duplicate
      { column: 2, role: "date" },
      { column: 3, role: "cost" },
    ],
  };
  const result = mapping.acceptAISuggestions(table, proposal);
  assert.equal(result.fields[0].role, "quantity");
  assert.equal(result.fields[1].role, "extra"); // second occurrence collapsed
});

await test("acceptAISuggestions: identifier kind forced to text", () => {
  const table = makeTable();
  const proposal = {
    fields: [
      { column: 0, role: "identifier" },
      { column: 1, role: "quantity" },
      { column: 2, role: "date" },
      { column: 3, role: "cost" },
    ],
  };
  const result = mapping.acceptAISuggestions(table, proposal);
  assert.equal(result.fields[0].kind, "text"); // forced to text
});

await test("acceptAISuggestions: destination only accepts valid values", () => {
  const table = makeTable();
  const p1 = { fields: [], destination: "production" };
  assert.equal(mapping.acceptAISuggestions(table, p1).destination, "production");
  const p2 = { fields: [], destination: "hacked" };
  assert.equal(mapping.acceptAISuggestions(table, p2).destination, "inventory"); // unchanged
});

// ===========================================================================
// 8. HANDLERS — Unauthorized paths
// ===========================================================================

await test("begin: requires admin.system_settings.manage capability", async () => {
  const db = new FixtureDatabase();
  await assert.rejects(
    uploads.begin.handler(makeCtx(db, viewer), { name: "t.csv", mime: "text/csv", correlationId: corr() }),
    /Missing capability/
  );
  await assert.rejects(
    uploads.begin.handler(makeCtx(db, null), { name: "t.csv", mime: "text/csv", correlationId: corr() }),
    /Not authenticated/
  );
});

await test("attach: requires admin.system_settings.manage capability", async () => {
  const db = new FixtureDatabase();
  await assert.rejects(
    uploads.attach.handler(makeCtx(db, viewer), { uploadId: "enterpriseUploads:1", storageId: "_storage:1" }),
    /Missing capability/
  );
});

await test("queue: requires admin.system_settings.manage capability", async () => {
  const db = new FixtureDatabase();
  await assert.rejects(
    uploads.queue.handler(makeCtx(db, viewer), { uploadId: "enterpriseUploads:1" }),
    /Missing capability/
  );
});

await test("list: requires admin.system_settings.manage capability", async () => {
  const db = new FixtureDatabase();
  await assert.rejects(
    uploads.list.handler(makeCtx(db, viewer), {}),
    /Missing capability/
  );
});

await test("get: requires admin.system_settings.manage capability", async () => {
  const db = new FixtureDatabase();
  await assert.rejects(
    uploads.get.handler(makeCtx(db, viewer), { uploadId: "enterpriseUploads:1" }),
    /Missing capability/
  );
});

await test("datasets: requires inventory.read AND rem.read capabilities", async () => {
  const db = new FixtureDatabase();
  await assert.rejects(
    uploads.datasets.handler(makeCtx(db, null), {}),
    /Not authenticated/
  );
});

await test("datasets: viewer (inventory.read + rem.read) is allowed", async () => {
  const db = new FixtureDatabase();
  const result = await uploads.datasets.handler(makeCtx(db, viewer), {});
  assert.ok(result.items !== undefined);
});

// ===========================================================================
// 9. BEGIN — idempotency, name conflict, correlation format
// ===========================================================================

await test("begin: creates new upload record and returns uploadUrl", async () => {
  const db = new FixtureDatabase();
  const cid = corr();
  const result = await uploads.begin.handler(makeCtx(db, admin), {
    name: "stock.csv",
    mime: "text/csv",
    correlationId: cid,
  });
  assert.ok(result.uploadId);
  assert.ok(result.uploadUrl, "New upload should have uploadUrl");
  assert.equal(result.attached, false);
  const row = await db.get(result.uploadId);
  assert.equal(row.status, "stored");
  assert.equal(row.actor, admin.userId);
  assert.equal(row.correlationId, cid);
});

await test("begin: idempotent call with same actor+correlation returns existing", async () => {
  const db = new FixtureDatabase();
  const cid = corr();
  const first = await uploads.begin.handler(makeCtx(db, admin), {
    name: "stock.csv",
    mime: "text/csv",
    correlationId: cid,
  });
  const second = await uploads.begin.handler(makeCtx(db, admin), {
    name: "stock.csv",
    mime: "text/csv",
    correlationId: cid,
  });
  assert.equal(first.uploadId, second.uploadId);
});

await test("begin: name/mime conflict on same correlationId rejects", async () => {
  const db = new FixtureDatabase();
  const cid = corr();
  await uploads.begin.handler(makeCtx(db, admin), {
    name: "stock.csv",
    mime: "text/csv",
    correlationId: cid,
  });
  await assert.rejects(
    uploads.begin.handler(makeCtx(db, admin), {
      name: "different.xlsx",
      mime: "application/vnd.openxmlformats",
      correlationId: cid,
    }),
    /already belongs to a different file/
  );
});

await test("begin: invalid correlation format rejected", async () => {
  const db = new FixtureDatabase();
  await assert.rejects(
    uploads.begin.handler(makeCtx(db, admin), {
      name: "t.csv",
      mime: "text/csv",
      correlationId: "short",
    }),
    /stable upload request/
  );
});

await test("begin: empty or oversized name rejected", async () => {
  const db = new FixtureDatabase();
  await assert.rejects(
    uploads.begin.handler(makeCtx(db, admin), {
      name: "  ",
      mime: "text/csv",
      correlationId: corr(),
    }),
    /filename/
  );
  await assert.rejects(
    uploads.begin.handler(makeCtx(db, admin), {
      name: "x".repeat(600),
      mime: "text/csv",
      correlationId: corr(),
    }),
    /filename/
  );
});

await test("begin: existing upload with storageId returns attached=true and no uploadUrl", async () => {
  const db = new FixtureDatabase();
  const cid = corr();
  const first = await uploads.begin.handler(makeCtx(db, admin), {
    name: "stock.csv",
    mime: "text/csv",
    correlationId: cid,
  });
  // Attach storage manually
  const storage = createStorage();
  const sid = await storage.store(new Blob(["data"], { type: "text/csv" }));
  await db.patch(first.uploadId, { storageId: sid });
  // Retry begin
  const second = await uploads.begin.handler(makeCtx(db, admin), {
    name: "stock.csv",
    mime: "text/csv",
    correlationId: cid,
  });
  assert.equal(second.attached, true);
  assert.equal(second.uploadUrl, null);
});

// ===========================================================================
// 10. ATTACH — original preservation and conflict
// ===========================================================================

await test("attach: attaches storage to upload", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db);
  const storage = createStorage();
  const sid = await storage.store(new Blob(["data"], { type: "text/csv" }));
  await uploads.attach.handler(makeCtx(db, admin, storage), {
    uploadId: uid,
    storageId: sid,
  });
  const row = await db.get(uid);
  assert.equal(row.storageId, sid);
  assert.equal(row.status, "stored");
});

await test("attach: rejects when original already retained with different storageId", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db, { storageId: "_storage:existing" });
  await assert.rejects(
    uploads.attach.handler(makeCtx(db, admin), {
      uploadId: uid,
      storageId: "_storage:different",
    }),
    /already retained/
  );
});

await test("attach: same storageId is idempotent", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db, { storageId: "_storage:existing" });
  const result = await uploads.attach.handler(makeCtx(db, admin), {
    uploadId: uid,
    storageId: "_storage:existing",
  });
  assert.equal(result, null);
});

await test("attach: upload not found rejects", async () => {
  const db = new FixtureDatabase();
  await assert.rejects(
    uploads.attach.handler(makeCtx(db, admin), {
      uploadId: "enterpriseUploads:9999",
      storageId: "_storage:1",
    }),
    /Upload not found/
  );
});

// ===========================================================================
// 11. QUEUE — active parse lease, no duplicate scheduling, generation bump
// ===========================================================================

await test("queue: queues analysis and bumps generation", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db, { storageId: "_storage:1" });
  scheduled = [];
  const result = await uploads.queue.handler(makeCtx(db, admin), { uploadId: uid });
  assert.ok(result.generation >= 1);
  const row = await db.get(uid);
  assert.equal(row.status, "queued");
  assert.equal(row.generation, 1);
  assert.equal(scheduled.length, 1);
});

await test("queue: rejects when no storageId (no original file)", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db);
  await assert.rejects(
    uploads.queue.handler(makeCtx(db, admin), { uploadId: uid }),
    /Transfer the original file/
  );
});

await test("queue: active lease (queued+parsing within 10min) returns same generation without re-scheduling", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db, {
    storageId: "_storage:1",
    status: "queued",
    generation: 3,
    updatedAt: Date.now(),
  });
  scheduled = [];
  const result = await uploads.queue.handler(makeCtx(db, admin), { uploadId: uid });
  assert.equal(result.generation, 3);
  assert.equal(scheduled.length, 0, "Should not re-schedule");
});

await test("queue: expired lease (>10min) allows re-queuing", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db, {
    storageId: "_storage:1",
    status: "queued",
    generation: 2,
    updatedAt: Date.now() - 15 * 60_000, // 15 minutes ago
  });
  scheduled = [];
  const result = await uploads.queue.handler(makeCtx(db, admin), { uploadId: uid });
  assert.equal(result.generation, 3);
  assert.equal(scheduled.length, 1);
});

// ===========================================================================
// 12. FINISH — generation-safe completion
// ===========================================================================

await test("finish: accepts when generation matches", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db, { generation: 2, status: "queued" });
  const result = await uploads.finish.handler(makeCtx(db, admin), {
    uploadId: uid,
    generation: 2,
    status: "review",
    message: "Done",
    aiStatus: "complete",
    summaries: [],
  });
  assert.equal(result, true);
  const row = await db.get(uid);
  assert.equal(row.status, "review");
});

await test("finish: rejects when generation mismatched (stale)", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db, { generation: 3, status: "queued" });
  const result = await uploads.finish.handler(makeCtx(db, admin), {
    uploadId: uid,
    generation: 2, // stale
    status: "review",
    message: "Done",
    aiStatus: "complete",
    summaries: [],
  });
  assert.equal(result, false);
});

await test("finish: rejects when upload not found", async () => {
  const db = new FixtureDatabase();
  const result = await uploads.finish.handler(makeCtx(db, admin), {
    uploadId: "enterpriseUploads:9999",
    generation: 1,
    status: "review",
    message: "Done",
    aiStatus: "complete",
    summaries: [],
  });
  assert.equal(result, false);
});

// ===========================================================================
// 13. MARK PARSING — status gate
// ===========================================================================

await test("markParsing: transitions from queued to parsing when generation matches", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db, { generation: 1, status: "queued" });
  const result = await uploads.markParsing.handler(makeCtx(db, admin), {
    uploadId: uid,
    generation: 1,
  });
  assert.equal(result, true);
  const row = await db.get(uid);
  assert.equal(row.status, "parsing");
});

await test("markParsing: returns false when status is not queued", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db, { generation: 1, status: "stored" });
  const result = await uploads.markParsing.handler(makeCtx(db, admin), {
    uploadId: uid,
    generation: 1,
  });
  assert.equal(result, false);
});

await test("markParsing: returns false when generation mismatched", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db, { generation: 2, status: "queued" });
  const result = await uploads.markParsing.handler(makeCtx(db, admin), {
    uploadId: uid,
    generation: 1,
  });
  assert.equal(result, false);
});

// ===========================================================================
// 14. PUBLISH INTERNAL — exact revision, parsed storage identity, idempotency,
//     changed request rejection, actor receipt, audit trail
// ===========================================================================

async function setupPublishable(db) {
  const storage = createStorage();
  const parsedBlob = new Blob([JSON.stringify({ tables: [] })], { type: "application/json" });
  const parsedSid = await storage.store(parsedBlob);
  const uid = await makeUpload(db, {
    storageId: "_storage:orig",
    parsedStorageId: parsedSid,
    status: "review",
    revision: 1,
  });
  return { uid, parsedSid, storage };
}

const dummyMapping = {
  name: "Test",
  destination: "inventory",
  headerRow: 1,
  excludedRows: [],
  fields: [
    { column: 0, label: "SKU", role: "identifier", kind: "text", visible: true, metric: false },
  ],
  dateFormat: "iso",
};

await test("publishInternal: creates dataset and audit on first publish", async () => {
  const db = new FixtureDatabase();
  const { uid, parsedSid } = await setupPublishable(db);
  const cid = corr();
  const result = await uploads.publishInternal.handler(makeCtx(db, admin), {
    uploadId: uid,
    actor: admin.userId,
    parsedStorageId: parsedSid,
    tableKey: "table-1",
    expectedRevision: 1,
    expectedDatasetRevision: 0,
    mapping: dummyMapping,
    rowCount: 10,
    correlationId: cid,
  });
  assert.ok(result.datasetId);
  assert.equal(result.duplicate, false);
  const audit = [...db.rows.values()].filter((r) => r._id.startsWith("enterpriseUploadAudit:"));
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor, admin.userId);
  assert.ok(audit[0].before === null, "First publish has no before");
  assert.ok(audit[0].after, "First publish has after");
  assert.equal(audit[0].datasetId, result.datasetId, "audit has datasetId at top level");
  const upload = await db.get(uid);
  assert.equal(upload.status, "published");
});

await test("publishInternal: exact replay returns same datasetId with duplicate=true", async () => {
  const db = new FixtureDatabase();
  const { uid, parsedSid } = await setupPublishable(db);
  const cid = corr();
  const first = await uploads.publishInternal.handler(makeCtx(db, admin), {
    uploadId: uid,
    actor: admin.userId,
    parsedStorageId: parsedSid,
    tableKey: "table-1",
    expectedRevision: 1,
    expectedDatasetRevision: 0,
    mapping: dummyMapping,
    rowCount: 10,
    correlationId: cid,
  });
  const second = await uploads.publishInternal.handler(makeCtx(db, admin), {
    uploadId: uid,
    actor: admin.userId,
    parsedStorageId: parsedSid,
    tableKey: "table-1",
    expectedRevision: 1,
    expectedDatasetRevision: 0,
    mapping: dummyMapping,
    rowCount: 10,
    correlationId: cid,
  });
  assert.equal(first.datasetId, second.datasetId);
  assert.equal(second.duplicate, true);
  // No duplicate audit for idempotent replay
  const audit = [...db.rows.values()].filter((r) => r._id.startsWith("enterpriseUploadAudit:"));
  assert.equal(audit.length, 1);
});

await test("publishInternal: changed request with same correlationId rejects", async () => {
  const db = new FixtureDatabase();
  const { uid, parsedSid } = await setupPublishable(db);
  const cid = corr();
  await uploads.publishInternal.handler(makeCtx(db, admin), {
    uploadId: uid,
    actor: admin.userId,
    parsedStorageId: parsedSid,
    tableKey: "table-1",
    expectedRevision: 1,
    expectedDatasetRevision: 0,
    mapping: dummyMapping,
    rowCount: 10,
    correlationId: cid,
  });
  // Different mapping = changed request
  const changedMapping = { ...dummyMapping, name: "Changed" };
  await assert.rejects(
    uploads.publishInternal.handler(makeCtx(db, admin), {
      uploadId: uid,
      actor: admin.userId,
      parsedStorageId: parsedSid,
      tableKey: "table-1",
      expectedRevision: 1,
      mapping: changedMapping,
      rowCount: 10,
      correlationId: cid,
    }),
    /publication request changed/
  );
});

await test("publishInternal: wrong revision rejects", async () => {
  const db = new FixtureDatabase();
  const { uid, parsedSid } = await setupPublishable(db);
  await assert.rejects(
    uploads.publishInternal.handler(makeCtx(db, admin), {
      uploadId: uid,
      actor: admin.userId,
      parsedStorageId: parsedSid,
      tableKey: "table-1",
      expectedRevision: 99, // wrong
      mapping: dummyMapping,
      rowCount: 10,
      correlationId: corr(),
    }),
    /upload changed/
  );
});

await test("publishInternal: wrong parsedStorageId rejects", async () => {
  const db = new FixtureDatabase();
  const { uid, parsedSid } = await setupPublishable(db);
  await assert.rejects(
    uploads.publishInternal.handler(makeCtx(db, admin), {
      uploadId: uid,
      actor: admin.userId,
      parsedStorageId: "_storage:wrong",
      tableKey: "table-1",
      expectedRevision: 1,
      mapping: dummyMapping,
      rowCount: 10,
      correlationId: corr(),
    }),
    /upload changed/
  );
});

await test("publishInternal: upload not in review/published status rejects", async () => {
  const db = new FixtureDatabase();
  const storage = createStorage();
  const parsedSid = await storage.store(new Blob(["{}"], { type: "application/json" }));
  const uid = await makeUpload(db, {
    storageId: "_storage:orig",
    parsedStorageId: parsedSid,
    status: "needs_attention", // not review/published
    revision: 1,
  });
  await assert.rejects(
    uploads.publishInternal.handler(makeCtx(db, admin), {
      uploadId: uid,
      actor: admin.userId,
      parsedStorageId: parsedSid,
      tableKey: "table-1",
      expectedRevision: 1,
      mapping: dummyMapping,
      rowCount: 10,
      correlationId: corr(),
    }),
    /upload changed/
  );
});

await test("publishInternal: second publish of same tableKey replaces dataset and has audit before/after", async () => {
  const db = new FixtureDatabase();
  const storage = createStorage();
  const parsedSid = await storage.store(new Blob(["{}"], { type: "application/json" }));
  // Publish revision 1
  const uid1 = await makeUpload(db, {
    storageId: "_storage:orig",
    parsedStorageId: parsedSid,
    status: "review",
    revision: 1,
  });
  const cid1 = corr();
  await uploads.publishInternal.handler(makeCtx(db, admin), {
    uploadId: uid1,
    actor: admin.userId,
    parsedStorageId: parsedSid,
    tableKey: "table-1",
    expectedRevision: 1,
    expectedDatasetRevision: 0,
    mapping: dummyMapping,
    rowCount: 10,
    correlationId: cid1,
  });
  // Publish revision 2 (new upload, same tableKey)
  const uid2 = await makeUpload(db, {
    storageId: "_storage:orig",
    parsedStorageId: parsedSid,
    status: "review",
    revision: 2,
  });
  // Link to same upload by using the same uploadId — actually, publishInternal
  // looks up upload by uploadId, and datasets by uploadId+tableKey.
  // So we need to publish from the same upload with new revision.
  await db.patch(uid1, { revision: 2, status: "review" });
  const cid2 = corr();
  const result = await uploads.publishInternal.handler(makeCtx(db, admin), {
    uploadId: uid1,
    actor: admin.userId,
    parsedStorageId: parsedSid,
    tableKey: "table-1",
    expectedRevision: 2,
    expectedDatasetRevision: 1,
    mapping: dummyMapping,
    rowCount: 15,
    correlationId: cid2,
  });
  assert.equal(result.duplicate, false);
  const audit = [...db.rows.values()]
    .filter((r) => r._id.startsWith("enterpriseUploadAudit:"))
    .sort((a, b) => a.createdAt - b.createdAt);
  assert.ok(audit.length >= 2, "Both publishes have audit entries");
  const secondAudit = audit[1];
  assert.ok(secondAudit.before !== null, "Second publish audit should have before state");
  assert.ok(secondAudit.after, "Second publish audit should have after state");
  assert.equal(secondAudit.actor, admin.userId);
});

await test("publishInternal: changed actor must not claim another actor's receipt", async () => {
  const db = new FixtureDatabase();
  const { uid, parsedSid } = await setupPublishable(db);
  const cid = corr();
  // Publish as admin
  await uploads.publishInternal.handler(makeCtx(db, admin), {
    uploadId: uid,
    actor: admin.userId,
    parsedStorageId: parsedSid,
    tableKey: "table-1",
    expectedRevision: 1,
    expectedDatasetRevision: 0,
    mapping: dummyMapping,
    rowCount: 10,
    correlationId: cid,
  });
  // Replay as engineer with same correlationId
  // The audit is keyed by actor+correlationId, so engineer won't find the prior receipt
  // This means it tries a new publish, not an idempotent replay
  const result = await uploads.publishInternal.handler(makeCtx(db, engineer), {
    uploadId: uid,
    actor: engineer.userId,
    parsedStorageId: parsedSid,
    tableKey: "table-1",
    expectedRevision: 1,
    expectedDatasetRevision: 1,
    mapping: dummyMapping,
    rowCount: 10,
    correlationId: cid,
  });
  // It's a different actor, so it's NOT a duplicate — it's a new publication attempt
  assert.equal(result.duplicate, false, "Different actor is not a duplicate");
  // The dataset still exists (same uploadId+tableKey), so it gets updated
  assert.ok(result.datasetId);
});

await test("publishInternal: invalid correlation format rejects", async () => {
  const db = new FixtureDatabase();
  const { uid, parsedSid } = await setupPublishable(db);
  await assert.rejects(
    uploads.publishInternal.handler(makeCtx(db, admin), {
      uploadId: uid,
      actor: admin.userId,
      parsedStorageId: parsedSid,
      tableKey: "t",
      expectedRevision: 1,
      mapping: dummyMapping,
      rowCount: 10,
      correlationId: "bad",
    }),
    /stable upload request/
  );
});

// ===========================================================================
// 15. PAGINATION — history/datasets contract
// ===========================================================================

await test("list: returns paginated results with cursor", async () => {
  const db = new FixtureDatabase();
  for (let i = 0; i < 3; i++) {
    await db.insert("enterpriseUploads", {
      actor: admin.userId,
      correlationId: corr(),
      name: `file${i}.csv`,
      mime: "text/csv",
      status: "stored",
      message: "Ready.",
      revision: 0,
      generation: 0,
      updatedAt: Date.now() + i,
    });
  }
  const page1 = await uploads.list.handler(makeCtx(db, admin), {});
  assert.ok(Array.isArray(page1.items));
  assert.equal(page1.items.length, 3);
  // Next cursor may be null since 3 <= 50
  assert.equal(page1.nextCursor, null);
});

await test("datasets: returns paginated results with cursor", async () => {
  const db = new FixtureDatabase();
  for (let i = 0; i < 2; i++) {
    await db.insert("enterpriseDatasets", {
      uploadId: "enterpriseUploads:1",
      tableKey: `table-${i}`,
      parsedStorageId: "_storage:1",
      mapping: dummyMapping,
      revision: 1,
      rowCount: 10,
      sourceHash: "h",
      actor: admin.userId,
      updatedAt: Date.now() + i,
    });
  }
  const result = await uploads.datasets.handler(makeCtx(db, viewer), {});
  assert.ok(Array.isArray(result.items));
  assert.equal(result.items.length, 2);
  assert.equal(result.nextCursor, null);
});

await test("list: page with numItems=50 limit respected", async () => {
  const db = new FixtureDatabase();
  for (let i = 0; i < 2; i++) {
    await db.insert("enterpriseUploads", {
      actor: admin.userId,
      correlationId: corr(),
      name: `f${i}.csv`,
      mime: "text/csv",
      status: "stored",
      message: "Ready.",
      revision: 0,
      generation: 0,
      updatedAt: Date.now() + i,
    });
  }
  // Request with cursor=null should use numItems=50 internally
  const result = await uploads.list.handler(makeCtx(db, admin), { cursor: null });
  assert.ok(result.items.length <= 50);
});

// ===========================================================================
// 16. GET — returns upload with originalURL
// ===========================================================================

await test("get: returns upload with originalURL when storageId present", async () => {
  const db = new FixtureDatabase();
  const storage = createStorage();
  const sid = await storage.store(new Blob(["data"], { type: "text/csv" }));
  const uid = await makeUpload(db, { storageId: sid });
  const result = await uploads.get.handler(makeCtx(db, admin, storage), { uploadId: uid });
  assert.ok(result.originalURL);
  assert.match(result.originalURL, /fixture-storage/);
});

await test("get: returns null originalURL when no storageId", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db);
  const result = await uploads.get.handler(makeCtx(db, admin), { uploadId: uid });
  assert.equal(result.originalURL, null);
});

await test("get: upload not found rejects", async () => {
  const db = new FixtureDatabase();
  await assert.rejects(
    uploads.get.handler(makeCtx(db, admin), { uploadId: "enterpriseUploads:9999" }),
    /Upload not found/
  );
});

// ===========================================================================
// 17. ATTACH TEXT — recovery text handling
// ===========================================================================

await test("attachText: attaches text storage to upload", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db, { storageId: "_storage:orig" });
  const storage = createStorage();
  const textSid = await storage.store(new Blob(["recovery text"], { type: "text/plain" }));
  await uploads.attachText.handler(makeCtx(db, admin, storage), {
    uploadId: uid,
    textStorageId: textSid,
  });
  const row = await db.get(uid);
  assert.equal(row.textStorageId, textSid);
  assert.equal(row.status, "stored");
});

await test("attachText: rejects when upload not found", async () => {
  const db = new FixtureDatabase();
  await assert.rejects(
    uploads.attachText.handler(makeCtx(db, admin), {
      uploadId: "enterpriseUploads:9999",
      textStorageId: "_storage:1",
    }),
    /Original upload not found/
  );
});

await test("attachText: rejects when active analysis lease", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db, {
    storageId: "_storage:orig",
    status: "queued",
    updatedAt: Date.now(),
  });
  const storage = createStorage();
  const textSid = await storage.store(new Blob(["text"], { type: "text/plain" }));
  await assert.rejects(
    uploads.attachText.handler(makeCtx(db, admin, storage), {
      uploadId: uid,
      textStorageId: textSid,
    }),
    /Wait for the current analysis/
  );
});

await test("attachText: no original upload rejects", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db);
  const storage = createStorage();
  const textSid = await storage.store(new Blob(["text"], { type: "text/plain" }));
  await assert.rejects(
    uploads.attachText.handler(makeCtx(db, admin, storage), {
      uploadId: uid,
      textStorageId: textSid,
    }),
    /Original upload not found/
  );
});

// ===========================================================================
// 18. TEXT UPLOAD URL
// ===========================================================================

await test("textUploadURL: requires admin capability", async () => {
  const db = new FixtureDatabase();
  await assert.rejects(
    uploads.textUploadURL.handler(makeCtx(db, viewer), {}),
    /Missing capability/
  );
});

await test("textUploadURL: returns upload URL for admin", async () => {
  const db = new FixtureDatabase();
  const result = await uploads.textUploadURL.handler(makeCtx(db, admin), {});
  assert.ok(typeof result === "string");
  assert.ok(result.length > 0);
});

// ===========================================================================
// 19. ALL MATERIAL PUBLISHES HAVE BEFORE/AFTER AND ACTOR AUDIT
// ===========================================================================

await test("publishInternal: audit record always has actor, before, after, correlationId", async () => {
  const db = new FixtureDatabase();
  const { uid, parsedSid } = await setupPublishable(db);
  const cid = corr();
  await uploads.publishInternal.handler(makeCtx(db, admin), {
    uploadId: uid,
    actor: admin.userId,
    parsedStorageId: parsedSid,
    tableKey: "table-1",
    expectedRevision: 1,
    expectedDatasetRevision: 0,
    mapping: dummyMapping,
    rowCount: 10,
    correlationId: cid,
  });
  const audits = [...db.rows.values()].filter((r) => r._id.startsWith("enterpriseUploadAudit:"));
  assert.equal(audits.length, 1);
  const a = audits[0];
  assert.equal(a.actor, admin.userId, "audit has actor");
  assert.equal(a.before, null, "first publish: before is null");
  assert.ok(a.after, "audit has after");
  assert.ok(a.datasetId, "audit has datasetId at top level");
  assert.deepEqual(a.after.mapping, dummyMapping, "after has mapping");
  assert.equal(a.after.rowCount, 10);
  assert.equal(a.correlationId, cid, "audit has correlationId");
  assert.equal(a.operation, "publish_snapshot");
  assert.ok(a.createdAt > 0, "audit has createdAt");
});

// ===========================================================================
// 20. REPORTING SNAPSHOTS: NO STOCK/SAP MUTATION
// ===========================================================================

await test("publishInternal: dataset record is reporting snapshot only", async () => {
  const db = new FixtureDatabase();
  const { uid, parsedSid } = await setupPublishable(db);
  const cid = corr();
  const result = await uploads.publishInternal.handler(makeCtx(db, admin), {
    uploadId: uid,
    actor: admin.userId,
    parsedStorageId: parsedSid,
    tableKey: "table-1",
    expectedRevision: 1,
    expectedDatasetRevision: 0,
    mapping: dummyMapping,
    rowCount: 10,
    correlationId: cid,
  });
  const dataset = await db.get(result.datasetId);
  // Must have mapping, parsedStorageId, revision, actor — no SAP/stock fields
  assert.ok(dataset.mapping, "dataset has mapping");
  assert.ok(dataset.parsedStorageId, "dataset has parsedStorageId");
  assert.equal(dataset.revision, 1);
  assert.equal(dataset.actor, admin.userId);
  assert.ok(!("stockQty" in dataset), "no stockQty field");
  assert.ok(!("sapDocument" in dataset), "no SAP document field");
});

// ===========================================================================
// 21. WRITES-READ CHECK — list/get/datasets do not write
// ===========================================================================

await test("list does not write to database", async () => {
  const db = new FixtureDatabase();
  await makeUpload(db);
  const working = db.clone();
  working.writes = 0;
  await uploads.list.handler(makeCtx(working, admin), {});
  assert.equal(working.writes, 0, "list must not write");
});

await test("get does not write to database", async () => {
  const db = new FixtureDatabase();
  const uid = await makeUpload(db);
  const working = db.clone();
  working.writes = 0;
  await uploads.get.handler(makeCtx(working, admin), { uploadId: uid });
  assert.equal(working.writes, 0, "get must not write");
});

await test("datasets does not write to database", async () => {
  const db = new FixtureDatabase();
  await db.insert("enterpriseDatasets", {
    uploadId: "enterpriseUploads:1",
    tableKey: "t",
    parsedStorageId: "_storage:1",
    mapping: dummyMapping,
    revision: 1,
    rowCount: 0,
    sourceHash: "",
    actor: admin.userId,
    updatedAt: Date.now(),
  });
  const working = db.clone();
  working.writes = 0;
  await uploads.datasets.handler(makeCtx(working, viewer), {});
  assert.equal(working.writes, 0, "datasets must not write");
});

// ===========================================================================
// RESULTS
// ===========================================================================

console.log(`\nACTUAL_ENTERPRISE_UPLOAD_CHECK: ${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
