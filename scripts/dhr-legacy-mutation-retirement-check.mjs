import fs from "node:fs";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

const gateway = read("convex/supabaseGateway.ts");
const dhrActions = read("convex/dhrInventoryActions.ts");
const serverActions = read("src/hooks/useServerActions.ts");
const scanner = read("src/pages/inventory/DhrScanner.tsx");

requireMatch(
  gateway,
  /method\s*!==\s*["']GET["'][\s\S]{0,180}\^dhr_scan_\(\?:sessions\|results\)/,
  "supabaseGateway must fail closed for non-GET dhr_scan_sessions/results mutations",
);
requireMatch(
  gateway,
  /Legacy direct DHR mutation is retired; use the authoritative DHR workflow/,
  "legacy DHR gateway mutation guard is missing",
);

for (const name of [
  "insertDhrSession",
  "updateDhrSession",
  "deleteDhrSession",
  "deleteDhrSessionWithResults",
  "upsertDhrScanResult",
  "deleteDhrScanResult",
]) {
  requireMatch(gateway, new RegExp(`export const ${name} = action\\(`), `legacy action ${name} unexpectedly disappeared; retire it explicitly before API removal`);
}

requireMatch(
  dhrActions,
  /rpc\/apply_dhr_scan_transition/,
  "authoritative atomic DHR scan RPC is not wired",
);
requireMatch(
  dhrActions,
  /requireCapability\(ctx,\s*["']inventory\.write["']\)[\s\S]*callAtomicDhrRpc/,
  "DHR scan transition must remain capability-gated and RPC-backed",
);
requireMatch(
  serverActions,
  /useAction\(api\.dhrInventoryActions\.applyScanTransition\)/,
  "browser adapter is not wired to authoritative DHR transition action",
);
requireMatch(
  scanner,
  /applyDhrChecklistChange\(\{[\s\S]{0,700}expectedRevision:/,
  "DHR scanner is not using revision-checked authoritative checklist changes",
);

if (/fetch\s*\(\s*`\$\{url\}\/rest\/v1\/dhr_scan_(?:sessions|results)/.test(gateway)) {
  throw new Error("supabaseGateway contains a direct DHR base-table fetch outside the shared fail-closed gateway");
}

console.log("DHR legacy mutation retirement boundary: PASS");
