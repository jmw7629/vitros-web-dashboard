-- Part Master Administration: version concurrency and immutable audit trail
-- Additive migration; does not change existing part data.

begin;

-- 1) Add version column to stock table for optimistic concurrency
alter table public.stock
  add column if not exists version integer not null default 1;

-- Backfill version for existing rows (all start at 1)
update public.stock set version = 1 where version is null;

-- 2) Immutable audit trail for part master metadata changes
create table if not exists public.part_master_events (
  event_id bigint generated always as identity primary key,
  correlation_id text not null unique,
  part_id uuid not null references public.stock(id) on delete restrict,
  part_number text not null,
  actor text not null,
  reason text,
  previous_values jsonb not null,
  new_values jsonb not null,
  previous_version integer not null check (previous_version >= 1),
  new_version integer not null check (new_version = previous_version + 1),
  created_at timestamptz not null default now()
);

alter table public.part_master_events enable row level security;
revoke all on table public.part_master_events from public, anon, authenticated;
revoke all on sequence public.part_master_events_event_id_seq from public, anon, authenticated;

-- Immutable trigger
create or replace function public.reject_part_master_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'part master history is immutable' using errcode = '55000';
end;
$$;

drop trigger if exists part_master_events_immutable on public.part_master_events;
create trigger part_master_events_immutable
before update or delete on public.part_master_events
for each row execute function public.reject_part_master_event_mutation();

revoke all on function public.reject_part_master_event_mutation() from public, anon, authenticated;

-- 3) Authoritative RPC for part master metadata updates with version check and audit
create or replace function public.apply_part_master_change(
  p_part_id uuid,
  p_updates jsonb,
  p_expected_version integer,
  p_actor text,
  p_correlation_id text,
  p_reason text default null
)
returns table (
  event_id bigint,
  part_id uuid,
  part_number text,
  version integer,
  updated_at timestamptz,
  duplicate boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_part_id uuid := p_part_id;
  v_updates jsonb := coalesce(p_updates, '{}'::jsonb);
  v_actor text := btrim(coalesce(p_actor, ''));
  v_correlation text := btrim(coalesce(p_correlation_id, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_allowed_keys text[] := array['description','type','min_qty','max_qty','on_plan','bin_location','module','unit_cost'];
  v_safe_updates jsonb := '{}'::jsonb;
  v_key text;
  v_current record;
  v_previous_values jsonb;
  v_new_values jsonb;
  v_event public.part_master_events%rowtype;
  v_version integer;
  v_updated_at timestamptz;
  v_part_number text;
begin
  -- Validate actor
  if v_actor = '' or char_length(v_actor) > 200 then
    raise exception 'invalid actor' using errcode = '22023';
  end if;
  -- Validate correlation id
  if v_correlation = '' or char_length(v_correlation) > 200 then
    raise exception 'invalid correlation id' using errcode = '22023';
  end if;
  -- Validate reason
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'reason is too long' using errcode = '22023';
  end if;
  -- Validate expected version
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'expected version must be a positive integer' using errcode = '22023';
  end if;

  -- Filter updates to allowed keys only; reject unknown/protected keys
  foreach v_key in select * from jsonb_object_keys(v_updates) loop
    if v_key = any(v_allowed_keys) then
      v_safe_updates := jsonb_set(v_safe_updates, array[v_key], v_updates->v_key);
    else
      raise exception 'field % is not editable via part master administration' using errcode = '22023';
    end if;
  end loop;

  if jsonb_typeof(v_safe_updates) = 'object' and jsonb_object_keys(v_safe_updates) is null then
    raise exception 'no permitted part master fields supplied' using errcode = '22023';
  end if;

  -- Validate specific field constraints
  if v_safe_updates ? 'type' then
    if (v_safe_updates->>'type') not in ('Required','Optional','Not on BOM','Consumable') then
      raise exception 'invalid part type' using errcode = '22023';
    end if;
  end if;
  if v_safe_updates ? 'min_qty' then
    if (v_safe_updates->>'min_qty')::numeric < 0 then
      raise exception 'min_qty cannot be negative' using errcode = '22023';
    end if;
  end if;
  if v_safe_updates ? 'max_qty' then
    if (v_safe_updates->>'max_qty')::numeric < 0 then
      raise exception 'max_qty cannot be negative' using errcode = '22023';
    end if;
  end if;
  if v_safe_updates ? 'unit_cost' then
    if (v_safe_updates->>'unit_cost')::numeric < 0 then
      raise exception 'unit_cost cannot be negative' using errcode = '22023';
    end if;
  end if;
  if v_safe_updates ? 'on_plan' then
    if jsonb_typeof(v_safe_updates->'on_plan') <> 'boolean' then
      raise exception 'on_plan must be boolean' using errcode = '22023';
    end if;
  end if;

  -- Serialize concurrent edits of the same part and exact retries
  perform pg_advisory_xact_lock(hashtextextended('part-master:' || v_part_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('part-master-correlation:' || v_correlation, 0));

  -- Idempotency: check if correlation_id already processed
  select e.* into v_event
  from public.part_master_events e
  where e.correlation_id = v_correlation;

  if found then
    if v_event.part_id <> v_part_id or v_event.new_values <> v_safe_updates then
      raise exception 'correlation id was already used for a different change' using errcode = '23505';
    end if;

    select s.version, s.updated_at, s.part_number
      into v_version, v_updated_at, v_part_number
    from public.stock s
    where s.id = v_part_id;

    return query select
      v_event.event_id,
      v_event.part_id,
      v_event.part_number,
      v_event.new_version,
      coalesce(v_updated_at, v_event.created_at),
      true;
    return;
  end if;

  -- Lock the part row and fetch current state
  select s.id, s.part_number, s.description, s.type, s.qty_on_hand,
         s.min_qty, s.max_qty, s.on_plan, s.bin_location, s.module,
         s.unit_cost, s.version, s.updated_at
    into v_current
  from public.stock s
  where s.id = v_part_id
  for update;

  if not found then
    raise exception 'part not found' using errcode = 'P0002';
  end if;

  v_part_number := v_current.part_number;
  v_version := v_current.version;

  if v_version <> p_expected_version then
    raise exception 'part version conflict: expected %, current %', p_expected_version, v_version
      using errcode = '40001';
  end if;

  -- Build previous_values snapshot (only allowed fields)
  v_previous_values := jsonb_build_object(
    'description', v_current.description,
    'type', v_current.type,
    'min_qty', v_current.min_qty,
    'max_qty', v_current.max_qty,
    'on_plan', v_current.on_plan,
    'bin_location', v_current.bin_location,
    'module', v_current.module,
    'unit_cost', v_current.unit_cost
  );

  -- Apply updates
  update public.stock s
  set
    description = coalesce(v_safe_updates->>'description', v_current.description),
    type = coalesce(v_safe_updates->>'type', v_current.type),
    min_qty = coalesce((v_safe_updates->>'min_qty')::numeric, v_current.min_qty),
    max_qty = coalesce((v_safe_updates->>'max_qty')::numeric, v_current.max_qty),
    on_plan = coalesce((v_safe_updates->>'on_plan')::boolean, v_current.on_plan),
    bin_location = coalesce(v_safe_updates->>'bin_location', v_current.bin_location),
    module = coalesce(v_safe_updates->>'module', v_current.module),
    unit_cost = coalesce((v_safe_updates->>'unit_cost')::numeric, v_current.unit_cost),
    version = v_current.version + 1,
    updated_at = now()
  where s.id = v_part_id
  returning s.updated_at into v_updated_at;

  -- Build new_values snapshot
  v_new_values := jsonb_build_object(
    'description', coalesce(v_safe_updates->>'description', v_current.description),
    'type', coalesce(v_safe_updates->>'type', v_current.type),
    'min_qty', coalesce((v_safe_updates->>'min_qty')::numeric, v_current.min_qty),
    'max_qty', coalesce((v_safe_updates->>'max_qty')::numeric, v_current.max_qty),
    'on_plan', coalesce((v_safe_updates->>'on_plan')::boolean, v_current.on_plan),
    'bin_location', coalesce(v_safe_updates->>'bin_location', v_current.bin_location),
    'module', coalesce(v_safe_updates->>'module', v_current.module),
    'unit_cost', coalesce((v_safe_updates->>'unit_cost')::numeric, v_current.unit_cost)
  );

  -- Insert immutable audit event
  insert into public.part_master_events (
    correlation_id,
    part_id,
    part_number,
    actor,
    reason,
    previous_values,
    new_values,
    previous_version,
    new_version
  ) values (
    v_correlation,
    v_part_id,
    v_part_number,
    v_actor,
    v_reason,
    v_previous_values,
    v_new_values,
    v_version,
    v_version + 1
  ) returning * into v_event;

  return query select
    v_event.event_id,
    v_event.part_id,
    v_event.part_number,
    v_event.new_version,
    v_updated_at,
    false;
end;
$$;

revoke all on function public.apply_part_master_change(uuid, jsonb, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_part_master_change(uuid, jsonb, integer, text, text, text)
  to service_role;

-- 4) RPC for creating a new part (also creates audit event)
create or replace function public.create_part_master(
  p_part_number text,
  p_description text,
  p_type text default 'Required',
  p_qty_on_hand integer default 0,
  p_min_qty integer default 0,
  p_max_qty integer default 0,
  p_on_plan boolean default false,
  p_bin_location text default '',
  p_module text default '',
  p_unit_cost numeric default 0,
  p_actor text,
  p_correlation_id text,
  p_reason text default null
)
returns table (
  part_id uuid,
  part_number text,
  version integer,
  created_at timestamptz,
  event_id bigint
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_part_number text := upper(btrim(p_part_number));
  v_description text := btrim(p_description);
  v_type text := btrim(coalesce(p_type, 'Required'));
  v_qty integer := coalesce(p_qty_on_hand, 0);
  v_min_qty integer := coalesce(p_min_qty, 0);
  v_max_qty integer := coalesce(p_max_qty, 0);
  v_on_plan boolean := coalesce(p_on_plan, false);
  v_bin_location text := coalesce(p_bin_location, '');
  v_module text := coalesce(p_module, '');
  v_unit_cost numeric := coalesce(p_unit_cost, 0);
  v_actor text := btrim(coalesce(p_actor, ''));
  v_correlation text := btrim(coalesce(p_correlation_id, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_new_id uuid;
  v_created_at timestamptz;
  v_event_id bigint;
begin
  -- Validations
  if v_part_number = '' or char_length(v_part_number) > 64 then
    raise exception 'part number must be 1-64 characters' using errcode = '22023';
  end if;
  if v_description = '' or char_length(v_description) > 255 then
    raise exception 'description must be 1-255 characters' using errcode = '22023';
  end if;
  if v_type not in ('Required','Optional','Not on BOM','Consumable') then
    raise exception 'invalid part type' using errcode = '22023';
  end if;
  if v_qty < 0 or v_min_qty < 0 or v_max_qty < 0 then
    raise exception 'quantities cannot be negative' using errcode = '22023';
  end if;
  if v_unit_cost < 0 then
    raise exception 'unit_cost cannot be negative' using errcode = '22023';
  end if;
  if v_actor = '' or char_length(v_actor) > 200 then
    raise exception 'invalid actor' using errcode = '22023';
  end if;
  if v_correlation = '' or char_length(v_correlation) > 200 then
    raise exception 'invalid correlation id' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'reason is too long' using errcode = '22023';
  end if;

  -- Serialize on part number (for uniqueness) and correlation
  perform pg_advisory_xact_lock(hashtextextended('part-master-create:' || v_part_number, 0));
  perform pg_advisory_xact_lock(hashtextextended('part-master-correlation:' || v_correlation, 0));

  -- Check for existing part with same canonical number
  if exists (select 1 from public.stock where upper(btrim(part_number)) = v_part_number) then
    raise exception 'part number already exists' using errcode = '23505';
  end if;

  -- Insert new part
  insert into public.stock (
    part_number, description, type, qty_on_hand,
    min_qty, max_qty, on_plan, bin_location, module, unit_cost,
    version, last_activity, updated_at
  ) values (
    v_part_number, v_description, v_type, v_qty,
    v_min_qty, v_max_qty, v_on_plan, v_bin_location, v_module, v_unit_cost,
    1, now(), now()
  ) returning id, created_at into v_new_id, v_created_at;

  -- Insert audit event for creation
  insert into public.part_master_events (
    correlation_id,
    part_id,
    part_number,
    actor,
    reason,
    previous_values,
    new_values,
    previous_version,
    new_version
  ) values (
    v_correlation,
    v_new_id,
    v_part_number,
    v_actor,
    v_reason,
    '{}'::jsonb,
    jsonb_build_object(
      'part_number', v_part_number,
      'description', v_description,
      'type', v_type,
      'qty_on_hand', v_qty,
      'min_qty', v_min_qty,
      'max_qty', v_max_qty,
      'on_plan', v_on_plan,
      'bin_location', v_bin_location,
      'module', v_module,
      'unit_cost', v_unit_cost
    ),
    0,
    1
  ) returning event_id into v_event_id;

  return query select v_new_id, v_part_number, 1, v_created_at, v_event_id;
end;
$$;

revoke all on function public.create_part_master(text, text, text, integer, integer, integer, boolean, text, text, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_part_master(text, text, text, integer, integer, integer, boolean, text, text, numeric, text, text, text)
  to service_role;

-- 5) RPC for deleting a part (admin only, with audit)
create or replace function public.delete_part_master(
  p_part_id uuid,
  p_actor text,
  p_correlation_id text,
  p_reason text default null
)
returns table (
  event_id bigint,
  part_number text,
  deleted boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_part_id uuid := p_part_id;
  v_actor text := btrim(coalesce(p_actor, ''));
  v_correlation text := btrim(coalesce(p_correlation_id, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_part record;
  v_event_id bigint;
  v_part_number text;
begin
  -- Validations
  if v_actor = '' or char_length(v_actor) > 200 then
    raise exception 'invalid actor' using errcode = '22023';
  end if;
  if v_correlation = '' or char_length(v_correlation) > 200 then
    raise exception 'invalid correlation id' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'reason is too long' using errcode = '22023';
  end if;

  -- Serialize
  perform pg_advisory_xact_lock(hashtextextended('part-master:' || v_part_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('part-master-correlation:' || v_correlation, 0));

  -- Idempotency check
  select e.event_id into v_event_id
  from public.part_master_events e
  where e.correlation_id = v_correlation and e.part_id = v_part_id;

  if found then
    select s.part_number into v_part_number from public.stock s where s.id = v_part_id;
    if not found then
      v_part_number := 'deleted';
    end if;
    return query select v_event_id, v_part_number, true;
    return;
  end if;

  -- Fetch part details for audit
  select s.* into v_part from public.stock s where s.id = v_part_id;
  if not found then
    raise exception 'part not found' using errcode = 'P0002';
  end if;

  v_part_number := v_part.part_number;

  -- Delete the part (FK constraints will prevent if referenced)
  delete from public.stock where id = v_part_id;

  -- Insert audit event
  insert into public.part_master_events (
    correlation_id,
    part_id,
    part_number,
    actor,
    reason,
    previous_values,
    new_values,
    previous_version,
    new_version
  ) values (
    v_correlation,
    v_part_id,
    v_part_number,
    v_actor,
    v_reason,
    jsonb_build_object(
      'part_number', v_part.part_number,
      'description', v_part.description,
      'type', v_part.type,
      'qty_on_hand', v_part.qty_on_hand,
      'min_qty', v_part.min_qty,
      'max_qty', v_part.max_qty,
      'on_plan', v_part.on_plan,
      'bin_location', v_part.bin_location,
      'module', v_part.module,
      'unit_cost', v_part.unit_cost
    ),
    '{}'::jsonb,
    v_part.version,
    v_part.version + 1
  ) returning event_id into v_event_id;

  return query select v_event_id, v_part_number, true;
end;
$$;

revoke all on function public.delete_part_master(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.delete_part_master(uuid, text, text, text)
  to service_role;

commit;
