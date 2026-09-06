import fs from "node:fs";

const migrationPath = new URL("../supabase/migrations/20260906131500_dhr_controlled_inventory_alias.sql", import.meta.url);
const sql = fs.readFileSync(migrationPath, "utf8");

function requireMatch(pattern, message) {
  if (!pattern.test(sql)) throw new Error(message);
}

function forbid(pattern, message) {
  if (pattern.test(sql)) throw new Error(message);
}

requireMatch(/ADD COLUMN IF NOT EXISTS inventory_part_number text/i,
  "DHR expected parts must own an explicit inventory cross-reference");
requireMatch(/inventory_part_number IS NULL OR btrim\(inventory_part_number\) <> ''/i,
  "Inventory cross-reference must reject blank configured values");
requireMatch(/analyzer_model = '5600'[\s\S]*section_id = '5\.15'[\s\S]*upper\(btrim\(part_number\)\) = 'J61239'/i,
  "Known controlled DHR mismatch must be guarded by exact model/section/part identity");
requireMatch(/upper\(btrim\(part_number\)\) = 'J61239P'/i,
  "Known stock-side alias must be explicitly verified before seeding");
requireMatch(/v_inventory_canonical_part := upper\(btrim\(coalesce\(nullif\(v_expected\.inventory_part_number, ''\), v_expected\.part_number\)\)\)/i,
  "Atomic DHR transition must derive inventory identity from server-owned configuration");
requireMatch(/FROM public\.stock[\s\S]*WHERE upper\(btrim\(part_number\)\) = v_inventory_canonical_part/i,
  "Stock match must use the server-owned inventory identity");
requireMatch(/p_session_id, p_section_id, btrim\(v_expected\.part_number\)/i,
  "DHR result identity must remain the controlled-form part number");
requireMatch(/public\.apply_inventory_transition\([\s\S]*v_stock\.part_number/i,
  "Inventory transition must receive the resolved canonical stock row part number");
requireMatch(/REVOKE ALL ON FUNCTION public\.apply_dhr_scan_transition\([\s\S]*FROM PUBLIC, anon, authenticated/i,
  "Atomic DHR RPC must remain inaccessible to browser roles");
requireMatch(/GRANT EXECUTE ON FUNCTION public\.apply_dhr_scan_transition\([\s\S]*TO service_role/i,
  "Atomic DHR RPC must remain service-role only");

forbid(/p_inventory_part|args\.inventoryPart/i,
  "Browser callers must not be able to supply or override the inventory alias");
forbid(/UPDATE public\.stock|INSERT INTO public\.stock|DELETE FROM public\.stock/i,
  "Alias migration must not directly mutate inventory business rows");

console.log("DHR_CONTROLLED_IDENTITY_PRESERVED=PASS");
console.log("DHR_SERVER_OWNED_INVENTORY_ALIAS=PASS");
console.log("DHR_KNOWN_ALIAS_SEED_GUARDED=PASS");
console.log("DHR_ATOMIC_INVENTORY_PATH_PRESERVED=PASS");
console.log("DHR_RPC_LEAST_PRIVILEGE=PASS");
