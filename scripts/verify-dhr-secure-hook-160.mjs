const TARGET_SHA = "bb08ece646129120c8199cc1a1b9d593d1436595";
const ROOT = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}`;
async function get(path) { const r = await fetch(`${ROOT}/${path}`, {cache:"no-store"}); if(!r.ok) throw new Error(`${path}:${r.status}`); return r.text(); }
const [hook, apiTypes] = await Promise.all([get("src/hooks/useServerActions.ts"), get("convex/_generated/api.d.ts")]);
for (const token of [
  'useAction(api.dhrInventoryActions.applyScanTransition)',
  'useAction(api.aiGateway.ocrDhrPage)',
  'applyDhrScanTransition',
  'expectedRevision: number',
  'revisionAfter: number',
  'stockBefore?: number | null',
  'sapId?: string | null',
  'case "stock": throw new Error("Direct stock quantity updates are not permitted; use inventory transition actions")',
]) if (!hook.includes(token)) throw new Error(`hook missing invariant: ${token}`);
for (const token of ['import type * as dhrInventoryActions', 'dhrInventoryActions: typeof dhrInventoryActions', 'import type * as incomingStockActions', 'incomingStockActions: typeof incomingStockActions']) if (!apiTypes.includes(token)) throw new Error(`api typing missing: ${token}`);
for (const token of ['VITE_OPENAI_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'fetch("https://api.openai.com']) if (hook.includes(token)) throw new Error(`client hook contains forbidden secret/direct AI pattern: ${token}`);
console.log(`VERIFY=PASS SHA=${TARGET_SHA} DHR_SECURE_HOOK=PASS`);
