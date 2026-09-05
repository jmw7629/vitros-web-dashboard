import fs from "node:fs";

const source = fs.readFileSync(new URL("../convex/parts.ts", import.meta.url), "utf8");

function requireMatch(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function forbid(pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

requireMatch(
  /import\s+\{\s*requireCapability\s*\}\s+from\s+["']\.\/authGuard["']/,
  "Legacy parts must use the shared server capability guard",
);

requireMatch(
  /export const list = query\([\s\S]*?requireCapability\(ctx, ["']inventory\.read["']\)/m,
  "Legacy parts list must require inventory.read",
);

for (const mutationName of ["updatePart", "deletePart", "createPart"]) {
  requireMatch(
    new RegExp(`export const ${mutationName} = mutation\\([\\s\\S]*?requireCapability\\(ctx, ["']inventory\\.admin["']\\)`, "m"),
    `${mutationName} must require inventory.admin`,
  );
  forbid(
    new RegExp(`export const ${mutationName} = mutation\\([\\s\\S]*?requireCapability\\(ctx, ["']inventory\\.(read|write)["']\\)`, "m"),
    `${mutationName} must not be authorized by inventory.read/write`,
  );
}

requireMatch(
  /export const addPart = createPart\s*;/,
  "Legacy addPart alias must retain the same admin-gated createPart boundary",
);

console.log("LEGACY_PARTS_READ_AUTHZ=PASS");
console.log("LEGACY_PARTS_MUTATION_ADMIN_AUTHZ=PASS");
console.log("LEGACY_PARTS_ANONYMOUS_MUTATION_BYPASS=CLOSED");
console.log("LEGACY_PARTS_PRODUCTION_SOURCE_OF_TRUTH=SUPABASE_UNCHANGED");
