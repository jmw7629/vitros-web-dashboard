const BASE = "https://oykqiiydpwngasvzdthh.supabase.co/functions/v1/browser-safe-read";

const ALLOWED_FIELDS = {
  stock: new Set([
    "id", "part_number", "description", "type", "qty_on_hand", "min_qty", "max_qty",
    "on_plan", "bin_location", "module", "unit_cost", "last_activity", "status", "updated_at",
  ]),
  audit: new Set(["id", "action", "part_number", "user_name", "created_at", "new_value"]),
  sap: new Set([
    "id", "tx_id", "created_at", "mode", "part_number", "description", "qty", "qty_before",
    "qty_after", "movement_type", "plant_code", "storage_location", "status", "exported",
  ]),
  settings: new Set(["key", "value"]),
};

const FORBIDDEN_KEYS = new Set([
  "pin_hash", "ip_address", "service_role", "service_role_key", "anon_key", "openai_key",
  "authorization", "password", "jwt", "secret",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSafeObject(value, dataset, path = dataset) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${path} must be an object`);
  for (const [key, child] of Object.entries(value)) {
    assert(!FORBIDDEN_KEYS.has(key.toLowerCase()), `${path} exposes forbidden key ${key}`);
    if (key.toLowerCase().includes("secret") || key.toLowerCase().includes("token")) {
      throw new Error(`${path} exposes secret/token-like key ${key}`);
    }
    if (child && typeof child === "object" && !Array.isArray(child)) {
      assertSafeObject(child, dataset, `${path}.${key}`);
    }
  }
}

async function request(dataset, options = {}) {
  const url = new URL(BASE);
  if (dataset !== undefined) url.searchParams.set("dataset", dataset);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetch(url, { cache: "no-store", ...options });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}

for (const dataset of ["stock", "audit", "sap", "settings"]) {
  const response = await request(dataset, { method: "GET", headers: { Accept: "application/json" } });
  assert(response.status === 200, `${dataset} expected HTTP 200, received ${response.status}`);
  assert((response.headers.get("cache-control") || "").includes("no-store"), `${dataset} missing no-store cache control`);
  const rows = await response.json();
  assert(Array.isArray(rows), `${dataset} response must be an array`);
  if (dataset === "stock") assert(rows.length > 0, "stock response must be non-empty");
  if (dataset === "audit") assert(rows.length <= 500, "audit response exceeds 500-row cap");
  if (dataset === "settings") assert(rows.length <= 6, "settings response exceeds six-key allowlist");

  for (const row of rows) {
    assertSafeObject(row, dataset);
    for (const key of Object.keys(row)) {
      assert(ALLOWED_FIELDS[dataset].has(key), `${dataset} exposes unexpected top-level field ${key}`);
    }
    if (dataset === "audit" && row.new_value && typeof row.new_value === "object") {
      const allowedAuditValue = new Set(["description", "qty", "qty_before", "qty_after", "sap_status"]);
      for (const key of Object.keys(row.new_value)) {
        assert(allowedAuditValue.has(key), `audit.new_value exposes unexpected field ${key}`);
      }
    }
  }
  console.log(`${dataset}: PASS rows=${rows.length}`);
}

const invalid = await request("users", { method: "GET", headers: { Accept: "application/json" } });
assert(invalid.status === 400, `invalid dataset expected HTTP 400, received ${invalid.status}`);

const post = await request("stock", {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: "{}",
});
assert(post.status === 405, `POST expected HTTP 405, received ${post.status}`);

console.log("browser-safe-read production runtime smoke: PASS");
