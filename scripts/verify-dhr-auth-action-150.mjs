const TARGET_SHA = "01cbf9f7f49a6d78b5d37c499c7225749378c640";
const ROOT = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}`;

async function get(path) {
  const response = await fetch(`${ROOT}/${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`target fetch failed ${path}: ${response.status}`);
  return response.text();
}

const source = await get("convex/dhrInventoryActions.ts");
const required = [
  'requireCapability(ctx, "inventory.write")',
  'process.env.SUPABASE_SERVICE_ROLE_KEY',
  '/rest/v1/rpc/apply_dhr_scan_transition',
  'p_actor: String(actorId)',
  'p_expected_revision: args.expectedRevision',
  'Number.isInteger(args.expectedQty)',
  'Number.isInteger(args.newQty)',
  'Number.isInteger(args.expectedRevision)',
];
for (const token of required) if (!source.includes(token)) throw new Error(`missing invariant: ${token}`);

for (const token of [
  'callerRole',
  'callerUser',
  'p_actor: args.',
  'VITE_SUPABASE_SERVICE_ROLE_KEY',
  'from("stock").update',
  'from("audit_log").insert',
  'from("sap_staging").insert',
]) {
  if (source.includes(token)) throw new Error(`forbidden invariant: ${token}`);
}

console.log(`VERIFY=PASS SHA=${TARGET_SHA} DHR_SERVER_AUTHORITY=PASS`);
