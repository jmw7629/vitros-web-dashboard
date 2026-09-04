const TARGET_SHA = "8dc570bb86b28fb8a71ecf4c865a5e28446b6ac8";
const ROOT = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}`;
async function get(path){const r=await fetch(`${ROOT}/${path}`,{cache:"no-store"});if(!r.ok)throw new Error(`${path}:${r.status}`);return r.text();}
const [raw,check]=await Promise.all([get("vercel.json"),get("scripts/vercel-convex-coupling-check.mjs")]);
const cmd=String(JSON.parse(raw).buildCommand||"");
for(const t of ['if [ "$VERCEL_ENV" = "production" ]','npx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd \'npm run build\'','else npm run build']) if(!cmd.includes(t)) throw new Error(`missing:${t}`);
for(const t of ['CONVEX_DEPLOY_KEY=','SUPABASE_SERVICE_ROLE_KEY=','OPENAI_API_KEY=','VITE_CONVEX_DEPLOY_KEY']) if(cmd.includes(t)) throw new Error(`secret:${t}`);
if(!check.includes('VERCEL_CONVEX_COUPLING=PASS')) throw new Error('missing regression gate');
console.log(`VERIFY=PASS SHA=${TARGET_SHA}`);
