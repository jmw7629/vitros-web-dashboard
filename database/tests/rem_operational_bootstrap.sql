-- DISPOSABLE DATABASE ONLY. These fresh tables model columns used by the
-- existing, unmodified authoritative REM migration. No production cleanup.
-- Roles belong to the cluster, so another disposable suite may already have
-- created them in its own database. Never rewrite an existing role's grants.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create table public.rem_analyzers (
  id uuid primary key default gen_random_uuid(), serial_number text, analyzer_type text,
  production_order numeric, cleaning_pct numeric, service_pct numeric, final_line_pct numeric,
  release_testing_pct numeric, packaging_pct numeric, current_stage text, is_complete boolean,
  operator_notes text
);
create table public.rem_tracker_weekly(id uuid primary key default gen_random_uuid(),data jsonb);
create table public.rem_build_plan(id uuid primary key default gen_random_uuid(),data jsonb);
create table public.rem_staff(id uuid primary key default gen_random_uuid(),name text,role text,skills jsonb,certifications jsonb);
create table public.rem_weekly_notes(id uuid primary key default gen_random_uuid(),week_number integer,quarter text,week_start text,notes jsonb);
create table public.rem_targets(id uuid primary key default gen_random_uuid(),year integer,target_type text,target_value numeric,actual_value numeric,data jsonb);
create table public.audit_log(id uuid primary key default gen_random_uuid(),action text,entity_type text,entity_id text,user_name text,details jsonb,new_value jsonb,correlation_id text);
insert into public.rem_analyzers(serial_number,analyzer_type,operator_notes) values('99999999','5600','Synthetic REM-only note must survive omitted row');
