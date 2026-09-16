-- Additive, private part metadata. Existing RLS/grants and ledger behavior remain in force.
alter table public.stock add column if not exists supported_models text[] not null default '{}';
alter table public.stock add column if not exists subassembly_codes text[] not null default '{}';
alter table public.stock add column if not exists system_side text not null default 'Not mapped' check (system_side in ('Dry','Wet','Both','Shared','Not mapped'));
alter table public.stock add column if not exists mapping_evidence jsonb not null default '{}' check (jsonb_typeof(mapping_evidence)='object');
comment on column public.stock.supported_models is 'Positive source-backed model applicability; empty means not verified, never universal compatibility.';
comment on column public.stock.subassembly_codes is 'Codes from the user-supplied 5600 reference diagram; not independent proof of the same code on another model.';
comment on column public.stock.system_side is 'User-defined orientation: Cuvette Supply and left = Dry; MicroTip Supply and right = Wet. Not manufacturer xDry terminology.';
comment on column public.stock.mapping_evidence is 'Source provenance, limitations and field-level audit notes. Maintained by reviewed source imports.';
CREATE OR REPLACE FUNCTION public.apply_part_master_change(p_part_id uuid, p_updates jsonb, p_expected_version integer, p_actor text, p_correlation_id text, p_reason text DEFAULT NULL::text)
 RETURNS TABLE(event_id bigint, part_id uuid, part_number text, version integer, updated_at timestamp with time zone, duplicate boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_part_id uuid := p_part_id;
  v_updates jsonb := coalesce(p_updates, '{}'::jsonb);
  v_actor text := btrim(coalesce(p_actor, ''));
  v_correlation text := btrim(coalesce(p_correlation_id, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_allowed_keys text[] := array['description','type','min_qty','max_qty','on_plan','bin_location','module','unit_cost','supported_models','subassembly_codes','system_side','mapping_evidence'];
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
  if v_actor = '' or char_length(v_actor) > 200 then
    raise exception 'invalid actor' using errcode = '22023';
  end if;
  if v_correlation = '' or char_length(v_correlation) > 200 then
    raise exception 'invalid correlation id' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'reason is too long' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'expected version must be a positive integer' using errcode = '22023';
  end if;

  for v_key in select * from jsonb_object_keys(v_updates) loop
    if v_key = any(v_allowed_keys) then
      v_safe_updates := jsonb_set(v_safe_updates, array[v_key], v_updates->v_key);
    else
      raise exception 'field % is not editable via part master administration', v_key using errcode = '22023';
    end if;
  end loop;

  if v_safe_updates = '{}'::jsonb then
    raise exception 'no permitted part master fields supplied' using errcode = '22023';
  end if;

  if v_safe_updates ? 'type' then
    if (v_safe_updates->>'type') not in ('Required','Optional','Not on BOM','Consumable') then
      raise exception 'invalid part type' using errcode = '22023';
    end if;
  end if;
  if v_safe_updates ? 'min_qty' then
    if jsonb_typeof(v_safe_updates->'min_qty') <> 'number'
       or (v_safe_updates->>'min_qty')::numeric <> trunc((v_safe_updates->>'min_qty')::numeric)
       or (v_safe_updates->>'min_qty')::numeric < 0 then
      raise exception 'min_qty must be a non-negative integer' using errcode = '22023';
    end if;
  end if;
  if v_safe_updates ? 'max_qty' then
    if jsonb_typeof(v_safe_updates->'max_qty') <> 'number'
       or (v_safe_updates->>'max_qty')::numeric <> trunc((v_safe_updates->>'max_qty')::numeric)
       or (v_safe_updates->>'max_qty')::numeric < 0 then
      raise exception 'max_qty must be a non-negative integer' using errcode = '22023';
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

  for v_key in select * from jsonb_object_keys(v_safe_updates) loop
    if v_key in ('supported_models','subassembly_codes') then
      if jsonb_typeof(v_safe_updates->v_key) <> 'array' then raise exception '% must be an array',v_key using errcode='22023'; end if;
      if jsonb_array_length(v_safe_updates->v_key)>20 or exists(select 1 from jsonb_array_elements(v_safe_updates->v_key) e where jsonb_typeof(e)<>'string' or length(e#>>'{}') not between 1 and 80) then raise exception 'invalid metadata array' using errcode='22023'; end if;
      if v_key='subassembly_codes' and exists(select 1 from jsonb_array_elements_text(v_safe_updates->v_key) e where e !~ '^[A-Z]{2}$') then raise exception 'invalid subassembly code' using errcode='22023'; end if;
    end if;
  end loop;
  if v_safe_updates ? 'system_side' and (jsonb_typeof(v_safe_updates->'system_side')<>'string' or v_safe_updates->>'system_side' not in ('Dry','Wet','Both','Shared','Not mapped')) then raise exception 'invalid system side' using errcode='22023'; end if;
  if v_safe_updates ? 'mapping_evidence' and (jsonb_typeof(v_safe_updates->'mapping_evidence')<>'object' or octet_length((v_safe_updates->'mapping_evidence')::text)>65536) then raise exception 'invalid mapping evidence' using errcode='22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('part-master:' || v_part_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('part-master-correlation:' || v_correlation, 0));

  select e.* into v_event
  from public.part_master_events e
  where e.correlation_id = v_correlation;

  if found then
    if v_event.part_id <> v_part_id or v_event.request_values <> v_safe_updates then
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

  select s.id, s.part_number, s.description, s.type, s.qty_on_hand,
         s.min_qty, s.max_qty, s.on_plan, s.bin_location, s.module,
         s.unit_cost, s.version, s.updated_at, s.supported_models, s.subassembly_codes, s.system_side, s.mapping_evidence
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

  v_previous_values := jsonb_build_object(
    'description', v_current.description,
    'type', v_current.type,
    'min_qty', v_current.min_qty,
    'max_qty', v_current.max_qty,
    'on_plan', v_current.on_plan,
    'bin_location', v_current.bin_location,
    'module', v_current.module,
    'unit_cost', v_current.unit_cost,
    'supported_models',v_current.supported_models,
    'subassembly_codes',v_current.subassembly_codes,
    'system_side',v_current.system_side,
    'mapping_evidence',v_current.mapping_evidence
  );

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
    supported_models = case when v_safe_updates ? 'supported_models' then array(select jsonb_array_elements_text(v_safe_updates->'supported_models')) else v_current.supported_models end,
    subassembly_codes = case when v_safe_updates ? 'subassembly_codes' then array(select jsonb_array_elements_text(v_safe_updates->'subassembly_codes')) else v_current.subassembly_codes end,
    system_side = coalesce(v_safe_updates->>'system_side',v_current.system_side),
    mapping_evidence = coalesce(v_safe_updates->'mapping_evidence',v_current.mapping_evidence),
    version = v_current.version + 1,
    updated_at = now()
  where s.id = v_part_id
  returning s.updated_at into v_updated_at;

  v_new_values := jsonb_build_object(
    'description', coalesce(v_safe_updates->>'description', v_current.description),
    'type', coalesce(v_safe_updates->>'type', v_current.type),
    'min_qty', coalesce((v_safe_updates->>'min_qty')::numeric, v_current.min_qty),
    'max_qty', coalesce((v_safe_updates->>'max_qty')::numeric, v_current.max_qty),
    'on_plan', coalesce((v_safe_updates->>'on_plan')::boolean, v_current.on_plan),
    'bin_location', coalesce(v_safe_updates->>'bin_location', v_current.bin_location),
    'module', coalesce(v_safe_updates->>'module', v_current.module),
    'unit_cost', coalesce((v_safe_updates->>'unit_cost')::numeric, v_current.unit_cost),
    'supported_models',coalesce(v_safe_updates->'supported_models',to_jsonb(v_current.supported_models)),
    'subassembly_codes',coalesce(v_safe_updates->'subassembly_codes',to_jsonb(v_current.subassembly_codes)),
    'system_side',coalesce(v_safe_updates->>'system_side',v_current.system_side),
    'mapping_evidence',coalesce(v_safe_updates->'mapping_evidence',v_current.mapping_evidence)
  );

  insert into public.part_master_events (
    correlation_id,
    part_id,
    part_number,
    actor,
    reason,
    previous_values,
    new_values,
    request_values,
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
    v_safe_updates,
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
$function$
