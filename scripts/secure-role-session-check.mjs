import fs from "node:fs";

const roleLogin = fs.readFileSync("src/pages/RoleLogin.tsx", "utf8");
const useRole = fs.readFileSync("src/hooks/useRole.tsx", "utf8");
const auth = fs.readFileSync("convex/auth.ts", "utf8");
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
