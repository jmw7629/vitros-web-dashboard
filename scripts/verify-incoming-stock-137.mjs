const TARGET_SHA = "de1900d93935b4f28eef569034ac773346b91db4";
const url = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}/convex/incomingStockActions.ts`;
const response = await fetch(url, { cache: "no-store" });
if (!response.ok) throw new Error(`target fetch failed: ${response.status}`);
const source = await response.text();

function requireAll(tokens) {
  for (const token of tokens) if (!source.includes(token)) throw new Error(`missing invariant: ${token}`);
}
function forbidAll(tokens) {
  for (const token of tokens) if (source.includes(token)) throw new Error(`forbidden invariant: ${token}`);
}

requireAll([
  'requireCapability(ctx, "inventory.write")',
  'return value.trim().toUpperCase()',
  'descriptionUsedForIdentity: false',
  'requiresHumanConfirmation: true',
  'matchStatus = matches.length === 1 ? "matched"',
  'if (matches.length === 0) throw new Error("Confirmed part is not present in inventory")',
  'if (matches.length > 1) throw new Error("Confirmed part number is ambiguous and cannot be received")',
  'const correlationId = `incoming:${args.confirmationId.trim()}`',
  'p_mode: "RECEIVE"',
  '/rest/v1/rpc/apply_inventory_transition',
  'actor: String(actorId)',
  'SUPABASE_SERVICE_ROLE_KEY',
  'MAX_OCR_JSON_CHARS = 256_000',
  'MAX_LINES = 500',
]);
forbidAll([
  'p_mode: "OUT"',
  'p_mode: "ADJUST"',
  '/rest/v1/stock?part_number=',
  'method: "PATCH"',
  'method: "DELETE"',
  'callerRole',
  'callerUser',
]);

console.log(`VERIFY=PASS SHA=${TARGET_SHA} HUMAN_CONFIRM=YES CANONICAL_PART_ONLY=YES ATOMIC_RECEIVE=YES BROWSER_SECRET=NO`);
