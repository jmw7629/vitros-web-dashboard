const BASE = "https://oykqiiydpwngasvzdthh.supabase.co/functions/v1/browser-safe-read-retired-staging";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(dataset, options = {}) {
  const url = new URL(BASE);
  if (dataset !== undefined) url.searchParams.set("dataset", dataset);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetch(url, { cache: "no-store", redirect: "manual", ...options });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}

// The retired staging boundary mirrors the target production posture. A browser
// request without server-authoritative identity must never receive operational
// data. Depending on Edge gateway enforcement it may be rejected before the
// tombstone handler (401/403) or by the handler itself (410).
for (const dataset of ["stock", "audit", "sap", "settings", "rem_summary"]) {
  const response = await request(dataset, { method: "GET", headers: { Accept: "application/json" } });
  assert([401, 403, 410].includes(response.status), `${dataset} expected fail-closed HTTP 401/403/410, received ${response.status}`);
  const text = await response.text();
  assert(!/part_number|qty_on_hand|user_name|plant_code|storage_location|analyzer_type/i.test(text), `${dataset} rejection leaked operational fields`);
  console.log(`${dataset}: PASS status=${response.status}`);
}

const post = await request("stock", {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: "{}",
});
assert([401, 403, 410].includes(post.status), `POST expected fail-closed HTTP 401/403/410, received ${post.status}`);

console.log("browser-safe-read retired staging runtime smoke: PASS");
