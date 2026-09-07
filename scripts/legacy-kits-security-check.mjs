import fs from "node:fs";

const legacySource = fs.readFileSync(new URL("../convex/kits.ts", import.meta.url), "utf8");
const gatewaySource = fs.readFileSync(new URL("../convex/supabaseGateway.ts", import.meta.url), "utf8");
const providerSource = fs.readFileSync(new URL("../src/hooks/useConvexData.tsx", import.meta.url), "utf8");

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function forbid(source, pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

requireMatch(
  legacySource,
  /import\s+\{\s*requireCapability\s*\}\s+from\s+["']\.\/authGuard["']/,
  "Legacy kits must use the shared server capability guard",
);

requireMatch(
  legacySource,
  /export const list = query\([\s\S]*?requireCapability\(ctx, ["']inventory\.read["']\)/m,
  "Legacy kits list must require inventory.read",
);

forbid(
  legacySource,
  /export const\s+\w+\s*=\s*mutation\s*\(/,
  "Legacy kits compatibility module must remain read-only",
);

forbid(
  legacySource,
  /ctx\.db\.(insert|patch|replace|delete)\s*\(/,
  "Legacy kits compatibility module must not mutate Convex data",
);

requireMatch(
  gatewaySource,
  /export const listKits = action\([\s\S]*?requireCapability\(ctx, ["']inventory\.read["']\)[\s\S]*?["']kits\?select=id,kit_id,name,base_part_number,revision,components,active&order=name\.asc["']/m,
  "Authoritative kit reads must use the authenticated server-side Supabase gateway",
);

requireMatch(
  providerSource,
  /useAction\(api\.supabaseGateway\.listKits\)/,
  "Browser kit loading must use the authenticated server action",
);

requireMatch(
  providerSource,
  /const mappedKits = kitRows\.map\(mapKit\);/,
  "Browser kit loading must map authoritative Supabase kit rows",
);

forbid(
  providerSource,
  /["']kits:list["']/,
  "Browser must not call the legacy kits query anonymously",
);

forbid(
  providerSource,
  /["']employees:list["']/,
  "Browser must not retry the retired public employee-directory query",
);

forbid(
  providerSource,
  /SUPABASE_SERVICE_ROLE_KEY/,
  "Browser code must never receive the Supabase service-role credential",
);

console.log("LEGACY_KITS_READ_AUTHZ=PASS");
console.log("LEGACY_KITS_ANONYMOUS_READ_BYPASS=CLOSED");
console.log("LEGACY_KITS_BROWSER_COMPATIBILITY=AUTHENTICATED_SUPABASE");
console.log("LEGACY_KITS_COMPATIBILITY_SURFACE=READ_ONLY");
console.log("LEGACY_KITS_PRODUCTION_SOURCE_OF_TRUTH=SUPABASE");
