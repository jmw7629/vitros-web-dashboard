import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260906020000_rem_week_start_iso_integrity.sql", import.meta.url),
  "utf8",
);

const requireMatch = (pattern, message) => {
  if (!pattern.test(migration)) throw new Error(message);
};

requireMatch(/create or replace function public\.enforce_rem_iso_week_start\(\)/i, "Missing REM ISO week guard function");
requireMatch(/set search_path = public, pg_temp/i, "REM ISO week guard must pin search_path");
requireMatch(/extract\(isoyear from v_week_start\)::integer <> new\.plan_year/i, "Guard must validate ISO year against plan year");
requireMatch(/extract\(week from v_week_start\)::integer <> v_week_number::integer/i, "Guard must validate ISO week against week number");
requireMatch(/v_week_number <> trunc\(v_week_number\)/i, "Guard must reject fractional week numbers");
requireMatch(/revoke all on function public\.enforce_rem_iso_week_start\(\) from public, anon, authenticated/i, "Browser roles must not execute the trigger function directly");
requireMatch(/grant execute on function public\.enforce_rem_iso_week_start\(\) to service_role/i, "Service role must retain controlled execution capability");

for (const table of ["rem_tracker_weekly", "rem_build_plan", "rem_weekly_notes"]) {
  requireMatch(new RegExp(`before insert or update of plan_year, week_number, week_start[\\s\\S]*on public\\.${table}[\\s\\S]*enforce_rem_iso_week_start`, "i"), `Missing ISO week trigger for ${table}`);
}

if (/\b(delete from|truncate|drop table|update public\.rem_|insert into public\.rem_)\b/i.test(migration)) {
  throw new Error("Integrity migration must not rewrite or delete REM business data");
}

console.log("REM_WEEK_START_ISO_YEAR_WEEK_GUARD=PASS");
console.log("REM_WEEK_START_BROWSER_BYPASS=CLOSED");
console.log("REM_WEEK_START_NO_BUSINESS_DATA_REWRITE=PASS");
