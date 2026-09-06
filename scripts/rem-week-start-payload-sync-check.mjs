import fs from "node:fs";

const sql = fs.readFileSync(
  new URL("../supabase/migrations/20260906183000_rem_week_start_payload_sync.sql", import.meta.url),
  "utf8",
);

const must = (pattern, message) => {
  if (!pattern.test(sql)) throw new Error(message);
};
const forbid = (pattern, message) => {
  if (pattern.test(sql)) throw new Error(message);
};

must(/create or replace function public\.enforce_rem_iso_week_start\(\)/i, "REM week guard replacement missing");
must(/set search_path = public, pg_temp/i, "REM week guard must pin search_path");
must(/v_shifted_week_start := \(v_week_start \+ interval '1 year'\)::date/i, "Narrow one-year stale-date repair missing");
must(/tg_table_name in \('rem_tracker_weekly', 'rem_build_plan'\)/i, "Payload sync must be limited to Tracker and Build Plan");
must(/new\.data := jsonb_set\([\s\S]*?'\{weekStart\}'[\s\S]*?to_jsonb\(new\.week_start\)/i, "Normalized week_start must replace nested data.weekStart");
must(/raise exception 'rem_week_start_iso_mismatch/i, "Unrelated week-date mismatch must still fail closed");
must(/revoke all on function public\.enforce_rem_iso_week_start\(\) from public, anon, authenticated/i, "Browser roles must not execute trigger helper");
must(/grant execute on function public\.enforce_rem_iso_week_start\(\) to service_role/i, "Service role execution must remain available");

forbid(/\b(?:delete\s+from|truncate|drop\s+table|update\s+public\.rem_|insert\s+into\s+public\.rem_)\b/i, "Migration must not rewrite existing REM business rows");
forbid(/tg_table_name\s+in\s*\([^)]*rem_weekly_notes/i, "Notes table has no data payload and must not enter JSON sync branch");

console.log("REM_WEEK_START_PAYLOAD_SYNC=PASS");
console.log("REM_WEEK_START_ARBITRARY_MISMATCH=FAIL_CLOSED");
console.log("REM_WEEK_START_NO_EXISTING_DATA_REWRITE=PASS");
