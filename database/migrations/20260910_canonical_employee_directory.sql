-- VITROS #386: Canonical employee directory with versioning, initials uniqueness,
-- and immutable employee-admin event model.
--
-- Additive and data-preserving. Fails closed if duplicate canonical initials
-- exist in the production convex_employees table.
--
-- Changes:
--  1. Adds version & updated_at columns for optimistic concurrency.
--  2. Adds a partial unique index on UPPER(BTRIM(initials)) where active=true,
--     with a pre-migration assertion that no duplicates exist.
--  3. Creates public.admin_employee_events as an immutable audit trail.
--  4. Adds a trigger to prevent UPDATE/DELETE on the events table.
--  5. Populates existing rows with version=1 and updated_at=created_at.
--

begin;

-- Step 0: Assertion — fail closed if duplicate canonical initials exist
-- among active employees. This prevents silently merging/inventing employees.
do $$
declare
  v_dup_count integer;
begin
  select count(*) into v_dup_count
  from (
    select upper(btrim(initials)) as init,
           count(*) as cnt
    from public.convex_employees
    where active = true
    group by upper(btrim(initials))
    having count(*) > 1
  ) sub;

  if v_dup_count > 0 then
    raise exception 'FAIL: Duplicate active employee initials found: %, cannot proceed with canonical migration. Resolve duplicates before applying this migration.',
      v_dup_count using errcode = 'P0001';
  end if;

  raise notice 'PASS: No duplicate active employee initials';
end $$;

-- Step 1: Add version and updated_at columns (nullable first, then populated)
alter table public.convex_employees
    add column if not exists version integer not null default 1;

alter table public.convex_employees
    add column if not exists updated_at timestamptz;

-- Step 2: Populate updated_at from created_at for existing rows
update public.convex_employees
    set updated_at = created_at
where updated_at is null;

-- Step 3: Partial unique index on canonical initials (active employees only)
create unique index if not exists
    public.convex_employees_canonical_initials_uq
on public.convex_employees (upper(btrim(initials)))
where active = true;

-- Step 4: Create immutable audit event table for employee-admin actions
create table if not exists public.admin_employee_events (
    event_id bigint generated always as identity primary key,
    correlation_id text not null unique,
    employee_id text not null,
    action text not null check (action in ('CREATE', 'UPDATE', 'ACTIVATE', 'DEACTIVATE')),
    previous_name text,
    previous_initials text,
    new_name text not null,
    new_initials text not null,
    new_version integer not null check (new_version >= 1),
    new_updated_at timestamptz not null,
    actor text not null,
    reason text,
    created_at timestamptz not null default now()
);

ALTER TABLE public.admin_employee_events ENABLE ROW LEVEL SECURITY;

-- Step 5: Make the events table immutable (reject all UPDATE/DELETE)
create or replace function public.reject_employee_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'employee event history is immutable' using errno = '55000';
end;
$$;

drop trigger if exists admin_employee_events_immutable on public.admin_employee_events;
create trigger admin_employee_events_immutable
before update or delete on public.admin_employee_events
for each row execute function public.reject_employee_event_mutation();

-- Step 6: Create the insert function for employee events (service-role-only EXECUTE)
create or replace function public.insert_employee_event(
    p_correlation_id text,
    p_employee_id text,
    p_action text,
    p_previous_name text,
    p_previous_initials text,
    p_new_name text,
    p_new_initials text,
    p_new_version integer,
    p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into public.admin_employee_events (
    correlation_id,
    employee_id,
    action,
    previous_name,
    previous_initials,
    new_name,
    new_initials,
    new_version,
    new_updated_at,
    actor,
    reason
  ) values (
    p_correlation_id,
    p_employee_id,
    p_action,
    p_previous_name,
    p_previous_initials,
    p_new_name,
    p_new_initials,
    p_new_version,
    now(),
    current_user,
    p_reason
  );
end;
$$;

-- Grant EXECUTE only to service_role (never to browser/anon/authenticated)
revoke all on function public.insert_employee_event(text, text, text, text, text, text, text, integer) from PUBLIC, anon, authenticated;
grant execute on function public.insert_employee_event(text, text, text, text, text, text, text, integer) to service_role;

commit;

-- ─── Post-migration regression checks ────────────────────────────────

-- Verify the unique index is functional
select count(*) as total_active_employees
from public.convex_employees
where active = true;

-- Verify no duplicates under the canonical index
select upper(btrim(initials)) as init, count(*) as cnt
from public.convex_employees
where active = true
group by upper(btrim(initials))
having count(*) > 1;

-- Verify the events table structure
select count(*) as event_table_rows
from public.admin_employee_events limit 1;

-- Verify existing rows have version=1 and updated_at set
select id, version, updated_at, created_at
from public.convex_employees
limit 5;