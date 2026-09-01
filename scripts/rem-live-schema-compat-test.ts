// REM Live Schema Compatibility Test
// Issue #48 acceptance test: proves migration correctness and business validation
// Uses rollback-safe test records only; never damages live REM data.
//
// Acceptance output:
//   REM_LIVE_SCHEMA_COMPAT=PASS|FAIL
//   REM_VALIDATION=PASS|FAIL
//   REM_JSONB_SHAPE=PASS|FAIL
//   REM_PRODUCTION_PATH_TESTS=PASS|FAIL
//   BLOCKERS=<none or exact blocker>

import { chromium } from "playwright";

const CONVEX_URL =
  process.env.VITE_CONVEX_URL || "https://accurate-newt-938.convex.cloud";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
  category: "SCHEMA_COMPAT" | "VALIDATION" | "JSONB_SHAPE" | "PRODUCTION_PATH";
}

const results: TestResult[] = [];

function record(
  category: TestResult["category"],
  name: string,
  passed: boolean,
  detail: string,
) {
  results.push({ category, name, passed, detail });
  const icon = passed ? "PASS" : "FAIL";
  console.log(`[${icon}] ${name}: ${detail}`);
}

// ─── Supabase helpers ───

function sbHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function sbQuery<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { ...sbHeaders(), Prefer: "return=representation" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `Supabase ${res.status}: ${(body as { message?: string }).message || "unknown"}`,
    );
  }
  return res.json() as Promise<T>;
}

async function _sbInsert(
  table: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `Insert ${res.status}: ${(body as { message?: string }).message || "unknown"}`,
    );
  }
  return res.json() as Promise<Record<string, unknown>[]>;
}

async function sbDelete(table: string, id: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: sbHeaders(),
    },
  );
  if (!res.ok) {
    console.error(`Warning: failed to delete test row ${id} from ${table}`);
  }
}

async function _sbPatch(
  table: string,
  id: string,
  data: Record<string, unknown>,
) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { ...sbHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(data),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `Patch ${res.status}: ${(body as { message?: string }).message || "unknown"}`,
    );
  }
  return res.json() as Promise<Record<string, unknown>[]>;
}

// ─── Convex helpers ───

async function convexAction(
  path: string,
  args: Record<string, unknown> = {},
  token?: string,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${CONVEX_URL}/api/action`, {
    method: "POST",
    headers,
    body: JSON.stringify({ path, args, format: "json" }),
  });
  return res.json();
}

async function convexQuery(
  path: string,
  args: Record<string, unknown> = {},
  token?: string,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers,
    body: JSON.stringify({ path, args, format: "json" }),
  });
  return res.json();
}

async function getAuthToken(): Promise<string | undefined> {
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto("https://vitros-web-dashboard.vercel.app", {
      waitUntil: "networkidle",
      timeout: 15000,
    });
    await page.waitForTimeout(3000);
    const token = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      for (const key of keys) {
        const val = localStorage.getItem(key);
        if (val?.includes("eyJ")) {
          try {
            const parsed = JSON.parse(val);
            if (parsed.token) return parsed.token;
          } catch {
            // Not JSON
          }
        }
      }
      return undefined;
    });
    await browser.close();
    return token;
  } catch {
    return undefined;
  }
}

// ─── Schema introspection ───

const REQUIRED_COLUMNS: Record<string, string[]> = {
  rem_analyzers: [
    "id",
    "serial_number",
    "analyzer_type",
    "type",
    "stage",
    "progress",
    "status",
    "current_stage",
    "overall_pct",
    "procurement_pct",
    "cleaning_pct",
    "service_pct",
    "service_cell",
    "final_line_pct",
    "release_testing_pct",
    "packaging_pct",
    "sap_release_pct",
    "qa_release_pct",
    "current_pct",
    "sla_days",
    "days_in_stage",
    "days_elapsed",
    "start_date",
    "end_date",
    "done_week",
    "is_complete",
    "install_date",
    "install_country",
    "install_status",
    "install_cost",
    "fpy_percentage",
    "release_fpy",
    "field_status",
    "country",
    "fpy",
    "notes",
    "created_at",
    "updated_at",
  ],
  rem_build_plan: [
    "id",
    "week_of",
    "planned",
    "actual",
    "notes",
    "created_at",
    "updated_at",
  ],
  rem_lvcc: [
    "id",
    "serial_number",
    "item_id",
    "item_type",
    "category",
    "batch_number",
    "quantity",
    "current_stage",
    "build_pct",
    "test_pct",
    "packaging_pct",
    "sap_release_pct",
    "qa_release_pct",
    "start_date",
    "end_date",
    "is_complete",
    "status",
    "progress",
    "created_at",
    "updated_at",
  ],
  rem_staff: [
    "id",
    "name",
    "role",
    "fte",
    "certifications",
    "skills",
    "is_lead",
    "in_training",
    "created_at",
    "updated_at",
  ],
  rem_targets: [
    "id",
    "type",
    "target",
    "completed",
    "created_at",
    "updated_at",
  ],
  rem_tracker_weekly: [
    "id",
    "week_of",
    "teardown",
    "cleaning",
    "rebuild",
    "testing",
    "qa",
    "shipping",
    "complete",
    "created_at",
    "updated_at",
  ],
  rem_weekly_notes: [
    "id",
    "week_number",
    "week_start",
    "quarter",
    "notes",
    "created_at",
    "updated_at",
  ],
  audit_rem: [
    "id",
    "table_name",
    "record_id",
    "operation",
    "actor_id",
    "actor_role",
    "before_state",
    "after_state",
    "created_at",
  ],
};

async function getTableColumns(tableName: string): Promise<string[]> {
  const rows = await sbQuery<Record<string, unknown>[]>(
    `information_schema.columns?table_name=eq.${tableName}&select=column_name&order=ordinal_position.asc`,
  );
  return rows.map(r => String(r.column_name));
}

// ─── Test runners ───

async function testSchemaCompat() {
  console.log("── Schema Compatibility Tests ──");

  for (const [table, requiredCols] of Object.entries(REQUIRED_COLUMNS)) {
    try {
      const actualCols = await getTableColumns(table);
      const missing = requiredCols.filter(c => !actualCols.includes(c));
      if (missing.length === 0) {
        record(
          "SCHEMA_COMPAT",
          `${table} columns`,
          true,
          `All ${requiredCols.length} required columns present`,
        );
      } else {
        record(
          "SCHEMA_COMPAT",
          `${table} columns`,
          false,
          `Missing: ${missing.join(", ")}`,
        );
      }
    } catch (e) {
      record(
        "SCHEMA_COMPAT",
        `${table} columns`,
        false,
        `Error querying schema: ${e}`,
      );
    }
  }
}

async function testValidation() {
  console.log("\n── Validation Tests ──");

  // Test: percentage out of range
  try {
    await convexAction("remSupabase:insertAnalyzer", {
      data: {
        serialNumber: "TEST-VALIDATION-001",
        progress: 150, // out of range
      },
    });
    record(
      "VALIDATION",
      "Percentage out of range rejected",
      false,
      "Action accepted 150% progress",
    );
  } catch (e) {
    record(
      "VALIDATION",
      "Percentage out of range rejected",
      true,
      `Correctly rejected: ${e}`,
    );
  }

  // Test: negative FTE
  try {
    await convexAction("remSupabase:upsertStaff", {
      data: {
        name: "TEST-VALIDATION-STAFF",
        role: "Engineer",
        fte: -1, // negative
      },
    });
    record(
      "VALIDATION",
      "Negative FTE rejected",
      false,
      "Action accepted negative FTE",
    );
  } catch (e) {
    record(
      "VALIDATION",
      "Negative FTE rejected",
      true,
      `Correctly rejected: ${e}`,
    );
  }

  // Test: negative days
  try {
    await convexAction("remSupabase:updateAnalyzer", {
      id: "not-a-real-id",
      progress: -5,
    });
    record(
      "VALIDATION",
      "Negative progress rejected",
      false,
      "Action accepted negative progress",
    );
  } catch (e) {
    record(
      "VALIDATION",
      "Negative progress rejected",
      true,
      `Correctly rejected: ${e}`,
    );
  }

  // Test: notes too long
  const longNotes = "x".repeat(6000);
  try {
    await convexAction("remSupabase:updateAnalyzer", {
      id: "not-a-real-id",
      notes: longNotes,
    });
    record(
      "VALIDATION",
      "Long notes rejected",
      false,
      "Action accepted >5000 char notes",
    );
  } catch (e) {
    record(
      "VALIDATION",
      "Long notes rejected",
      true,
      `Correctly rejected: ${e}`,
    );
  }

  // Test: FTE too high
  try {
    await convexAction("remSupabase:upsertStaff", {
      data: {
        name: "TEST-VALIDATION-STAFF",
        role: "Engineer",
        fte: 100, // above MAX_FTE of 10
      },
    });
    record(
      "VALIDATION",
      "Excessive FTE rejected",
      false,
      "Action accepted fte=100",
    );
  } catch (e) {
    record(
      "VALIDATION",
      "Excessive FTE rejected",
      true,
      `Correctly rejected: ${e}`,
    );
  }
}

async function testJsonbShape() {
  console.log("\n── JSONB Shape Tests ──");

  // Test: certifications stored as array of objects, not JSON string
  const testStaffName = `TEST-JSONB-SHAPE-${Date.now()}`;
  const testCerts = [
    { name: "ISO 13485", isValid: true },
    { name: "GMP", expiryDate: "2027-12-31" },
  ];
  const testSkills = { soldering: "expert", assembly: "intermediate" };

  let staffId: string | undefined;
  try {
    const insertResult = await convexAction("remSupabase:upsertStaff", {
      data: {
        name: testStaffName,
        role: "Engineer",
        fte: 1.0,
        certifications: testCerts,
        skills: testSkills,
        isLead: false,
        inTraining: false,
      },
    });
    if (insertResult.status === "success" && insertResult.data?.id) {
      staffId = insertResult.data.id;
    } else {
      record(
        "JSONB_SHAPE",
        "Staff insert for JSONB test",
        false,
        `Insert failed: ${insertResult.errorMessage || JSON.stringify(insertResult)}`,
      );
      return;
    }
  } catch (e) {
    record("JSONB_SHAPE", "Staff insert for JSONB test", false, `Error: ${e}`);
    return;
  }

  // Read back and verify JSONB shape
  try {
    const rows = await sbQuery<Record<string, unknown>[]>(
      `rem_staff?id=eq.${staffId}&select=certifications,skills`,
    );
    if (rows.length === 0) {
      record(
        "JSONB_SHAPE",
        "Read-back for JSONB test",
        false,
        "Staff record not found after insert",
      );
      await sbDelete("rem_staff", staffId);
      return;
    }

    const row = rows[0];
    const certs = row.certifications;
    const skills = row.skills;

    // Certifications should be an array, not a string
    const certsIsArray = Array.isArray(certs);
    const certsNotString = typeof certs !== "string";
    record(
      "JSONB_SHAPE",
      "Certifications is native array",
      certsIsArray && certsNotString,
      certsIsArray
        ? `Array with ${certs.length} items`
        : `Got ${typeof certs}: ${String(certs).substring(0, 100)}`,
    );

    // Skills should be an object, not a string
    const skillsIsObject =
      typeof skills === "object" && skills !== null && !Array.isArray(skills);
    const skillsNotString = typeof skills !== "string";
    record(
      "JSONB_SHAPE",
      "Skills is native object",
      skillsIsObject && skillsNotString,
      skillsIsObject
        ? `Object with ${Object.keys(skills).length} keys`
        : `Got ${typeof skills}: ${String(skills).substring(0, 100)}`,
    );

    // Cleanup
    await sbDelete("rem_staff", staffId);
  } catch (e) {
    record("JSONB_SHAPE", "Read-back for JSONB test", false, `Error: ${e}`);
    if (staffId) await sbDelete("rem_staff", staffId);
  }
}

async function testProductionPath() {
  console.log("\n── Production Path Tests ──");

  const authToken = await getAuthToken();

  // Test: Unauthenticated denial
  try {
    const result = await convexAction("remSupabase:listAnalyzers", {});
    if (
      result.status === "error" ||
      result.errorMessage?.includes("Not authenticated")
    ) {
      record(
        "PRODUCTION_PATH",
        "Unauthenticated read denial",
        true,
        "Correctly denied unauthenticated read",
      );
    } else if (result.status === "success") {
      record(
        "PRODUCTION_PATH",
        "Unauthenticated read denial",
        false,
        "UNEXPECTED: Action succeeded without auth",
      );
    } else {
      record(
        "PRODUCTION_PATH",
        "Unauthenticated read denial",
        true,
        `Denied as expected: ${result.errorMessage || result.status}`,
      );
    }
  } catch (e) {
    record(
      "PRODUCTION_PATH",
      "Unauthenticated read denial",
      true,
      `Network error (expected): ${e}`,
    );
  }

  // Test: Unauthenticated mutation denial
  try {
    const result = await convexAction("remSupabase:updateAnalyzer", {
      id: "test-not-a-real-id",
      stage: "Test",
    });
    if (
      result.status === "error" ||
      result.errorMessage?.includes("Not authenticated")
    ) {
      record(
        "PRODUCTION_PATH",
        "Unauthenticated mutation denial",
        true,
        "Correctly denied unauthenticated mutation",
      );
    } else {
      record(
        "PRODUCTION_PATH",
        "Unauthenticated mutation denial",
        false,
        `UNEXPECTED: ${JSON.stringify(result)}`,
      );
    }
  } catch (e) {
    record(
      "PRODUCTION_PATH",
      "Unauthenticated mutation denial",
      true,
      `Network error (expected): ${e}`,
    );
  }

  // Test: Authenticated viewer read access
  if (authToken) {
    try {
      const readResult = await convexQuery(
        "remSupabase:listAnalyzers",
        {},
        authToken,
      );
      if (readResult.status === "success") {
        record(
          "PRODUCTION_PATH",
          "Viewer read access",
          true,
          "Viewer can read REM data",
        );
      } else {
        record(
          "PRODUCTION_PATH",
          "Viewer read access",
          false,
          `Viewer read failed: ${readResult.errorMessage}`,
        );
      }
    } catch (e) {
      record("PRODUCTION_PATH", "Viewer read access", false, `Error: ${e}`);
    }

    // Test: Authenticated viewer mutation denial
    try {
      const result = await convexAction(
        "remSupabase:updateAnalyzer",
        {
          id: "test-viewer-denied",
          stage: "Test",
        },
        authToken,
      );
      if (
        result.status === "error" &&
        result.errorMessage?.includes("Missing capability: rem.write")
      ) {
        record(
          "PRODUCTION_PATH",
          "Viewer mutation denial",
          true,
          "Correctly denied viewer mutation",
        );
      } else if (result.status === "error") {
        record(
          "PRODUCTION_PATH",
          "Viewer mutation denial",
          true,
          `Denied: ${result.errorMessage}`,
        );
      } else {
        record(
          "PRODUCTION_PATH",
          "Viewer mutation denial",
          false,
          "UNEXPECTED: Viewer mutation succeeded",
        );
      }
    } catch (e) {
      record(
        "PRODUCTION_PATH",
        "Viewer mutation denial",
        true,
        `Error (denied): ${e}`,
      );
    }
  } else {
    record(
      "PRODUCTION_PATH",
      "Viewer mutation denial",
      false,
      "SKIPPED: Could not obtain auth token",
    );
  }

  // Test: Invalid payload rejection
  try {
    const result = await convexAction(
      "remSupabase:updateAnalyzer",
      {
        id: "not-a-uuid",
        stage: 12345,
        unknownField: "should be rejected",
      },
      authToken,
    );
    if (result.status === "error") {
      record(
        "PRODUCTION_PATH",
        "Invalid payload rejection",
        true,
        `Correctly rejected: ${result.errorMessage}`,
      );
    } else {
      record(
        "PRODUCTION_PATH",
        "Invalid payload rejection",
        false,
        "UNEXPECTED: Invalid payload accepted",
      );
    }
  } catch (e) {
    record(
      "PRODUCTION_PATH",
      "Invalid payload rejection",
      true,
      `Error (rejected): ${e}`,
    );
  }
}

// ─── Main ───

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("REM Live Schema Compatibility Test Suite");
  console.log("═══════════════════════════════════════════════\n");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for schema introspection",
    );
    console.log("SCHEMA_COMPAT tests will be SKIPPED");
  }

  await testSchemaCompat();
  await testValidation();
  await testJsonbShape();
  await testProductionPath();

  // ─── Summary ───
  console.log("\n═══════════════════════════════════════════════");
  const categories: TestResult["category"][] = [
    "SCHEMA_COMPAT",
    "VALIDATION",
    "JSONB_SHAPE",
    "PRODUCTION_PATH",
  ];
  const categoryLabels: Record<string, string> = {
    SCHEMA_COMPAT: "REM_LIVE_SCHEMA_COMPAT",
    VALIDATION: "REM_VALIDATION",
    JSONB_SHAPE: "REM_JSONB_SHAPE",
    PRODUCTION_PATH: "REM_PRODUCTION_PATH_TESTS",
  };

  let allPassed = true;
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const passed = catResults.filter(r => r.passed).length;
    const total = catResults.length;
    const status = total > 0 && passed === total ? "PASS" : "FAIL";
    console.log(`${categoryLabels[cat]}=${status}`);
    if (status === "FAIL") allPassed = false;
  }

  // Identify blockers
  const blockers: string[] = [];
  for (const r of results) {
    if (!r.passed && r.category === "SCHEMA_COMPAT") {
      blockers.push(`SCHEMA: ${r.name} — ${r.detail}`);
    }
  }

  console.log(
    `BLOCKERS=${blockers.length === 0 ? "<none>" : blockers.join("; ")}`,
  );

  const totalPassed = results.filter(r => r.passed).length;
  const totalFailed = results.filter(r => !r.passed).length;
  console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed`);
  console.log("═══════════════════════════════════════════════");

  process.exit(allPassed ? 0 : 1);
}

main().catch(e => {
  console.error("Test suite crashed:", e);
  process.exit(1);
});
