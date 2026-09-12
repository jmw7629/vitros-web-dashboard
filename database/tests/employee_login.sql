-- DISPOSABLE TEST DATABASE ONLY. Run after employee_bootstrap.sql and the login
-- resolver migration, BEFORE administration uniqueness migrations. All fixtures
-- roll back; deliberately duplicate legacy initials test the fail-closed lookup.
BEGIN;
INSERT INTO public.convex_employees (id, name, initials, active) VALUES
 ('33333333-3333-3333-3333-333333333333', 'Synthetic Legacy', ' ab ', true),
 ('44444444-4444-4444-4444-444444444444', 'Synthetic Inactive', 'CD', false),
 ('55555555-5555-5555-5555-555555555555', 'Synthetic Null Active', 'EF', null),
 ('66666666-6666-6666-6666-666666666666', 'Synthetic Duplicate One', 'GH', true),
 ('77777777-7777-7777-7777-777777777777', 'Synthetic Duplicate Two', ' gh ', true),
 ('88888888-8888-8888-8888-888888888888', 'Synthetic Historical AB', 'AB', false);
DO $$
DECLARE matched record;
BEGIN
 SELECT * INTO STRICT matched FROM public.resolve_active_employee_login(' Ab ');
 -- The inactive canonical AB duplicate must not prevent active legacy login.
 IF matched.id <> '33333333-3333-3333-3333-333333333333'::uuid OR matched.initials <> 'AB' OR matched.active IS NOT TRUE THEN
   RAISE EXCEPTION 'Canonical legacy login failed';
 END IF;
 IF EXISTS (SELECT FROM public.resolve_active_employee_login('CD'))
 OR EXISTS (SELECT FROM public.resolve_active_employee_login('EF'))
 OR EXISTS (SELECT FROM public.resolve_active_employee_login('GH'))
 OR EXISTS (SELECT FROM public.resolve_active_employee_login('ZZ'))
 OR EXISTS (SELECT FROM public.resolve_active_employee_login('A*'))
 OR EXISTS (SELECT FROM public.resolve_active_employee_login(NULL)) THEN
   RAISE EXCEPTION 'Missing/inactive/ambiguous/invalid login did not fail closed';
 END IF;
 IF has_function_privilege('anon', 'public.resolve_active_employee_login(text)', 'EXECUTE')
 OR has_function_privilege('authenticated', 'public.resolve_active_employee_login(text)', 'EXECUTE')
 OR NOT has_function_privilege('service_role', 'public.resolve_active_employee_login(text)', 'EXECUTE') THEN
   RAISE EXCEPTION 'Resolver execute grants are incorrect';
 END IF;
 IF (SELECT initials FROM public.convex_employees WHERE id = matched.id) <> ' ab ' THEN
   RAISE EXCEPTION 'Resolver modified legacy initials';
 END IF;
END;
$$;
-- The minimal bootstrap has no table grants; emulate the existing server grant.
GRANT SELECT ON public.convex_employees TO service_role;
SET LOCAL ROLE service_role;
SELECT 1 / count(*)::integer AS service_role_login_pass FROM public.resolve_active_employee_login('AB');
RESET ROLE;
ROLLBACK;
