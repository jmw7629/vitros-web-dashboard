begin;

create table if not exists public.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.settings(key,value) values
  ('sapPlantCode','US08'),
  ('sapStorageLocation','MAIN'),
  ('sapMovementIN','101'),
  ('sapMovementOUT','261'),
  ('sapMovementADJUST','711'),
  ('sapHeaderText','VITROS Analyzer Consumption')
on conflict (key) do nothing;

alter table public.audit_log add column if not exists correlation_id text;
create unique index if not exists audit_log_correlation_id_uq on public.audit_log(correlation_id) where correlation_id is not null;

alter table public.sap_staging add column if not exists qty_before integer;
alter table public.sap_staging add column if not exists qty_after integer;
alter table public.sap_staging add column if not exists mode text;
alter table public.sap_staging add column if not exists correlation_id text;
create unique index if not exists sap_staging_correlation_id_uq on public.sap_staging(correlation_id) where correlation_id is not null;

create table if not exists public.inventory_operations (
  correlation_id text primary key,
  part_number text not null,
  mode text not null,
  requested_qty integer not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.inventory_operations enable row level security;
alter table public.settings enable row level security;

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
  v_existing jsonb;
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
    select result into v_existing from public.inventory_operations where correlation_id = p_correlation_id;
    if v_existing is not null then
      return v_existing || jsonb_build_object('duplicate', true);
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
