const TARGET_SHA = "a8dd02a34cc08db3d992268a4aa2d719567d063c";
const ROOT = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}`;

async function get(path) {
  const response = await fetch(`${ROOT}/${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`target fetch failed ${path}: ${response.status}`);
  return await response.text();
}

const [login, roleHook, auth, env, ci] = await Promise.all([
  get("src/pages/RoleLogin.tsx"),
  get("src/hooks/useRole.tsx"),
  get("convex/auth.ts"),
  get(".env.example"),
  get(".github/workflows/ci.yml"),
]);

function requireAll(source, label, tokens) {
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${label} missing invariant: ${token}`);
}
function forbidAll(source, label, tokens) {
  for (const token of tokens) if (source.includes(token)) throw new Error(`${label} contains forbidden invariant: ${token}`);
}

requireAll(login, "RoleLogin", [
  'useAuthActions',
  'signIn("vitros-role", { role: "engineer", initials: normalized })',
  'signIn("vitros-role", { role: "superuser", secret: password })',
  'Active employee initials',
]);
forbidAll(login, "RoleLogin", [
  'password === "12345"',
  'password == "12345"',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_VITROS_SUPERUSER',
]);

requireAll(auth, "auth", [
  'id: "vitros-role"',
  'internal.auth.validateRoleSelection',
  'convex_employees?select=id,name,initials,active',
  'active=is.true',
  'VITROS_SUPERUSER_PASSWORD_HASH',
  'new Scrypt().verify(secret, hash)',
  'maxFailedAttempsPerHour: 6',
  'args.provider.id !== "vitros-role"',
  'await ctx.db.patch(args.userId',
]);
forbidAll(auth, "auth", [
  '"12345"',
  'VITE_VITROS_SUPERUSER_PASSWORD_HASH',
  'VITE_SUPERUSER_PASSWORD',
]);

requireAll(roleHook, "useRole", [
  'const { signOut } = useAuthActions()',
  'void signOut()',
  'user === null',
  '? null',
]);
forbidAll(roleHook, "useRole", [
  'user === null\n      ? localRole',
  'return (saved as Role) || null',
]);

requireAll(env, "env", ['VITROS_SUPERUSER_PASSWORD_HASH=', 'Scrypt hash only']);
forbidAll(env, "env", ['VITE_VITROS_SUPERUSER_PASSWORD_HASH=']);
requireAll(ci, "CI", ['node scripts/secure-role-session-check.mjs']);

console.log(`VERIFY=PASS SHA=${TARGET_SHA} SUPERUSER_ENV=VITROS_SUPERUSER_PASSWORD_HASH`);
