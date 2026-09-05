import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/hooks/useRole.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /function normalizeServerRole\(role: unknown\): AuthenticatedRole/,
  "server role must cross an explicit unknown-to-allowlist normalization boundary",
);
for (const role of ["superuser", "engineer", "viewer"]) {
  assert.match(
    source,
    new RegExp(`role === ["']${role}["']`),
    `known role ${role} must remain explicitly allowlisted`,
  );
}
assert.match(
  source,
  /return ["']viewer["'];/,
  "unknown authenticated roles must fail closed to viewer presentation",
);
assert.match(
  source,
  /normalizeServerRole\(user\.role\)/,
  "effective UI role must be derived from the server-authenticated user through the allowlist",
);
assert.doesNotMatch(
  source,
  /user\?\.role\s+as\s+Role/,
  "unchecked type assertions must not turn arbitrary stored role strings into UI authority",
);
assert.doesNotMatch(
  source,
  /localStorage\.getItem\(["']vitros-role["']\)/,
  "browser role hints must never be read as effective role authority",
);
assert.match(
  source,
  /saved === ["']rem["'] \? ["']rem["'] : ["']inventory["']/,
  "persisted tab state must also be constrained to the supported presentation values",
);

console.log("UI role fail-closed security check passed");
