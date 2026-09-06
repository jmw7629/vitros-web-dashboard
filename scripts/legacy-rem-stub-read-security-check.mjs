import fs from "node:fs";

const modules = [
  ["remBuildPlan.ts", "list"],
  ["remTracker.ts", "listWeekly"],
];

for (const [file, exportName] of modules) {
  const source = fs.readFileSync(new URL(`../convex/${file}`, import.meta.url), "utf8");
  if (!/import\s+\{\s*requireCapability\s*\}\s+from\s+["']\.\/authGuard["']/.test(source)) {
    throw new Error(`${file} must use the shared server capability guard`);
  }
  const escapedExport = exportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const queryBoundary = new RegExp(
    `export const ${escapedExport} = query\\([\\s\\S]*?requireCapability\\(ctx, ["']rem\\.read["']\\)`,
    "m",
  );
  if (!queryBoundary.test(source)) {
    throw new Error(`${file}.${exportName} must require rem.read`);
  }
  if (/export const\s+\w+\s*=\s*mutation\s*\(/.test(source)) {
    throw new Error(`${file} must remain read-only`);
  }
  if (/ctx\.db\.(insert|patch|replace|delete)\s*\(/.test(source)) {
    throw new Error(`${file} must not mutate legacy REM data`);
  }
}

console.log("LEGACY_REM_STUB_READ_AUTHZ=PASS");
console.log("LEGACY_REM_STUB_ANONYMOUS_READ_BYPASS=CLOSED");
console.log("LEGACY_REM_STUB_MODULES=READ_ONLY");
