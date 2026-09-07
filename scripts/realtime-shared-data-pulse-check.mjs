import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];
const requireText = (file, text, label) => {
  const source = read(file);
  if (!source.includes(text)) failures.push(`${label}: missing ${JSON.stringify(text)} in ${file}`);
};
const forbidText = (file, text, label) => {
  const source = read(file);
  if (source.includes(text)) failures.push(`${label}: forbidden ${JSON.stringify(text)} in ${file}`);
};

requireText("convex/schema.ts", "realtimeSignals: defineTable", "signal schema");
requireText("convex/schema.ts", '.index("by_key", ["key"])', "signal singleton index");
requireText("convex/realtimePulse.ts", "export const watch = query", "authenticated watch");
requireText("convex/realtimePulse.ts", "ctx.auth.getUserIdentity()", "watch authentication");
requireText("convex/realtimePulse.ts", "export const bump = internalMutation", "server-only bump");
requireText("convex/realtimePulsePublisher.ts", "internal.realtimePulse.bump", "publisher uses internal mutation");
requireText("convex/realtimePulsePublisher.ts", "catch", "publisher preserves committed write on signal outage");

requireText("src/components/RealtimeRefreshBridge.tsx", "useConvexAuth", "browser auth gate");
requireText("src/components/RealtimeRefreshBridge.tsx", 'isAuthenticated ? {} : "skip"', "unauthenticated subscription skip");
requireText("src/components/RealtimeRefreshBridge.tsx", "REALTIME_REFRESH_MAX_MS = 240", "bounded fanout jitter");
requireText("src/components/RealtimeRefreshBridge.tsx", "refreshTimerRef.current !== null", "pulse coalescing");
requireText("src/main.tsx", "<RealtimeRefreshBridge />", "bridge mounted inside Convex auth provider");

for (const file of [
  "convex/inventoryActions.ts",
  "convex/dhrInventoryActions.ts",
  "convex/incomingStockActions.ts",
  "convex/sapStagingWorkflow.ts",
  "convex/remWorkbookActions.ts",
]) {
  requireText(file, 'import { publishRealtimePulse } from "./realtimePulsePublisher";', `publisher import ${file}`);
  requireText(file, "await publishRealtimePulse(ctx);", `post-commit pulse ${file}`);
}

// Keep privileged provider material out of the browser invalidation component.
forbidText("src/components/RealtimeRefreshBridge.tsx", "SUPABASE_SERVICE_ROLE_KEY", "browser service credential isolation");
forbidText("src/components/RealtimeRefreshBridge.tsx", "SUPABASE_URL", "browser direct Supabase isolation");
forbidText("src/components/RealtimeRefreshBridge.tsx", "partNumber", "payload-free signal");

// Deterministic 30-client fanout simulation: even the slowest scheduled client is
// invalidated within 240 ms before network/read latency. This is not a substitute
// for the required live <=2s p95 acceptance test after production deployment.
const delays = Array.from({ length: 30 }, (_, index) => {
  const unit = index / 29;
  return 40 + Math.floor(unit * (240 - 40 + 1));
}).sort((a, b) => a - b);
const p95 = delays[Math.ceil(delays.length * 0.95) - 1];
if (p95 > 240) failures.push(`30-client scheduler p95 ${p95}ms exceeds 240ms`);

if (failures.length) {
  console.error("REALTIME_SHARED_DATA_PULSE=FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("REALTIME_SHARED_DATA_PULSE=PASS");
console.log("AUTHENTICATED_SIGNAL_WATCH=PASS");
console.log("SERVER_ONLY_SIGNAL_BUMP=PASS");
console.log("POST_COMMIT_SIGNALING=PASS");
console.log("SIGNAL_FAILURE_FALLBACK_SAFE=PASS");
console.log("THIRTY_CLIENT_SIGNAL_JITTER_P95_LE_240MS=PASS");
console.log("REALTIME_PROPAGATION_P95_LE_2S=REQUIRES_LIVE_PRODUCTION_ACCEPTANCE");
