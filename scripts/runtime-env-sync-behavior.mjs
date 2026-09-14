import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("./sync-convex-runtime.mjs", import.meta.url), "utf8")
  .replace(/^#!.*\n/, "").replace('import { spawnSync } from "node:child_process";', "");
const base = { VERCEL_ENV: "production", CONVEX_DEPLOY_KEY: "synthetic-deploy", SUPABASE_URL: "synthetic-url", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", OPENAI_API_KEY: "synthetic-api" };
function run(env, result = { status: 0 }) {
  const calls = [], logs = []; let exit = 0;
  try {
    vm.runInNewContext(source, {
      process: { env, platform: "linux", exit(code) { throw { code }; } },
      console: { log(...a) { logs.push(a.join(" ")); }, error(...a) { logs.push(a.join(" ")); } },
      spawnSync(...args) { calls.push(args); return result; },
    });
  } catch (e) { if (typeof e?.code !== "number") throw e; exit = e.code; }
  return { calls, logs: logs.join("\n"), exit };
}
const preview = run({ ...base, VERCEL_ENV: "preview" });
assert.equal(preview.exit, 0); assert.equal(preview.calls.length, 0);
for (const name of ["CONVEX_DEPLOY_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY"]) {
  const env = { ...base }; delete env[name]; const r = run(env);
  assert.equal(r.exit, 1); assert.equal(r.calls.length, 0);
}
const production = run({ ...base, VITROS_SUPERUSER_PASSWORD_HASH: "synthetic-stale-hash" });
assert.equal(production.exit, 0);
assert.deepEqual(production.calls.map(c => c[1].at(-1)), ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY"]);
for (const [, argv, options] of production.calls) {
  assert.equal(argv.includes(options.input), false);
  assert.equal(options.shell, false);
  assert.equal(options.stdio.join(","), "pipe,ignore,ignore");
}
assert.equal(production.logs.includes("synthetic-"), false);
const failed = run(base, { status: 2, stdout: "synthetic-sensitive-output", stderr: "synthetic-sensitive-output" });
assert.equal(failed.exit, 1); assert.equal(failed.calls.length, 1);
assert.equal(failed.logs.includes("synthetic-"), false);
console.log("Runtime environment sync: production-only allowlist, fail-closed configuration, private stdin, and Convex credential ownership PASS");
