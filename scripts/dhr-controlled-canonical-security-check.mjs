import fs from "node:fs";

const sql = fs.readFileSync(
  new URL("../supabase/migrations/20260905124500_dhr_controlled_canonical_transition.sql", import.meta.url),
  "utf8",
);

function requireMatch(pattern, message) {
  if (!pattern.test(sql)) throw new Error(message);
}

function forbid(pattern, message) {
  if (pattern.test(sql)) throw new Error(message);
}

requireMatch(
  /SELECT \* INTO v_session[\s\S]*?FROM public\.dhr_scan_sessions[\s\S]*?WHERE id = p_session_id[\s\S]*?FOR UPDATE;/m,
  "DHR consumption must lock and resolve the authoritative session before mutation",
);

requireMatch(
  /lower\(btrim\(coalesce\(v_session\.status, ''\)\)\) <> 'in_progress'/m,
  "DHR consumption must fail closed when the session is not open",
);

requireMatch(
  /FROM public\.dhr_expected_parts[\s\S]*?analyzer_model = v_session\.analyzer_model[\s\S]*?section_id = p_section_id[\s\S]*?upper\(btrim\(part_number\)\) = v_canonical_part/m,
  "DHR part identity must resolve from configured expected parts for the session model and section",
);

requireMatch(/v_expected_qty := v_expected\.bom_qty;/m, "Expected quantity must come from controlled DHR configuration");
requireMatch(/v_category := btrim\(v_expected\.category\);/m, "Category must come from controlled DHR configuration");
requireMatch(/v_description := v_expected\.description;/m, "Description must come from controlled DHR configuration");

requireMatch(
  /IF lower\(v_category\) <> 'tool' THEN[\s\S]*?public\.apply_inventory_transition\([\s\S]*?v_session\.instrument_sn,[\s\S]*?p_session_id::text/m,
  "Inventory movement must use authoritative category and the session instrument serial",
);

requireMatch(
  /INSERT INTO public\.dhr_scan_result_events\([\s\S]*?audit_id, sap_id[\s\S]*?\) VALUES \([\s\S]*?v_audit_id, v_sap_id/m,
  "Every committed DHR quantity revision must retain audit and SAP transition references",
);

requireMatch(/pg_advisory_xact_lock\(hashtextextended\('dhr-correlation\|'/m, "Correlation idempotency lock is required");
requireMatch(/pg_advisory_xact_lock\(hashtextextended\([\s\S]*?'dhr-field\|'/m, "Per-field serialization lock is required");
requireMatch(/'duplicate', true/m, "Exact correlation retries must return the immutable prior event");

requireMatch(
  /REVOKE ALL ON FUNCTION public\.apply_dhr_scan_transition\([\s\S]*?FROM PUBLIC, anon, authenticated;/m,
  "Browser roles must not execute the privileged DHR transition RPC",
);
requireMatch(
  /GRANT EXECUTE ON FUNCTION public\.apply_dhr_scan_transition\([\s\S]*?TO service_role;/m,
  "Only the trusted service boundary should execute the DHR transition RPC",
);

forbid(/VITE_[A-Z0-9_]*SERVICE/i, "No privileged browser environment variable may be introduced");

console.log("DHR_SESSION_STATE_AUTHORITY=PASS");
console.log("DHR_CONTROLLED_PART_MATCH=PASS");
console.log("DHR_BROWSER_METADATA_NONAUTHORITATIVE=PASS");
console.log("DHR_ATOMIC_INVENTORY_AUDIT_SAP_CHAIN=PASS");
console.log("DHR_IDEMPOTENCY_AND_SERIALIZATION=PASS");
console.log("DHR_RPC_LEAST_PRIVILEGE=PASS");
