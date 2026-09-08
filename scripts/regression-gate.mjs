#!/usr/bin/env node
import { readFileSync } from "node:fs";

const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const build = String(vercel.buildCommand || "");
const sync = readFileSync("scripts/sync-convex-runtime.mjs", "utf8");

const failures = [];
const requireInvariant = (ok, message) => {
  if (!ok) failures.push(message);
};

requireInvariant(
  build.includes('if [ "$VERCEL_ENV" = "production" ]') &&
    build.includes("node scripts/sync-convex-runtime.mjs") &&
    build.includes("npx convex deploy") &&
    build.includes("else npm run build; fi"),
  "Vercel build path must sync/deploy Convex only in production",
);

for (const required of [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
]) {
  requireInvariant(sync.includes(`\"${required}\"`), `sync allowlist missing ${required}`);
}
requireInvariant(
  sync.includes('"VITROS_SUPERUSER_PASSWORD_HASH"'),
  "optional superuser hash allowlist missing",
);

requireInvariant(sync.includes("spawnSync"), "sync must use a no-shell child process");
requireInvariant(sync.includes("shell: false"), "child process must explicitly disable shell execution");
requireInvariant(
  sync.includes('["convex", "env", "set", "--prod", name]'),
  "Convex env set must target production with the variable name in argv",
);
requireInvariant(sync.includes("input: value"), "secret values must be transferred via child stdin");
requireInvariant(
  sync.includes('stdio: ["pipe", "ignore", "ignore"]'),
  "Convex child output must not be relayed into build logs",
);
requireInvariant(
  sync.includes('if (env.VERCEL_ENV !== "production")'),
  "sync script itself must fail closed outside production",
);
requireInvariant(sync.includes("if (!env.CONVEX_DEPLOY_KEY)"), "deploy key must be required in production");

for (const forbidden of [
  "execSync(",
  "exec(",
  "shell: true",
  "--from-file",
  "writeFileSync",
  "mkdtemp",
  "CONVEX_DEPLOY_KEY=",
  "VITE_SUPABASE_SERVICE_ROLE_KEY",
  "VITE_OPENAI_API_KEY",
  "VITE_CONVEX_DEPLOY_KEY",
]) {
  requireInvariant(!sync.includes(forbidden), `forbidden sync pattern present: ${forbidden}`);
}

requireInvariant(
  !/console\.(?:log|error|warn)\([^\n]*(?:\bvalue\b|env\[[^\]]+\])/m.test(sync),
  "sync logging must never include environment values",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`CONVEX_RUNTIME_ENV_SYNC_STATIC=FAIL ${failure}`);
  process.exit(1);
}

console.log("CONVEX_RUNTIME_ENV_SYNC_STATIC=PASS");
console.log("PRODUCTION_ONLY=YES");
console.log("SECRET_VALUES_LOGGED=NO");
console.log("RUNTIME_READINESS=REQUIRES_DEPLOYMENT_VERIFICATION");
console.log("EXACT_HEAD_VERIFIER=EXTERNAL_EVIDENCE_REQUIRED");
