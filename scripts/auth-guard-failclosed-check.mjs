import fs from "node:fs";

const source = fs.readFileSync(new URL("../convex/authGuard.ts", import.meta.url), "utf8");

const required = [
  "const caps = ROLE_CAPABILITIES[role];",
  "if (!caps || !caps.includes(capability))",
  "await requireAuth(ctx)",
];

for (const fragment of required) {
  if (!source.includes(fragment)) {
    throw new Error(`Auth guard regression: missing required fail-closed fragment: ${fragment}`);
  }
}

const forbidden = [
  "ROLE_CAPABILITIES[role] ?? ROLE_CAPABILITIES.viewer",
  "ROLE_CAPABILITIES[role] || ROLE_CAPABILITIES.viewer",
  "ROLE_CAPABILITIES[role] ?? ROLE_CAPABILITIES[\"viewer\"]",
  "ROLE_CAPABILITIES[role] || ROLE_CAPABILITIES[\"viewer\"]",
];

for (const fragment of forbidden) {
  if (source.includes(fragment)) {
    throw new Error(`Auth guard regression: unknown roles must not inherit viewer capabilities: ${fragment}`);
  }
}

console.log("AUTH_GUARD_UNKNOWN_ROLE_FAIL_CLOSED=PASS");
