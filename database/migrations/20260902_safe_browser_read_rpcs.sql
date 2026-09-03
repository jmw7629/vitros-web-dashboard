-- Safe anonymous browser read RPCs for the VITROS fallback path.
-- These functions expose only explicitly approved browser fields and are
-- intentionally read-only. Base-table anonymous SELECT remains temporarily
-- until the browser client is migrated to these RPCs and independently verified.

create or replace function public.browser_read_stock()
returns table (
  id uuid,
  part_number text,
  description text,
  type text,
  qty_on_hand integer,
  min_qty integer,
  max_qty integer,
  on_plan boolean,
  bin_location text,
  module text,
  unit_cost numeric,
  last_activity timestamptz,
  status text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.id, s.part_number, s.description, s.type, s.qty_on_hand, s.min_qty,
         s.max_qty, s.on_plan, s.bin_location, s.module, s.unit_cost,
         s.last_activity, s.status, s.updated_at
  from public.stock as s
  order by s.part_number asc;
$$;

create or replace function public.browser_read_audit_log()
returns table (
  id uuid,
  action text,
  part_number text,
  user_name text,
  created_at timestamptz,
  new_value jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select a.id,
         a.action,
         a.part_number,
         a.user_name,
         a.created_at,
         jsonb_build_object(
           'description', coalesce(a.new_value ->> 'description', ''),
           'qty', coalesce(a.new_value -> 'qty', '0'::jsonb),
           'qty_before', coalesce(a.new_value -> 'qty_before', a.new_value -> 'qtyBefore', '0'::jsonb),
           'qty_after', coalesce(a.new_value -> 'qty_after', a.new_value -> 'qtyAfter', '0'::jsonb),
           'sap_status', coalesce(a.new_value ->> 'sap_status', 'NOT_PUSHED')
         ) as new_value
  from public.audit_log as a
  order by a.created_at desc
  limit 500;
$$;

create or replace function public.browser_read_sap_staging()
returns table (
  id uuid,
  tx_id text,
  created_at timestamptz,
  mode text,
  part_number text,
  description text,
  qty integer,
  qty_before integer,
  qty_after integer,
  movement_type text,
  plant_code text,
  storage_location text,
  status text,
  exported boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.id,
         null::text as tx_id,
         s.created_at,
         coalesce(s.mode, 'RECEIVE') as mode,
         s.part_number,
         s.description,
         s.qty_on_hand as qty,
         s.qty_before,
         s.qty_after,
         s.movement_type,
         s.plant_code,
         s.storage_location,
         s.export_status as status,
         (s.export_status = 'EXPORTED') as exported
  from public.sap_staging as s
  order by s.created_at desc;
$$;

create or replace function public.browser_read_settings()
returns table (
  key text,
  value text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.key, s.value
  from public.settings as s
  where s.key in (
    'sapHeaderText',
    'sapMovementADJUST',
    'sapMovementIN',
    'sapMovementOUT',
    'sapPlantCode',
    'sapStorageLocation'
  )
  order by s.key asc;
$$;

revoke all on function public.browser_read_stock() from public;
revoke all on function public.browser_read_audit_log() from public;
revoke all on function public.browser_read_sap_staging() from public;
revoke all on function public.browser_read_settings() from public;
revoke all on function public.browser_read_stock() from authenticated;
revoke all on function public.browser_read_audit_log() from authenticated;
revoke all on function public.browser_read_sap_staging() from authenticated;
revoke all on function public.browser_read_settings() from authenticated;

grant execute on function public.browser_read_stock() to anon;
grant execute on function public.browser_read_audit_log() to anon;
grant execute on function public.browser_read_sap_staging() to anon;
grant execute on function public.browser_read_settings() to anon;
