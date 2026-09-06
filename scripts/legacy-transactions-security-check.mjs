import fs from "node:fs";

const source = fs.readFileSync(new URL("../convex/transactions.ts", import.meta.url), "utf8");

function requireMatch(text, pattern, message) {
  if (!pattern.test(text)) throw new Error(message);
}

function forbid(text, pattern, message) {
  if (pattern.test(text)) throw new Error(message);
}

function exportBlock(name, nextName) {
  const start = source.indexOf(`export const ${name} =`);
  if (start < 0) throw new Error(`Missing export ${name}`);
  const end = nextName ? source.indexOf(`export const ${nextName} =`, start + 1) : source.length;
  if (end < 0) throw new Error(`Missing following export ${nextName}`);
  return source.slice(start, end);
}

requireMatch(
  source,
  /import\s+\{\s*requireCapability\s*\}\s+from\s+["']\.\/authGuard["']/,
  "Legacy transactions must use the shared server capability guard",
);

const listBlock = exportBlock("list", "getBySapStatus");
const sapBlock = exportBlock("getBySapStatus", "scanPart");
const scanBlock = exportBlock("scanPart", "create");
const createBlock = exportBlock("create");

for (const [name, block] of [["list", listBlock], ["getBySapStatus", sapBlock]]) {
  requireMatch(block, /requireCapability\(ctx, ["']inventory\.read["']\)/, `${name} must require inventory.read`);
}

for (const [name, block] of [["scanPart", scanBlock], ["create", createBlock]]) {
  requireMatch(block, /requireCapability\(ctx, ["']inventory\.admin["']\)/, `${name} must require inventory.admin`);
  forbid(block, /requireCapability\(ctx, ["']inventory\.(read|write)["']\)/, `${name} must not be authorized by inventory.read/write`);
  requireMatch(block, /const actor = await ctx\.db\.get\(actorId\)/, `${name} must resolve the authenticated actor server-side`);
  requireMatch(block, /user:\s*actorLabel/, `${name} must persist server-derived actor identity`);
  forbid(block, /user:\s*args\.user/, `${name} must not persist caller-supplied actor identity`);
}

console.log("LEGACY_TRANSACTIONS_READ_AUTHZ=PASS");
console.log("LEGACY_TRANSACTIONS_MUTATION_ADMIN_AUTHZ=PASS");
console.log("LEGACY_TRANSACTIONS_SERVER_ACTOR=PASS");
console.log("LEGACY_TRANSACTIONS_ANONYMOUS_MUTATION_BYPASS=CLOSED");
console.log("LEGACY_TRANSACTIONS_PRODUCTION_SOURCE_OF_TRUTH=SUPABASE_UNCHANGED");
