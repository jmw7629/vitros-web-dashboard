-- Repair the one deterministic date defect present in the authoritative 2026 REM
-- workbook: weeks 2-53 retain the prior-year calendar date while the workbook's
-- internal summary sheet and week number identify the 2026 planning week.
--
-- This remains fail-closed for every other mismatch. The trigger only shifts an
-- incoming date by exactly one calendar year when that shifted date resolves to
-- the supplied ISO plan_year/week_number. No existing REM business rows are
-- rewritten by this migration.

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
    return new;
  end if;

  -- The controlled workbook defect is a stale copy-forward date exactly one
  -- calendar year behind. Repair only that narrow case; do not guess dates for
  -- any other inconsistent input.
  v_shifted_week_start := (v_week_start + interval '1 year')::date;
  if extract(isoyear from v_week_start)::integer = new.plan_year - 1
     and extract(isoyear from v_shifted_week_start)::integer = new.plan_year
     and extract(week from v_shifted_week_start)::integer = v_week_number::integer then
    new.week_start := v_shifted_week_start::text;
    return new;
  end if;

  raise exception 'rem_week_start_iso_mismatch: plan_year %, week %, date %',
    new.plan_year, v_week_number::integer, new.week_start;
end;
$$;

revoke all on function public.enforce_rem_iso_week_start() from public, anon, authenticated;
grant execute on function public.enforce_rem_iso_week_start() to service_role;
