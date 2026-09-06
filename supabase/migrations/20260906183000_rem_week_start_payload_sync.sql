-- Keep the JSON payload stored beside REM Tracker / Build Plan rows consistent
-- with the server-authoritative week_start normalized by the ISO week guard.
-- This prevents the known copied-prior-year workbook date from surviving inside
-- data->weekStart after the top-level column has been safely repaired.
--
-- No existing REM rows are rewritten by this migration. The behavior applies to
-- future authoritative inserts/updates only and every unrelated date mismatch
-- continues to fail closed.

create or replace function public.enforce_rem_iso_week_start()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_week_start date;
  v_shifted_week_start date;
  v_week_number numeric;
begin
  if new.plan_year is null
     or new.week_number is null
     or new.week_start is null
     or btrim(new.week_start) = '' then
    return new;
  end if;

  if new.plan_year < 2020 or new.plan_year > 2100 then
    raise exception 'invalid_rem_plan_year';
  end if;

  v_week_number := new.week_number::numeric;
  if v_week_number <> trunc(v_week_number)
     or v_week_number < 1
     or v_week_number > 53 then
    raise exception 'invalid_rem_week_number';
  end if;

  begin
    v_week_start := new.week_start::date;
  exception when others then
    raise exception 'invalid_rem_week_start';
  end;

  if extract(isoyear from v_week_start)::integer = new.plan_year
     and extract(week from v_week_start)::integer = v_week_number::integer then
    null;
  else
    v_shifted_week_start := (v_week_start + interval '1 year')::date;
    if extract(isoyear from v_week_start)::integer = new.plan_year - 1
       and extract(isoyear from v_shifted_week_start)::integer = new.plan_year
       and extract(week from v_shifted_week_start)::integer = v_week_number::integer then
      new.week_start := v_shifted_week_start::text;
    else
      raise exception 'rem_week_start_iso_mismatch: plan_year %, week %, date %',
        new.plan_year, v_week_number::integer, new.week_start;
    end if;
  end if;

  if tg_table_name in ('rem_tracker_weekly', 'rem_build_plan') then
    new.data := jsonb_set(
      coalesce(new.data, '{}'::jsonb),
      '{weekStart}',
      to_jsonb(new.week_start),
      true
    );
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_rem_iso_week_start() from public, anon, authenticated;
grant execute on function public.enforce_rem_iso_week_start() to service_role;
