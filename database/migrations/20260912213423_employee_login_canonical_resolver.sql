-- Independent of the employee administration migration: preserve legacy rows.
-- Login resolves canonical initials without rewriting identity/history. Only
-- active identities participate; multiple active matches fail closed.
BEGIN;
CREATE OR REPLACE FUNCTION public.resolve_active_employee_login(p_initials text)
RETURNS TABLE (id uuid, name text, initials text, active boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH candidates AS MATERIALIZED (
    SELECT e.id, e.name, e.initials, e.active
    FROM public.convex_employees e
    WHERE upper(btrim(p_initials)) ~ '^[A-Z0-9]{1,4}$'
      AND upper(btrim(e.initials)) = upper(btrim(p_initials))
      AND e.active IS TRUE
    LIMIT 2
  )
  SELECT c.id, c.name, upper(btrim(c.initials)), c.active
  FROM candidates c
  WHERE (SELECT count(*) FROM candidates) = 1
    AND c.active IS TRUE
    AND btrim(c.name) <> '';
$$;
REVOKE ALL ON FUNCTION public.resolve_active_employee_login(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_active_employee_login(text) TO service_role;
COMMENT ON FUNCTION public.resolve_active_employee_login(text) IS
  'Server-only canonical login lookup; missing, inactive and ambiguous identities return no rows.';
COMMIT;
