CREATE OR REPLACE FUNCTION public.create_part_master(p_part_number text, p_description text, p_actor text, p_correlation_id text, p_type text DEFAULT 'Required'::text, p_min_qty integer DEFAULT 0, p_max_qty integer DEFAULT 0, p_on_plan boolean DEFAULT false, p_bin_location text DEFAULT ''::text, p_module text DEFAULT ''::text, p_unit_cost numeric DEFAULT 0, p_reason text DEFAULT NULL::text)
 RETURNS TABLE(part_id uuid, part_number text, version integer, created_at timestamp with time zone, event_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_part_number text := upper(btrim(p_part_number));
  v_description text := btrim(p_description);
  v_type text := btrim(coalesce(p_type, 'Required'));
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
  v_event public.part_master_events%rowtype;
  v_event_id bigint;
  v_request_values jsonb;
begin
  if v_part_number = '' or char_length(v_part_number) > 64 then
    raise exception 'part number must be 1-64 characters' using errcode = '22023';
  end if;
  if v_description = '' or char_length(v_description) > 255 then
    raise exception 'description must be 1-255 characters' using errcode = '22023';
  end if;
  if v_type not in ('Required','Optional','Not on BOM','Consumable') then
    raise exception 'invalid part type' using errcode = '22023';
  end if;
  if v_min_qty < 0 or v_max_qty < 0 then
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

  v_request_values := jsonb_build_object(
    'part_number', v_part_number,
    'description', v_description,
    'type', v_type,
    'qty_on_hand', 0,
    'min_qty', v_min_qty,
    'max_qty', v_max_qty,
    'on_plan', v_on_plan,
    'bin_location', v_bin_location,
    'module', v_module,
    'unit_cost', v_unit_cost
  );

  perform pg_advisory_xact_lock(hashtextextended('part-master-create:' || v_part_number, 0));
  perform pg_advisory_xact_lock(hashtextextended('part-master-correlation:' || v_correlation, 0));

  select e.* into v_event
  from public.part_master_events e
  where e.correlation_id = v_correlation;

  if found then
    if v_event.previous_version <> 0
       or v_event.part_number <> v_part_number
       or v_event.request_values <> v_request_values then
      raise exception 'correlation id was already used for a different change' using errcode = '23505';
    end if;

    select s.created_at into v_created_at
    from public.stock s
    where s.id = v_event.part_id;
    if not found then
      raise exception 'idempotent part creation target is missing' using errcode = '55000';
    end if;

    return query select v_event.part_id, v_event.part_number, v_event.new_version, v_created_at, v_event.event_id;
    return;
  end if;

  if exists (select 1 from public.stock s where upper(btrim(s.part_number)) = v_part_number) then
    raise exception 'part number already exists' using errcode = '23505';
  end if;

  insert into public.stock as created_stock (
    part_number, description, type, qty_on_hand,
    min_qty, max_qty, on_plan, bin_location, module, unit_cost,
    version, last_activity, updated_at
  ) values (
    v_part_number, v_description, v_type, 0,
    v_min_qty, v_max_qty, v_on_plan, v_bin_location, v_module, v_unit_cost,
    1, now(), now()
  ) returning created_stock.id, created_stock.created_at into v_new_id, v_created_at;

  insert into public.part_master_events as created_event (
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
    v_new_id,
    v_part_number,
    v_actor,
    v_reason,
    '{}'::jsonb,
    v_request_values,
    v_request_values,
    0,
    1
  ) returning created_event.event_id into v_event_id;

  return query select v_new_id, v_part_number, 1, v_created_at, v_event_id;
end;
$function$
