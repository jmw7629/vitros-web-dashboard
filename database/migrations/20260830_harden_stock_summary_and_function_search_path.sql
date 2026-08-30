alter view public.stock_summary set (security_invoker = true);
alter function public.log_stock_change() set search_path = public, pg_temp;
alter function public.update_updated_at() set search_path = public, pg_temp;
