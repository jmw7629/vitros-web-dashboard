import fs from "node:fs";

const source = fs.readFileSync(new URL("../convex/users.ts", import.meta.url), "utf8");

function requireMatch(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function forbid(pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

requireMatch(
  /export const updateMyProfile = mutation\([\s\S]*?getAuthUserId\(ctx\)[\s\S]*?Profile identity changes are disabled/m,
  "updateMyProfile must authenticate and fail closed",
);

requireMatch(
  /export const deleteAccount = mutation\([\s\S]*?getAuthUserId\(ctx\)[\s\S]*?Account deletion is disabled/m,
  "deleteAccount must authenticate and fail closed",
);

forbid(
  /ctx\.db\.(patch|insert|replace|delete)\s*\(/,
  "Public user lifecycle module must not mutate identity/auth records directly",
);

forbid(
  /updates\.(name|email)|updates\[["'](?:name|email)["']\]/,
  "Browser profile input must not be copied into enterprise identity fields",
);

forbid(
  /ctx\.db\.query\(["']auth(?:Accounts|Sessions)["']\)[\s\S]*?ctx\.db\.delete/m,
  "Browser account lifecycle must not delete authentication records",
);

console.log("ACCOUNT_PROFILE_IDENTITY_MUTATION=FAIL_CLOSED");
console.log("ACCOUNT_SELF_DELETE=FAIL_CLOSED");
console.log("ACCOUNT_BROWSER_AUTH_RECORD_DELETE=NONE");
console.log("ACCOUNT_ENTERPRISE_IDENTITY_AUTHORITY=SERVER_MANAGED");
