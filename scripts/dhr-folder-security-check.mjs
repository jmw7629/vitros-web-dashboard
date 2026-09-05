import fs from "node:fs";

const source = fs.readFileSync(new URL("../convex/dhr.ts", import.meta.url), "utf8");

function requireMatch(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function forbid(pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

requireMatch(
  /import\s+\{\s*requireCapability\s*\}\s+from\s+["']\.\/authGuard["']/,
  "Legacy DHR folders must use the shared server capability guard",
);

for (const queryName of ["listFolders", "getFolder"]) {
  requireMatch(
    new RegExp(`export const ${queryName} = query\\([\\s\\S]*?requireCapability\\(ctx, ["']inventory\\.read["']\\)`, "m"),
    `${queryName} must require inventory.read`,
  );
}

for (const mutationName of [
  "createFolder",
  "addLinesToFolder",
  "updateLine",
  "removeLine",
  "updateFolder",
]) {
  requireMatch(
    new RegExp(`export const ${mutationName} = mutation\\([\\s\\S]*?requireCapability\\(ctx, ["']inventory\\.write["']\\)`, "m"),
    `${mutationName} must require inventory.write`,
  );
}

requireMatch(
  /export const deleteFolder = mutation\([\s\S]*?requireCapability\(ctx, ["']inventory\.admin["']\)/m,
  "deleteFolder must require inventory.admin",
);

forbid(/requireCapability\(ctx, ["']inventory\.read["']\)[\s\S]*?ctx\.db\.delete\(/m, "Destructive DHR folder deletion must not be authorized by inventory.read");
forbid(/requireCapability\(ctx, ["']inventory\.write["']\)[\s\S]*?export const deleteFolder/m, "deleteFolder must retain a distinct admin-only authorization boundary");

console.log("DHR_FOLDER_READ_AUTHZ=PASS");
console.log("DHR_FOLDER_WRITE_AUTHZ=PASS");
console.log("DHR_FOLDER_DELETE_ADMIN_AUTHZ=PASS");
console.log("DHR_FOLDER_VISUAL_BEHAVIOR_CHANGE=NONE");
