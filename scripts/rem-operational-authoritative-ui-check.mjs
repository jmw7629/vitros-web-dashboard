import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const fail = (message) => {
  console.error(`REM_OPERATIONAL_AUTHORITATIVE_UI=FAIL ${message}`);
  process.exit(1);
};
const requireText = (text, pattern, label) => {
  if (!pattern.test(text)) fail(`missing ${label}`);
};
const rejectText = (text, pattern, label) => {
  if (pattern.test(text)) fail(`forbidden ${label}`);
};

const action = read("convex/remOperationalActions.ts");
const migration = read("supabase/migrations/20260907033000_rem_operational_analyzer_updates.sql");
const kiosk = read("src/pages/rem/EngineerKiosk.tsx");
const report = read("src/pages/rem/Reports.tsx");
const morning = read("src/pages/rem/MorningSnapshot.tsx");
const kanban = read("src/pages/rem/KanbanBoard.tsx");
const pages = [
  "src/pages/rem/EngineerKiosk.tsx",
  "src/pages/rem/KanbanBoard.tsx",
  "src/pages/rem/GanttTimeline.tsx",
  "src/pages/rem/FieldStatus.tsx",
  "src/pages/rem/MorningSnapshot.tsx",
  "src/pages/rem/Reports.tsx",
  "src/pages/rem/RemDashboard.tsx",
];

for (const path of pages) {
  const source = read(path);
  requireText(source, /useRemCoreData/, `${path} authoritative REM hook`);
  rejectText(source, /useConvexData/, `${path} legacy Convex aggregate`);
}

requireText(action, /requireCapability\(ctx,\s*"rem\.read"\)/, "server rem.read guard");
requireText(action, /requireCapability\(ctx,\s*"rem\.write"\)/, "server rem.write guard");
requireText(action, /SUPABASE_SERVICE_ROLE_KEY/, "server-only service role configuration");
requireText(action, /apply_rem_analyzer_operational_update/, "authoritative REM RPC call");
requireText(action, /p_actor:\s*String\(userId\)/, "server-derived actor");
rejectText(action, /VITE_.*SERVICE|args\.(?:actor|role|userName)/, "browser/caller supplied authority");

requireText(migration, /security definer/i, "SECURITY DEFINER RPC");
requireText(migration, /set search_path = pg_catalog, public/i, "locked search_path");
requireText(migration, /auth\.role\(\) is distinct from 'service_role'/, "service-role runtime gate");
requireText(migration, /pg_advisory_xact_lock/, "idempotency serialization");
requireText(migration, /for update/i, "row-level concurrency lock");
requireText(migration, /REM analyzer revision conflict/, "optimistic concurrency conflict");
requireText(migration, /REM idempotency conflict/, "idempotency payload conflict");
requireText(migration, /insert into public\.audit_log/, "immutable audit append");
requireText(migration, /revoke all on function[\s\S]*from authenticated/i, "authenticated execute revoke");
requireText(migration, /grant execute on function[\s\S]*to service_role/i, "service-role-only execute grant");
rejectText(migration, /delete\s+from\s+public\.(?:rem_analyzers|audit_log)/i, "destructive REM/audit delete");
rejectText(migration, /sap_staging|inventory_operations|\bstock\b/i, "unrelated SAP/inventory mutation");

requireText(kiosk, /api\.remOperationalActions\.getAnalyzerOperational/, "Engineer Kiosk authoritative detail read");
requireText(kiosk, /api\.remOperationalActions\.updateAnalyzerOperational/, "Engineer Kiosk authoritative update");
requireText(kiosk, /crypto\.randomUUID\(\)/, "per-attempt idempotency key");
requireText(kiosk, /onClick=\{\(\) => void save\(\)\}/, "working Engineer Kiosk save button");
requireText(kiosk, /expectedStage/, "Engineer Kiosk optimistic stage precondition");
requireText(kiosk, /expectedNotes/, "Engineer Kiosk optimistic notes precondition");
rejectText(kiosk, /Service\/Repair/, "non-authoritative Service/Repair stage alias");

requireText(report, /onClick=\{exportReport\}/, "working REM export button");
requireText(report, /XLSX\.utils\.book_append_sheet/, "REM workbook export");
requireText(report, /data\.analyzers/, "authoritative analyzer export");
requireText(report, /data\.lvccItems/, "authoritative LVCC export");

rejectText(morning, /targetDate/, "fabricated completion-date metric");
requireText(morning, /slaDays/, "authoritative SLA metric");
requireText(kanban, /"Service"/, "authoritative Service stage");
rejectText(kanban, /Service\/Repair/, "non-authoritative Kanban stage alias");

console.log("REM_OPERATIONAL_AUTHORITATIVE_UI=PASS");
