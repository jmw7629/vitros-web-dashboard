import fs from "node:fs";

const roleLogin = fs.readFileSync("src/pages/RoleLogin.tsx", "utf8");
const useRole = fs.readFileSync("src/hooks/useRole.tsx", "utf8");
const auth = fs.readFileSync("convex/auth.ts", "utf8");
const loginResolver = fs.readFileSync("database/migrations/20260912213423_employee_login_canonical_resolver.sql", "utf8");
const envExample = fs.readFileSync(".env.example", "utf8");

function requireAll(source, label, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`${label} missing invariant: ${token}`);
  }
}
function forbidAll(source, label, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) throw new Error(`${label} contains forbidden invariant: ${token}`);
  }
}

requireAll(roleLogin, "RoleLogin", [
  'useAuthActions',
  'signIn("vitros-role", { role: "engineer", initials: normalized })',
  'signIn("vitros-role", { role: "superuser", secret: password })',
  'Active employee initials',
]);
forbidAll(roleLogin, "RoleLogin", [
  'password === "12345"',
  'password == "12345"',
  'VITE_SUPERUSER',
  'VITE_VITROS_SUPERUSER',
  'SUPABASE_SERVICE_ROLE_KEY',
]);

requireAll(auth, "auth", [
  'ConvexCredentials<DataModel>',
  'id: "vitros-role"',
  'internal.auth.validateRoleSelection',
  '/rest/v1/rpc/resolve_active_employee_login',
  'method: "POST"',
  'JSON.stringify({ p_initials: normalized })',
  'rows.length !== 1',
  'employee.active !== true',
  'VITROS_SUPERUSER_PASSWORD_HASH',
  'new Scrypt().verify(hash, secret)',
  'maxFailedAttempsPerHour: 6',
  'args.provider.id !== "vitros-role"',
  'await ctx.db.patch(args.userId',
]);
forbidAll(auth, "auth", [
  '"12345"',
  'new Scrypt().verify(secret, hash)',
  'VITE_VITROS_SUPERUSER_PASSWORD_HASH',
  'VITE_SUPERUSER_PASSWORD',
]);

requireAll(loginResolver, "canonical login resolver", [
  'SECURITY INVOKER',
  'SET search_path = public, pg_temp',
  'upper(btrim(e.initials)) = upper(btrim(p_initials))',
  'AND e.active IS TRUE',
  'LIMIT 2',
  '(SELECT count(*) FROM candidates) = 1',
  'REVOKE ALL ON FUNCTION public.resolve_active_employee_login(text) FROM PUBLIC, anon, authenticated;',
  'GRANT EXECUTE ON FUNCTION public.resolve_active_employee_login(text) TO service_role;',
]);
forbidAll(auth, "canonical employee login", ['initials=eq.', 'active=is.true']);
forbidAll(loginResolver, "canonical login resolver", ['SECURITY DEFINER']);

requireAll(useRole, "useRole", [
  'const { signOut } = useAuthActions()',
  'void signOut()',
  'user === null',
  '? null',
]);
forbidAll(useRole, "useRole", [
  'user === null\n      ? localRole',
  'return (saved as Role) || null',
]);

requireAll(envExample, ".env.example", [
  'VITROS_SUPERUSER_PASSWORD_HASH=',
  'Scrypt hash only',
]);
forbidAll(envExample, ".env.example", [
  'VITE_VITROS_SUPERUSER_PASSWORD_HASH=',
]);

console.log("SECURE_ROLE_SESSION=PASS");
