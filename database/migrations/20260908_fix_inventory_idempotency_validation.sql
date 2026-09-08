-- Forward migration: add strict idempotency input validation on correlation conflict.
-- Does not rewrite 20260830_vitros_atomic_inventory_transition.sql; deploys as a new version.
-- Preserves all existing IN/RECEIVE/OUT/ADJUST/STOCKOUT behavior, audit/SAP IDs, grants.

begin;

create or replace function public.apply_inventory_transition(
  p_part_number text,
  p_mode text,
  p_qty integer,
  p_user text,
  p_correlation_id text,
  p_analyzer_serial text default null,
  p_batch_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stock public.stock%rowtype;
  v_before integer;
  v_after integer;
  v_movement text;
  v_plant text;
  v_sloc text;
  v_existing public.inventory_operations%rowtype;
  v_audit_id uuid;
  v_sap_id uuid;
  v_result jsonb;
begin
  if p_correlation_id is null or btrim(p_correlation_id) = '' then
    raise exception 'correlationId is required';
  end if;
  if p_mode not in ('IN','RECEIVE','OUT','ADJUST','STOCKOUT') then
    raise exception 'Unsupported inventory mode: %', p_mode;
  end if;
  if p_mode in ('IN','RECEIVE','OUT') and p_qty <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;
  if p_mode = 'ADJUST' and p_qty < 0 then
    raise exception 'Adjusted quantity cannot be negative';
  end if;

  insert into public.inventory_operations(correlation_id,part_number,mode,requested_qty)
  values (p_correlation_id,p_part_number,p_mode,p_qty)
  on conflict (correlation_id) do nothing;

  if not found then
    select * into v_existing
    from public.inventory_operations
    where correlation_id = p_correlation_id;

    if upper(btrim(v_existing.part_number)) <> upper(btrim(p_part_number)) then
      raise exception 'Inventory idempotency conflict';
    end if;
    if v_existing.mode <> p_mode then
      raise exception 'Inventory idempotency conflict';
    end if;
    if v_existing.requested_qty <> p_qty then
      raise exception 'Inventory idempotency conflict';
    end if;

    if v_existing.result is not null then
      return v_existing.result || jsonb_build_object('duplicate', true);
    end if;
    raise exception 'Inventory operation is already in progress';
  end if;

  select * into v_stock from public.stock where upper(part_number)=upper(p_part_number) for update;
  if not found then raise exception 'Part not found: %', p_part_number; end if;

  v_before := coalesce(v_stock.qty_on_hand,0);
  case p_mode
    when 'IN' then v_after := v_before + p_qty;
    when 'RECEIVE' then v_after := v_before + p_qty;
    when 'OUT' then
      if p_qty > v_before then raise exception 'Insufficient stock: requested %, available %', p_qty, v_before; end if;
      v_after := v_before - p_qty;
    when 'ADJUST' then v_after := p_qty;
    when 'STOCKOUT' then v_after := v_before;
  end case;

  if p_mode <> 'STOCKOUT' then
    update public.stock set qty_on_hand=v_after, last_activity=now(), updated_at=now() where id=v_stock.id;
  end if;

  insert into public.audit_log(action,entity_type,entity_id,part_number,user_name,correlation_id,details,old_value,new_value,created_at)
  values (
    p_mode,'stock',v_stock.id::text,v_stock.part_number,p_user,p_correlation_id,
    jsonb_build_object('qty',p_qty,'analyzerSerial',p_analyzer_serial,'batchId',p_batch_id),
    jsonb_build_object('qty_on_hand',v_before),
    jsonb_build_object('qty_on_hand',v_after,'qty',p_qty,'qty_before',v_before,'qty_after',v_after,'description',v_stock.description),
    now()
  ) returning id into v_audit_id;

  if p_mode <> 'STOCKOUT' then
    select value into v_plant from public.settings where key='sapPlantCode';
    select value into v_sloc from public.settings where key='sapStorageLocation';
    if p_mode in ('IN','RECEIVE') then
      select value into v_movement from public.settings where key='sapMovementIN';
      v_movement := coalesce(v_movement,'101');
    elsif p_mode='OUT' then
      select value into v_movement from public.settings where key='sapMovementOUT';
      v_movement := coalesce(v_movement,'261');
    else
      select value into v_movement from public.settings where key='sapMovementADJUST';
      v_movement := coalesce(v_movement,'711');
    end if;

    insert into public.sap_staging(part_number,description,qty_on_hand,movement_type,plant_code,storage_location,batch_id,export_status,created_at,qty_before,qty_after,mode,correlation_id)
    values (v_stock.part_number,v_stock.description,p_qty,v_movement,coalesce(v_plant,'US08'),coalesce(v_sloc,'MAIN'),p_batch_id,'pending',now(),v_before,v_after,p_mode,p_correlation_id)
    returning id into v_sap_id;
  end if;

  v_result := jsonb_build_object(
    'success',true,'partNumber',v_stock.part_number,'description',coalesce(v_stock.description,''),
    'qtyBefore',v_before,'qtyAfter',v_after,'mode',p_mode,'correlationId',p_correlation_id,
    'auditId',v_audit_id,'sapId',v_sap_id
  );
  update public.inventory_operations set result=v_result, completed_at=now() where correlation_id=p_correlation_id;
  return v_result;
end;
$$;

revoke all on function public.apply_inventory_transition(text,text,integer,text,text,text,text) from public, anon, authenticated;
grant execute on function public.apply_inventory_transition(text,text,integer,text,text,text,text) to service_role;

commit;