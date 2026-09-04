const TARGET_SHA = "f9ce4420a1035b03ea521cc8575382be0fd840e5";
const base = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}`;

async function source(path) {
  const res = await fetch(`${base}/${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed ${path}: ${res.status}`);
  return res.text();
}

const [client, page, edge, security] = await Promise.all([
  source("src/lib/browserSafeRead.ts"),
  source("src/pages/rem/RemDashboard.tsx"),
  source("supabase/functions/browser-safe-read/index.ts"),
  source("scripts/browser-safe-read-security-check.mjs"),
]);

function requireAll(label, text, tokens) {
  for (const token of tokens) if (!text.includes(token)) throw new Error(`${label} missing ${token}`);
}
function forbidAll(label, text, tokens) {
  for (const token of tokens) if (text.includes(token)) throw new Error(`${label} forbidden ${token}`);
}

requireAll("client", client, ['"rem_summary"', "/functions/v1/browser-safe-read", 'method: "GET"', 'cache: "no-store"']);
forbidAll("client", client, ["service_role", "SUPABASE_SERVICE_ROLE", "Authorization", "/rest/v1/rem_analyzers", "/rest/v1/rem_lvcc"]);

requireAll("edge", edge, [
  'new Set(["stock", "audit", "sap", "settings", "rem_summary"])',
  'postgrest("rem_analyzers?select=analyzer_type,current_stage,is_complete")',
  'postgrest("rem_lvcc?select=is_complete")',
  'case "rem_summary"',
  'if (request.method !== "GET")',
  '"Cache-Control": "no-store, max-age=0"',
]);
forbidAll("edge", edge, ["serial_number", "production_order", "assigned_to", "notes", "select=*", 'method: "POST"', 'method: "PATCH"', 'method: "DELETE"']);

requireAll("page", page, [
  'browserSafeRead<RemSummary>("rem_summary")',
  'window.setInterval(load, 15000)',
  '"Live Supabase"',
  'summary?.total',
  'summary?.lvcc_total',
]);
requireAll("security", security, ['"rem_summary"', 'case "rem_summary"', '"serial_number"', '"production_order"']);

console.log(`VERIFY=PASS SHA=${TARGET_SHA} REM_AUTHORITATIVE_SUMMARY=YES ROW_LEVEL_EXPOSURE=NO WRITE_SURFACE=NO BOUNDED_REFRESH=YES`);
