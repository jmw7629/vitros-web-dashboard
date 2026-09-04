const TARGET_SHA = "7ea61fdd398dc49c5e315411676768c7f9c4c24e";
const path = "database/migrations/20260903_dhr_atomic_scan_transition.sql";
const url = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}/${path}`;
const response = await fetch(url, { cache: "no-store" });
if (!response.ok) throw new Error(`target fetch failed: ${response.status}`);
const sql = await response.text();

function requireAll(tokens) {
  for (const token of tokens) if (!sql.includes(token)) throw new Error(`missing invariant: ${token}`);
}
function forbidAll(tokens) {
  for (const token of tokens) if (sql.toLowerCase().includes(token.toLowerCase())) throw new Error(`forbidden invariant: ${token}`);
}

requireAll([
  "add column if not exists revision integer not null default 0",
  "create table if not exists public.dhr_scan_result_events",
  "correlation_id text not null unique",
  "on delete restrict",
  "DHR scan event history is immutable",
  "before update or delete on public.dhr_scan_result_events",
  "create or replace function public.apply_dhr_scan_transition",
  "security definer",
  "set search_path = public, pg_temp",
  "upper(btrim(p_part_number))",
  "pg_advisory_xact_lock",
  "dhr-correlation|",
  "dhr-field|",
  "correlationId already used for a different DHR event",
  "DHR revision conflict",
  "v_delta := p_new_qty - v_previous_qty",
  "if v_delta > 0 then",
  "v_mode := 'OUT'",
  "elsif v_delta < 0 then",
  "v_mode := 'IN'",
  "public.apply_inventory_transition",
  "if lower(p_category) <> 'tool' then",
  "Ambiguous canonical stock part",
  "Ambiguous canonical DHR result",
  "revoke all on function public.apply_dhr_scan_transition",
  "grant execute on function public.apply_dhr_scan_transition",
  "to service_role",
]);

forbidAll([
  "to anon;",
  "to authenticated;",
  "delete from public.audit_log",
  "truncate public.stock",
  "post to sap",
]);

console.log(`VERIFY=PASS SHA=${TARGET_SHA} DHR_E2E=NOT_YET_WIRED`);
