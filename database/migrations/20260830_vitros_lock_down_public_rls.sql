begin;

do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname='public'
      and roles = '{public}'
      and (qual = 'true' or with_check = 'true')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Privileged browser access is intentionally denied by default. Convex server
-- actions use the Supabase service role, which bypasses RLS. Any future direct
-- browser SELECT policy must be explicit, read-only, and separately reviewed.

commit;
