import fs from "node:fs";

const source = fs.readFileSync(new URL("../convex/kits.ts", import.meta.url), "utf8");

function requireMatch(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function forbid(pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

requireMatch(
  /import\s+\{\s*requireCapability\s*\}\s+from\s+["']\.\/authGuard["']/,
  "Legacy kits must use the shared server capability guard",
);

requireMatch(
  /export const list = query\([\s\S]*?requireCapability\(ctx, ["']inventory\.read["']\)/m,
  "Legacy kits list must require inventory.read",
);

forbid(
  /export const\s+\w+\s*=\s*mutation\s*\(/,
  "Legacy kits compatibility module must remain read-only",
);

forbid(
  /ctx\.db\.(insert|patch|replace|delete)\s*\(/,
  "Legacy kits compatibility module must not mutate Convex data",
);

console.log("LEGACY_KITS_READ_AUTHZ=PASS");
console.log("LEGACY_KITS_ANONYMOUS_READ_BYPASS=CLOSED");
console.log("LEGACY_KITS_COMPATIBILITY_SURFACE=READ_ONLY");
console.log("LEGACY_KITS_PRODUCTION_SOURCE_OF_TRUTH=UNCHANGED");
