#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const { env } = process;

if (env.VERCEL_ENV !== "production") {
  console.log("CONVEX_RUNTIME_ENV_SYNC=SKIPPED_NON_PRODUCTION");
  process.exit(0);
}

const requiredNames = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
];
const optionalNames = ["VITROS_SUPERUSER_PASSWORD_HASH"];

if (!env.CONVEX_DEPLOY_KEY) {
  console.error("CONVEX_RUNTIME_ENV_SYNC=FAIL missing CONVEX_DEPLOY_KEY");
  process.exit(1);
}

const values = new Map();
for (const name of requiredNames) {
  const value = env[name];
  if (!value) {
    console.error(`CONVEX_RUNTIME_ENV_SYNC=FAIL missing ${name}`);
    process.exit(1);
  }
  values.set(name, value);
}
for (const name of optionalNames) {
  const value = env[name];
  if (value) values.set(name, value);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
for (const [name, value] of values) {
  const result = spawnSync(npx, ["convex", "env", "set", "--prod", name], {
    input: value,
    encoding: "utf8",
    env,
    shell: false,
    stdio: ["pipe", "ignore", "ignore"],
  });

  if (result.error || result.status !== 0) {
    const status = result.status ?? "spawn-error";
    console.error(`CONVEX_RUNTIME_ENV_SYNC=FAIL variable=${name} status=${status}`);
    process.exit(1);
  }
}

console.log(`CONVEX_RUNTIME_ENV_SYNC=PASS variables=${values.size}`);
