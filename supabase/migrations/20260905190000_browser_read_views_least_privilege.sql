-- Browser-safe Supabase read surfaces must remain read-only and security-invoker.
-- All authoritative writes flow through authenticated server actions / reviewed RPCs.

alter view public.browser_stock set (security_invoker = true);
alter view public.browser_sap_staging set (security_invoker = true);
alter view public.browser_settings set (security_invoker = true);
alter view public.browser_audit_log set (security_invoker = true);
alter view public.stock_summary set (security_invoker = true);

revoke insert, update, delete, truncate, references, trigger
  on table public.browser_stock,
           public.browser_sap_staging,
           public.browser_settings,
           public.browser_audit_log,
           public.stock_summary
  from anon, authenticated;

grant select
  on table public.browser_stock,
           public.browser_sap_staging,
           public.browser_settings,
           public.browser_audit_log,
           public.stock_summary
  to anon, authenticated;
