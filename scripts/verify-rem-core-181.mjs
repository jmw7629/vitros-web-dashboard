const TARGET_SHA = "4e25b3ebb78692ac1eed7cad3a060270c4b4bb89";
const ROOT = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}`;

async function get(path) {
  const response = await fetch(`${ROOT}/${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`target fetch failed ${path}: ${response.status}`);
  return await response.text();
}

const [server, hook, analyzers, lvcc, notes, generated] = await Promise.all([
  get("convex/remReadActions.ts"),
  get("src/hooks/useRemCoreData.ts"),
  get("src/pages/rem/Analyzers.tsx"),
  get("src/pages/rem/LvccTracker.tsx"),
  get("src/pages/rem/WeeklyNotes.tsx"),
  get("convex/_generated/api.d.ts"),
]);

function requireAll(source, label, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`${label} missing invariant: ${token}`);
  }
}
function forbidAll(source, label, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) throw new Error(`${label} contains forbidden invariant: ${token}`);
  }
}

requireAll(server, "server REM read", [
  'requireCapability(ctx, "rem.read")',
  'process.env.SUPABASE_SERVICE_ROLE_KEY',
  'export const listCore = action({',
  '"rem_analyzers"',
  '"rem_lvcc"',
  '"rem_weekly_notes"',
  'select=id,serial_number,analyzer_type,production_order,start_date,sla_days,current_stage,days_in_stage,overall_pct,procurement_pct,cleaning_pct,service_pct,final_line_pct,release_testing_pct,qa_release_pct,sap_release_pct,packaging_pct,current_pct,is_complete',
  'select=id,serial_number,item_type,batch_number,start_date,end_date,current_stage,build_pct,test_pct,qa_release_pct,sap_release_pct,packaging_pct,is_complete',
  'select=id,week_start,week_number,quarter,notes',
  '&limit=500',
  '&limit=104',
  'rawNotes.slice(0, 50)',
  '.slice(0, 8000)',
  '.slice(0, 120)',
]);
forbidAll(server, "server REM read", [
  'callerRole',
  'callerUser',
  'VITE_SUPABASE',
  'remAnalyzers').collect(',
]);

requireAll(hook, "REM hook", [
  'useAction(api.remReadActions.listCore)',
  'const inFlight = useRef<Promise<void> | null>(null)',
  'if (inFlight.current) return inFlight.current',
  'if (!document.hidden) void refresh()',
  'document.addEventListener("visibilitychange"',
  'document.removeEventListener("visibilitychange"',
  '10_000',
]);
forbidAll(hook, "REM hook", [
  'accurate-newt-938',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE',
  'safeConvexQuery',
]);

for (const [label, source] of [["analyzers", analyzers], ["lvcc", lvcc], ["notes", notes]]) {
  requireAll(source, label, [
    'useRemCoreData',
    'data.error',
    'data.refresh()',
    'authoritative REM',
  ]);
  forbidAll(source, label, [
    'useConvexData',
    'accurate-newt-938',
    'SUPABASE_SERVICE_ROLE_KEY',
    'fetch(',
  ]);
}

requireAll(generated, "generated API", [
  'import type * as remReadActions from "../remReadActions.js";',
  'remReadActions: typeof remReadActions;',
]);

console.log(`VERIFY=PASS SHA=${TARGET_SHA}`);
