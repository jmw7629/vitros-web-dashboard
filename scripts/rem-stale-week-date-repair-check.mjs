import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260906180000_rem_stale_prior_year_week_start_repair.sql", import.meta.url),
  "utf8",
);

const requireMatch = (pattern, message) => {
  if (!pattern.test(migration)) throw new Error(message);
};

requireMatch(/create or replace function public\.enforce_rem_iso_week_start\(\)/i, "REM week guard replacement missing");
requireMatch(/set search_path = public, pg_temp/i, "REM week guard must pin search_path");
requireMatch(/v_shifted_week_start := \(v_week_start \+ interval '1 year'\)::date/i, "Repair must be exactly one calendar year");
requireMatch(/extract\(isoyear from v_week_start\)::integer = new\.plan_year - 1/i, "Repair must require source ISO year exactly one year behind");
requireMatch(/extract\(isoyear from v_shifted_week_start\)::integer = new\.plan_year/i, "Shifted date must resolve to authoritative plan year");
requireMatch(/extract\(week from v_shifted_week_start\)::integer = v_week_number::integer/i, "Shifted date must resolve to authoritative ISO week");
requireMatch(/new\.week_start := v_shifted_week_start::text/i, "Validated stale date must be normalized server-side");
requireMatch(/raise exception 'rem_week_start_iso_mismatch/i, "All non-matching date inconsistencies must still fail closed");
requireMatch(/revoke all on function public\.enforce_rem_iso_week_start\(\) from public, anon, authenticated/i, "Browser roles must not execute the trigger helper");
requireMatch(/grant execute on function public\.enforce_rem_iso_week_start\(\) to service_role/i, "Service role must retain trigger execution capability");

if (/\b(delete from|truncate|drop table|update public\.rem_|insert into public\.rem_)\b/i.test(migration)) {
  throw new Error("Stale-date repair migration must not rewrite existing REM business data");
}
if (/interval\s+'(?:[2-9]|\d{2,})\s+year/i.test(migration)) {
  throw new Error("Week-date repair may not guess multi-year shifts");
}

console.log("REM_STALE_DATE_ONE_YEAR_REPAIR=PASS");
console.log("REM_STALE_DATE_ARBITRARY_MISMATCH=FAIL_CLOSED");
console.log("REM_STALE_DATE_BROWSER_EXECUTE=CLOSED");
console.log("REM_STALE_DATE_NO_EXISTING_DATA_REWRITE=PASS");
