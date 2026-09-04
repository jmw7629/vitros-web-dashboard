import fs from "node:fs";

const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const command = String(config.buildCommand || "");

const required = [
  '$VERCEL_ENV',
  '"production"',
  'npx convex deploy',
  '--cmd-url-env-var-name VITE_CONVEX_URL',
  "--cmd 'npm run build'",
  'else npm run build',
];
for (const token of required) {
  if (!command.includes(token)) throw new Error(`Vercel build command missing invariant: ${token}`);
}

for (const forbidden of [
  'CONVEX_DEPLOY_KEY=',
  'SUPABASE_SERVICE_ROLE_KEY=',
  'OPENAI_API_KEY=',
  'VITE_CONVEX_DEPLOY_KEY',
]) {
  if (command.includes(forbidden)) throw new Error(`Vercel build command contains secret material: ${forbidden}`);
}

if (!command.trim().startsWith('if [ "$VERCEL_ENV" = "production" ]')) {
  throw new Error("Convex deployment must remain production-only unless a separate preview deploy key is explicitly configured");
}

console.log("VERCEL_CONVEX_COUPLING=PASS");
