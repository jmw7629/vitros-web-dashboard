-- Reject internally inconsistent REM planning week/date combinations before they
-- can be persisted by workbook imports or any future server-authoritative writer.
-- ISO week validation is intentionally source-agnostic: week 1 may begin in the
-- prior calendar year, while PostgreSQL's ISOYEAR/WEEK pair remains authoritative.

create or replace function public.enforce_rem_iso_week_start()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_week_start date;
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

  if extract(isoyear from v_week_start)::integer <> new.plan_year
     or extract(week from v_week_start)::integer <> v_week_number::integer then
    raise exception 'rem_week_start_iso_mismatch: plan_year %, week %, date %',
      new.plan_year, v_week_number::integer, new.week_start;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_rem_iso_week_start() from public, anon, authenticated;
grant execute on function public.enforce_rem_iso_week_start() to service_role;

drop trigger if exists rem_tracker_weekly_iso_week_guard on public.rem_tracker_weekly;
create trigger rem_tracker_weekly_iso_week_guard
before insert or update of plan_year, week_number, week_start
on public.rem_tracker_weekly
for each row execute function public.enforce_rem_iso_week_start();

drop trigger if exists rem_build_plan_iso_week_guard on public.rem_build_plan;
create trigger rem_build_plan_iso_week_guard
before insert or update of plan_year, week_number, week_start
on public.rem_build_plan
for each row execute function public.enforce_rem_iso_week_start();

drop trigger if exists rem_weekly_notes_iso_week_guard on public.rem_weekly_notes;
create trigger rem_weekly_notes_iso_week_guard
before insert or update of plan_year, week_number, week_start
on public.rem_weekly_notes
for each row execute function public.enforce_rem_iso_week_start();
