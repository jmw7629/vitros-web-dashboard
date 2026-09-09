import fs from "node:fs";

const provider = fs.readFileSync("src/hooks/useConvexData.tsx", "utf8");
const planningHook = fs.readFileSync("src/hooks/useRemPlanningData.ts", "utf8");

function requireInvariant(ok, message) {
  if (!ok) throw new Error(message);
}

requireInvariant(provider.includes("api.remReadActions.listCore"), "shared provider must use authoritative REM core action");
requireInvariant(provider.includes("api.remReadActions.listPlanning"), "shared provider must use authoritative REM planning action");
requireInvariant(planningHook.includes("api.remReadActions.listPlanning"), "REM planning hook must use authoritative planning action");
requireInvariant(!provider.includes("const CONVEX_URL"), "shared provider must not retain a generic legacy REM Convex URL");

for (const legacyPath of [
  "remAnalyzers:list",
  "remLvcc:list",
  "remTargets:list",
  "remStaffing:getTrainingMatrix",
  "remWeeklyNotes:list",
  "remBuildPlan:list",
  "remTracker:listWeekly",
]) {
  requireInvariant(!provider.includes(legacyPath), `legacy REM browser query remains: ${legacyPath}`);
}

requireInvariant(
  provider.includes('const CYCLE_CONVEX_URL = "https://accurate-newt-938.convex.cloud"'),
  "cycle-count compatibility path changed outside this REM slice",
);
requireInvariant(
  provider.includes("const [coreResult, planningResult] = await Promise.all(["),
  "shared refresh must load authoritative REM core and planning data together",
);

console.log("REM_SHARED_PROVIDER_AUTHORITATIVE=PASS");
console.log("LEGACY_REM_BROWSER_QUERY_RETIRED=PASS");
console.log("REM_SERVER_RBAC_BOUNDARY=ACTION_ONLY");
console.log("CYCLE_COUNT_SCOPE_PRESERVED=PASS");
