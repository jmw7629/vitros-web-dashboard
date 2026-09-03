-- Final browser read-boundary cutover.
--
-- IMPORTANT: Apply only after the reviewed browser-safe-read Edge/client cutover
-- is live in production, the Edge function is deployed from the exact reviewed
-- source with verify_jwt=false, and its post-deploy read smoke passes.
--
-- Scope is deliberately narrow: remove only the temporary anonymous SELECT
-- policies/grants on the four base tables. No authenticated/service-role grants,
-- business rows, RLS enablement, browser views, or write privileges are changed.

begin;

drop policy if exists "public dashboard read stock" on public.stock;
drop policy if exists "public dashboard read audit_log" on public.audit_log;
drop policy if exists "public dashboard read sap_staging" on public.sap_staging;
drop policy if exists "public dashboard read settings" on public.settings;

revoke select on table public.stock from anon;
revoke select on table public.audit_log from anon;
revoke select on table public.sap_staging from anon;
revoke select on table public.settings from anon;

-- Fail the migration rather than leaving a partially-open anonymous boundary.
do $$
declare
  exposed_table text;
begin
  foreach exposed_table in array array['stock', 'audit_log', 'sap_staging', 'settings']
  loop
    if has_table_privilege('anon', format('public.%I', exposed_table), 'select') then
      raise exception 'anonymous SELECT still granted on public.%', exposed_table;
    end if;

    if exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = exposed_table
        and cmd = 'SELECT'
        and roles @> array['anon'::name]
    ) then
      raise exception 'anonymous SELECT policy still present on public.%', exposed_table;
    end if;
  end loop;
end
$$;

commit;
