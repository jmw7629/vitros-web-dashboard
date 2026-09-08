#!/usr/bin/env node
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const env = process.env;

// Only run in production; previews must not mutate production Convex runtime
if (env.VERCEL_ENV !== "production") {
  console.log("SKIP: Not production environment");
  process.exit(0);
}

// Required server vars to sync (read from Vercel build environment)
const requiredVars = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY"];
const optionalVar = "VITROS_SUPERUSER_PASSWORD_HASH";

// Collect all vars to sync: required ones must exist, optional one is included if configured
const varsToSet = {};

for (const varName of requiredVars) {
  const value = env[varName];
  if (!value) {
    console.error(`Missing required Vercel env var: ${varName}`);
    process.exit(1);
  }
  varsToSet[varName] = value;
}

for (const varName of [optionalVar]) {
  const value = env[varName];
  if (value) {
    varsToSet[varName] = value;
  }
}

// If nothing to set, exit successfully (optional vars may be absent)
if (Object.keys(varsToSet).length === 0) {
  console.log("No approved server vars configured; sync skipped");
  process.exit(0);
}

// Create a temp .env file for convex env set --from-file
const tempPath = join(tmpdir(), `convex-env-sync-${Date.now()}.env`);
try {
  const lines = Object.entries(varsToSet)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";
  writeFileSync(tempPath, lines, { mode: 0o600 });

  // Set env vars in Convex production via stdin-derived file path
  // The values come from the Vercel build environment, not command arguments
  const deployKey = env.CONVEX_DEPLOY_KEY;
  const convexCmd = deployKey
    ? `CONVEX_DEPLOY_KEY=${deployKey} npx convex env set --from-file ${tempPath} --prod`
    : `npx convex env set --from-file ${tempPath} --prod`;

  execSync(convexCmd, { stdio: "inherit" });
} catch (err) {
  console.error("Failed to sync Convex runtime env:", err.message);
  process.exit(1);
} finally {
  // Clean up temp file immediately
  if (existsSync(tempPath)) {
    unlinkSync(tempPath);
  }
}

console.log("CONVEX_RUNTIME_ENV_SYNC=PASS");
process.exit(0);