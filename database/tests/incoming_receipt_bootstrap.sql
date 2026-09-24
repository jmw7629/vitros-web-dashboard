-- DISPOSABLE SYNTHETIC DATABASE ONLY. Minimal inventory authority for #442 tests.
\set ON_ERROR_STOP on
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create table public.stock(id uuid primary key default gen_random_uuid(),part_number text,description text,qty_on_hand integer,last_activity timestamptz,updated_at timestamptz);
create table public.audit_log(id uuid primary key default gen_random_uuid(),action text,entity_type text,entity_id text,part_number text,user_name text,details jsonb,old_value jsonb,new_value jsonb,created_at timestamptz);
create table public.sap_staging(id uuid primary key default gen_random_uuid(),part_number text,description text,qty_on_hand integer,movement_type text,plant_code text,storage_location text,batch_id text,export_status text,created_at timestamptz);
insert into public.stock(part_number,description,qty_on_hand) values('ABC123','Synthetic receipt stock',20),('XYZ999','Synthetic alternate stock',10);
