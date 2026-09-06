import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readActions = read("convex/remReadActions.ts");
const hook = read("src/hooks/useRemPlanningData.ts");
const productionPlan = read("src/pages/rem/ProductionPlan.tsx");
const staffTraining = read("src/pages/rem/StaffTraining.tsx");

const fail = (message) => {
  console.error(`REM_PLANNING_READ_SECURITY=FAIL ${message}`);
  process.exit(1);
};

if (!readActions.includes("export const listPlanning = action")) fail("listPlanning action missing");
const planningSlice = readActions.slice(readActions.indexOf("export const listPlanning = action"));
if (!planningSlice.includes('await requireCapability(ctx, "rem.read")')) fail("listPlanning is not rem.read protected");
for (const table of ["rem_tracker_weekly", "rem_build_plan", "rem_staff", "rem_targets"]) {
  if (!planningSlice.includes(`"${table}"`)) fail(`${table} authoritative read missing`);
}
if (!readActions.includes("SUPABASE_SERVICE_ROLE_KEY")) fail("server-side Supabase boundary missing");
if (!planningSlice.includes("return { trackerWeekly, buildPlan, staff, targets }")) fail("bounded planning response missing");

if (!hook.includes("api.remReadActions.listPlanning")) fail("planning hook is not using server action");
if (hook.includes("SUPABASE_SERVICE_ROLE_KEY") || hook.includes("SUPABASE_URL")) fail("planning hook contains server credential reference");

for (const [name, source] of [["ProductionPlan", productionPlan], ["StaffTraining", staffTraining]]) {
  if (!source.includes("useRemPlanningData")) fail(`${name} does not use authoritative planning hook`);
  if (source.includes("useConvexData")) fail(`${name} still depends on legacy Convex data hook`);
  if (/useMutation|useServerActions|sbUpdate|sbInsert|sbDelete|applyInventory|postSap/i.test(source)) {
    fail(`${name} contains a mutation/posting path`);
  }
}

if (!productionPlan.includes("Recent VITROS Weekly Plan")) fail("production plan parity view missing");
if (!staffTraining.includes("Sourced from the recurring REM production workbook")) fail("staff source-of-truth disclosure missing");

console.log("REM_PLANNING_READ_SECURITY=PASS");
