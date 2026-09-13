-- DISPOSABLE SYNTHETIC DATABASE ONLY. Fails on existing tables; never use in production.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create table public.convex_employees(id uuid primary key,name text,initials text,active boolean);
create table public.stock(id uuid primary key default gen_random_uuid(),part_number text,description text,qty_on_hand integer,last_activity timestamptz,updated_at timestamptz);
create table public.audit_log(id uuid primary key default gen_random_uuid(),action text,entity_type text,entity_id text,part_number text,user_name text,details jsonb,old_value jsonb,new_value jsonb,created_at timestamptz);
create table public.sap_staging(id uuid primary key default gen_random_uuid(),part_number text,description text,qty_on_hand integer,movement_type text,plant_code text,storage_location text,batch_id text,export_status text,created_at timestamptz);
create table public.dhr_scan_sessions(id uuid primary key default gen_random_uuid(),instrument_sn text,wo_number text,analyzer_model text,status text,revision integer default 0);
create table public.dhr_expected_parts(id uuid primary key default gen_random_uuid(),analyzer_model text,section_id text,part_number text,description text,bom_qty integer,category text);
create table public.dhr_scan_results(id uuid primary key default gen_random_uuid(),session_id uuid references public.dhr_scan_sessions(id),section_id text,part_number text,description text,expected_qty integer,scanned_qty integer,category text,status text,stock_before integer,stock_after integer,stock_id uuid,scanned_at timestamptz,scanned_by text,updated_at timestamptz);
insert into public.convex_employees values('11111111-1111-4111-8111-111111111111','Synthetic Alice','SA',true),('22222222-2222-4222-8222-222222222222','Synthetic Bob','SB',true),('33333333-3333-4333-8333-333333333333','Synthetic Inactive','SI',false);
insert into public.stock(part_number,description,qty_on_hand) values('ABC123','Different inventory description',20),('ALT123','Synthetic alias stock',20);
insert into public.dhr_scan_sessions(id,instrument_sn,wo_number,analyzer_model,status) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','56009999','SYNTHETIC-WO','5600','in_progress'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','56009998',null,'5600','in_progress');
insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category) values('5600','SYNTHETIC','ABC123','Different controlled description',2,'required'),('5600','SYNTHETIC','TOOL1','Synthetic Tool',1,'tool'),('5600','SYNTHETIC','MISSING','Synthetic missing inventory',1,'optional'),('5600','SYNTHETIC','ALIAS','Synthetic alias',1,'required');
