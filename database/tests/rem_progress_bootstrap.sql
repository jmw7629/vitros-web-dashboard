-- DISPOSABLE DATABASE ONLY: extends rem_operational_bootstrap.sql.
alter table public.rem_analyzers add column procurement_pct numeric, add column qa_release_pct numeric,
 add column sap_release_pct numeric, add column overall_pct numeric, add column current_pct numeric,
 add column days_in_stage integer, add column start_date text, add column end_date text;
alter table public.audit_log add column old_value jsonb, add column created_at timestamptz default now();
create table public.convex_employees(id uuid primary key,name text,initials text,active boolean);
create table public.rem_lvcc(id uuid primary key default gen_random_uuid(),serial_number text,
 item_type text,batch_number text,start_date text,end_date text,current_stage text,is_complete boolean,
 build_pct numeric,test_pct numeric,packaging_pct numeric,qa_release_pct numeric,sap_release_pct numeric);
grant usage on schema public to service_role;
grant select on public.convex_employees to service_role;
grant select,insert,update on public.rem_analyzers,public.rem_lvcc to service_role;
grant select,insert on public.audit_log to service_role;
-- Model Supabase's table defaults so event immutability is explicitly tested.
alter default privileges in schema public grant all on tables to service_role;
