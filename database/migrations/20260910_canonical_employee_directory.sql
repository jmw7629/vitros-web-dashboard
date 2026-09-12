-- VITROS #386: Canonical employee directory with versioning, initials uniqueness,
-- and immutable employee-admin event model. Additive, data-preserving.

begin;

-- Precheck: fail closed if incompatible preexisting audit table exists
do $$
begin
  if exists (select 1 from pg_class where relname='admin_employee_events' and relkind='r' and relnamespace='public'::regnamespace) then
    -- Expected shape for this migration: event_id bigint, correlation_id text unique, employee_id uuid or text, action check, previous_values jsonb, new_values jsonb, request_values jsonb, previous_version integer, new_version integer, actor text, reason text, created_at timestamptz
    -- If table exists but is missing required columns or has legacy columns, fail closed rather than drop history
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='admin_employee_events' and column_name='correlation_id')
       or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='admin_employee_events' and column_name='request_values')
       or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='admin_employee_events' and column_name='previous_values')
       or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='admin_employee_events' and column_name='new_values') then
      raise exception 'incompatible preexisting admin_employee_events table; manual reconciliation required' using errcode='55000';
    end if;
  end if;
end $$;

-- Step 0: Duplicate canonical initials among active employees — fail closed
do $$
declare
  v_dup_count integer;
begin
  select count(*) into v_dup_count
  from (
    select upper(btrim(initials)) as init, count(*) as cnt
    from public.convex_employees
    where active IS TRUE
      and btrim(coalesce(initials,'')) <> ''
    group by upper(btrim(initials))
    having count(*) > 1
  ) sub;
  if v_dup_count > 0 then
    raise exception 'FAIL: Duplicate active employee initials found: %, cannot proceed with canonical migration. Resolve duplicates before applying.',
      v_dup_count using errcode = 'P0001';
  end if;
  raise notice 'PASS: No duplicate active employee initials';
end $$;

-- Step 0b: Fail closed on invalid active data rather than silently canonicalizing
do $$
declare
  v_invalid_initials integer;
  v_invalid_name integer;
begin
  select count(*) into v_invalid_initials
  from public.convex_employees
  where active IS TRUE
    and (
      btrim(coalesce(initials,'')) = ''
      or upper(btrim(initials)) !~ '^[A-Z0-9]{1,4}$'
    );
  if v_invalid_initials > 0 then
    raise exception 'FAIL: % active employees have invalid initials (must be 1-4 ASCII alphanumeric)', v_invalid_initials using errcode='22023';
  end if;

  select count(*) into v_invalid_name
  from public.convex_employees
  where active IS TRUE
    and (
      btrim(coalesce(name,'')) = ''
      or char_length(btrim(name)) < 1
      or char_length(btrim(name)) > 100
      or btrim(name) ~ '[[:cntrl:]]'
    );
  if v_invalid_name > 0 then
    raise exception 'FAIL: % active employees have invalid names (1-100 printable, no controls)', v_invalid_name using errcode='22023';
  end if;
  raise notice 'PASS: No invalid active employee data';
end $$;

-- Step 1: Add version and updated_at columns
alter table public.convex_employees
  add column if not exists version integer not null default 1;
alter table public.convex_employees
  add column if not exists updated_at timestamptz;

-- Backfill version where null (should be none for new table) and preserve existing timestamps
update public.convex_employees set version = 1 where version is null;
-- updated_at stays null where created_at is null; otherwise copy created_at
update public.convex_employees set updated_at = created_at where updated_at is null and created_at is not null;

-- Step 2: Partial unique index on canonical initials (active only) — unqualified name
create unique index if not exists convex_employees_canonical_initials_uq
  on public.convex_employees ((upper(btrim(initials))))
  where (active IS TRUE);

-- Step 3: Immutable audit event table
create table if not exists public.admin_employee_events (
  event_id bigint generated always as identity primary key,
  correlation_id text not null unique,
  employee_id uuid not null,
  action text not null check (action in ('CREATE','UPDATE','ACTIVATE','DEACTIVATE')),
  previous_values jsonb not null,
  new_values jsonb not null,
  request_values jsonb not null,
  previous_version integer not null check (previous_version >= 0),
  new_version integer not null check (new_version >= 1 and new_version = previous_version + 1),
  actor text not null,
  reason text,
  created_at timestamptz not null default now()
);

-- RLS enabled, no browser policies
alter table public.convex_employees enable row level security;
alter table public.admin_employee_events enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='convex_employees' loop
    execute format('drop policy if exists %I on public.convex_employees', r.policyname);
  end loop;
  for r in select policyname from pg_policies where schemaname='public' and tablename='admin_employee_events' loop
    execute format('drop policy if exists %I on public.admin_employee_events', r.policyname);
  end loop;
end $$;

-- Revoke direct DML/TRUNCATE from browser roles and service_role (writes via SECURITY DEFINER only)
revoke all on table public.convex_employees from public, anon, authenticated, service_role;
revoke all on table public.admin_employee_events from public, anon, authenticated, service_role;

-- Grant service_role only SELECT
grant select on table public.convex_employees to service_role;
grant select on table public.admin_employee_events to service_role;

revoke truncate on table public.convex_employees from public, anon, authenticated, service_role;
revoke truncate on table public.admin_employee_events from public, anon, authenticated, service_role;

-- Step 4: Immutability triggers
create or replace function public.reject_employee_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'employee event history is immutable' using errcode = '55000';
end;
$$;
revoke all on function public.reject_employee_event_mutation() from public, anon, authenticated;

drop trigger if exists admin_employee_events_immutable on public.admin_employee_events;
create trigger admin_employee_events_immutable
  before update or delete on public.admin_employee_events
  for each row execute function public.reject_employee_event_mutation();

drop trigger if exists admin_employee_events_immutable_truncate on public.admin_employee_events;
create trigger admin_employee_events_immutable_truncate
  before truncate on public.admin_employee_events
  for each statement execute function public.reject_employee_event_mutation();

create or replace function public.reject_employee_directory_truncate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'employee directory truncate is not permitted' using errcode = '55000';
end;
$$;
revoke all on function public.reject_employee_directory_truncate() from public, anon, authenticated;
drop trigger if exists convex_employees_immutable_truncate on public.convex_employees;
create trigger convex_employees_immutable_truncate
  before truncate on public.convex_employees
  for each statement execute function public.reject_employee_directory_truncate();

-- Step 5: Disable legacy insert_employee_event API
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
  raise exception 'legacy insert_employee_event is disabled; use public.apply_employee_transition' using errcode = '42501';
end;
$$;
revoke all on function public.insert_employee_event(text, text, text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;

-- Step 6: Atomic RPC
create or replace function public.apply_employee_transition(
  p_action text,
  p_employee_id text,
  p_name text,
  p_initials text,
  p_active boolean,
  p_expected_version integer,
  p_correlation_id text,
  p_actor text,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_emp_id text := nullif(btrim(coalesce(p_employee_id, '')), '');
  v_emp_uuid uuid;
  v_raw_name text := p_name;
  v_raw_initials text := p_initials;
  v_norm_name text := null;
  v_norm_initials text := null;
  v_active boolean := p_active;
  v_expected integer := p_expected_version;
  v_correlation text := btrim(coalesce(p_correlation_id, ''));
  v_actor text := btrim(coalesce(p_actor, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_target_name text;
  v_target_initials text;
  v_target_active boolean;
  v_existing public.convex_employees%rowtype;
  v_event public.admin_employee_events%rowtype;
  v_prev jsonb;
  v_new jsonb;
  v_request jsonb;
  v_result jsonb;
  v_prev_version integer;
begin
  if v_action not in ('CREATE','UPDATE','ACTIVATE','DEACTIVATE') then
    raise exception 'invalid action %: expected CREATE/UPDATE/ACTIVATE/DEACTIVATE', p_action using errcode = '22023';
  end if;
  if v_correlation = '' or char_length(v_correlation) > 200 then
    raise exception 'invalid correlation id' using errcode = '22023';
  end if;
  if v_actor = '' or char_length(v_actor) > 200 then
    raise exception 'invalid actor' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'reason is too long' using errcode = '22023';
  end if;

  if v_raw_name is not null then
    v_norm_name := btrim(v_raw_name);
    if char_length(v_norm_name) < 1 or char_length(v_norm_name) > 100 then
      raise exception 'name must be 1-100 characters' using errcode = '22023';
    end if;
    if v_norm_name ~ '[[:cntrl:]]' then
      raise exception 'name contains invalid characters' using errcode = '22023';
    end if;
  end if;

  if v_raw_initials is not null then
    v_norm_initials := upper(btrim(v_raw_initials));
    if v_norm_initials !~ '^[A-Z0-9]{1,4}$' then
      raise exception 'initials must be 1-4 ASCII alphanumeric' using errcode = '22023';
    end if;
  end if;

  if v_action = 'CREATE' then
    if v_emp_id is not null then
      raise exception 'CREATE must have null employee_id' using errcode = '22023';
    end if;
    if v_expected is not null then
      raise exception 'CREATE must have null expected_version' using errcode = '22023';
    end if;
    if v_norm_name is null then
      raise exception 'name is required for CREATE' using errcode = '22023';
    end if;
    if v_norm_initials is null then
      raise exception 'initials are required for CREATE' using errcode = '22023';
    end if;
    v_target_name := v_norm_name;
    v_target_initials := v_norm_initials;
    v_target_active := coalesce(v_active, true);
  else
    if v_emp_id is null then
      raise exception 'employee_id is required for %', v_action using errcode = '22023';
    end if;
    if v_expected is null or v_expected < 1 then
      raise exception 'expected_version is required and must be >=1 for %', v_action using errcode = '22023';
    end if;
    begin
      v_emp_uuid := v_emp_id::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid employee_id: must be uuid' using errcode = '22023';
    end;
    v_target_name := v_norm_name;
    v_target_initials := v_norm_initials;
    v_target_active := v_active;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('employee-correlation:' || v_correlation, 0));
  if v_action = 'CREATE' then
    perform pg_advisory_xact_lock(hashtextextended('employee-create:' || coalesce(v_target_initials,''), 0));
  else
    perform pg_advisory_xact_lock(hashtextextended('employee:' || v_emp_id, 0));
  end if;

  v_request := jsonb_build_object(
    'action', v_action,
    'employee_id', v_emp_id,
    'name', v_norm_name,
    'initials', v_norm_initials,
    'active', v_active,
    'expected_version', v_expected,
    'actor', v_actor,
    'reason', v_reason
  );

  select * into v_event from public.admin_employee_events where correlation_id = v_correlation;
  if found then
    if v_event.request_values is distinct from v_request then
      raise exception 'correlation id was already used for a different request' using errcode = 'P0001';
    end if;
    if v_event.actor is distinct from v_actor then
      raise exception 'correlation id was already used with a different actor' using errcode = 'P0001';
    end if;
    return v_event.new_values || jsonb_build_object('duplicate', true);
  end if;

  if v_action = 'CREATE' then
    if v_target_active IS TRUE then
      if exists (select 1 from public.convex_employees where active IS TRUE and upper(btrim(initials)) = v_target_initials) then
        raise exception 'duplicate active canonical initials: %', v_target_initials using errcode = '23505';
      end if;
    end if;

    insert into public.convex_employees (name, initials, active, version, created_at, updated_at)
    values (v_target_name, v_target_initials, v_target_active, 1, now(), now())
    returning * into v_existing;

    v_prev := jsonb_build_object('version', 0);
    v_prev_version := 0;
    v_new := jsonb_build_object(
      'id', v_existing.id::text,
      'name', v_existing.name,
      'initials', v_existing.initials,
      'active', v_existing.active,
      'version', v_existing.version,
      'created_at', v_existing.created_at,
      'updated_at', v_existing.updated_at
    );
    v_result := v_new;

    insert into public.admin_employee_events (
      correlation_id, employee_id, action, previous_values, new_values, request_values,
      previous_version, new_version, actor, reason
    ) values (
      v_correlation, v_existing.id, v_action, v_prev, v_new, v_request,
      0, v_existing.version, v_actor, v_reason
    );
    return v_result;
  else
    select * into v_existing from public.convex_employees where id = v_emp_uuid for update;
    if not found then
      raise exception 'employee not found: %', v_emp_id using errcode = 'P0002';
    end if;

    if v_existing.version <> v_expected then
      raise exception 'version conflict: expected %, current %', v_expected, v_existing.version using errcode = '40001';
    end if;

    v_prev := jsonb_build_object(
      'id', v_existing.id::text,
      'name', v_existing.name,
      'initials', v_existing.initials,
      'active', v_existing.active,
      'version', v_existing.version,
      'created_at', v_existing.created_at,
      'updated_at', v_existing.updated_at
    );
    v_prev_version := v_existing.version;

    if v_norm_name is not null then
      v_target_name := v_norm_name;
    else
      v_target_name := v_existing.name;
    end if;
    if v_norm_initials is not null then
      v_target_initials := v_norm_initials;
    else
      v_target_initials := v_existing.initials;
    end if;
    if v_action = 'ACTIVATE' then
      v_target_active := true;
    elsif v_action = 'DEACTIVATE' then
      v_target_active := false;
    else
      if v_active is not null then
        v_target_active := v_active;
      else
        v_target_active := v_existing.active;
      end if;
    end if;

    if v_target_name <> v_existing.name then
      if char_length(btrim(v_target_name)) <1 or char_length(btrim(v_target_name)) >100 then
        raise exception 'name must be 1-100 characters' using errcode='22023';
      end if;
      if v_target_name ~ '[[:cntrl:]]' then
        raise exception 'name contains invalid characters' using errcode='22023';
      end if;
    end if;

    if v_target_active IS TRUE then
      -- Legacy inactive rows remain untouched, but cannot activate invalid identity data.
      if upper(btrim(v_target_initials)) !~ '^[A-Z0-9]{1,4}$'
         or char_length(btrim(v_target_name)) not between 1 and 100
         or v_target_name ~ '[[:cntrl:]]' then
        raise exception 'active employee identity is invalid; correct name and initials first' using errcode = '22023';
      end if;
      if v_target_active is distinct from v_existing.active or upper(btrim(v_target_initials)) is distinct from upper(btrim(v_existing.initials)) then
        if exists (select 1 from public.convex_employees where active IS TRUE and upper(btrim(initials)) = upper(btrim(v_target_initials)) and id <> v_emp_uuid) then
          raise exception 'duplicate active canonical initials: %', v_target_initials using errcode='23505';
        end if;
      end if;
    end if;

    update public.convex_employees
      set name = v_target_name,
          initials = v_target_initials,
          active = v_target_active,
          version = v_existing.version + 1,
          updated_at = now()
      where id = v_emp_uuid
      returning * into v_existing;

    v_new := jsonb_build_object(
      'id', v_existing.id::text,
      'name', v_existing.name,
      'initials', v_existing.initials,
      'active', v_existing.active,
      'version', v_existing.version,
      'created_at', v_existing.created_at,
      'updated_at', v_existing.updated_at
    );
    v_result := v_new;

    insert into public.admin_employee_events (
      correlation_id, employee_id, action, previous_values, new_values, request_values,
      previous_version, new_version, actor, reason
    ) values (
      v_correlation, v_existing.id, v_action, v_prev, v_new, v_request,
      v_prev_version, v_existing.version, v_actor, v_reason
    );
    return v_result;
  end if;
end;
$$;

revoke all on function public.apply_employee_transition(text, text, text, text, boolean, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_employee_transition(text, text, text, text, boolean, integer, text, text, text) to service_role;

commit;

select count(*) as total_active_employees from public.convex_employees where active IS TRUE;
select upper(btrim(initials)) as init, count(*) as cnt from public.convex_employees where active IS TRUE group by upper(btrim(initials)) having count(*) > 1;
select count(*) as event_table_rows from public.admin_employee_events;
select id, version, updated_at, created_at from public.convex_employees limit 5;
