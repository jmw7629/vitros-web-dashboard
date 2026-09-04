const TARGET_SHA = "d1b60291ad108dc71a83faca697c8413c4d91764";
const ROOT = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}`;

async function get(path) {
  const response = await fetch(`${ROOT}/${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`target fetch failed ${path}: ${response.status}`);
  return await response.text();
}

const [vercel, check] = await Promise.all([
  get("vercel.json"),
  get("scripts/vercel-convex-coupling-check.mjs"),
]);
const config = JSON.parse(vercel);
const command = String(config.buildCommand || "");

for (const token of [
  'if [ "$VERCEL_ENV" = "production" ]',
  'npx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd \'npm run build\'',
  'else npm run build',
]) {
  if (!command.includes(token)) throw new Error(`missing build invariant: ${token}`);
}
for (const forbidden of [
  'CONVEX_DEPLOY_KEY=',
  'SUPABASE_SERVICE_ROLE_KEY=',
  'OPENAI_API_KEY=',
  'VITE_CONVEX_DEPLOY_KEY',
]) {
  if (command.includes(forbidden)) throw new Error(`secret material in build command: ${forbidden}`);
}
if (!check.includes('VERCEL_CONVEX_COUPLING=PASS')) throw new Error('missing repository regression gate');

console.log(`VERIFY=PASS SHA=${TARGET_SHA} PROD_ONLY_CONVEX_DEPLOY=YES`);
