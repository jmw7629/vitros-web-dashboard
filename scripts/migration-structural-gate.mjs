// Migration structural gate for 20260909_extend_inventory_operations_with_material_request.sql
// Static JS structural checker mirroring the PL/pgSQL regression validator
// (database/migrations/20260909_idempotency_material_request_regression_check.sql) but
// with NO disposable Postgres dependency, so it can run in GitHub CI.
// It inspects the NEW forward migration file textually and fails unless:
//   - requested_batch_id / requested_analyzer_serial are added AND inserted
//   - part/mode/qty/batch/analyzer mismatch checks all occur before the duplicate return
//   - batch/analyzer use IS DISTINCT FROM
//   - service-role-only grants, SECURITY DEFINER, search_path public, pg_temp
//   - stock -> audit -> pending SAP staging chain remains, no production SAP post
// This is NOT a live database concurrency test; it is a static structural gate only.
// Run with: node scripts/migration-structural-gate.mjs
// (MIGRATION_STRUCTURAL_FILE env overrides the migration path for negative testing.)

import fs from "node:fs";

const migrationPath = process.env.MIGRATION_STRUCTURAL_FILE || "database/migrations/20260909_extend_inventory_operations_with_material_request.sql";
const source = fs.readFileSync(migrationPath, "utf8");
const failures = [];

function requireToken(token, message) {
  if (!source.includes(token)) failures.push(message);
}

function requireOrder(beforeToken, afterToken, message) {
  const beforeIndex = source.indexOf(beforeToken);
  const afterIndex = source.indexOf(afterToken);
  if (beforeIndex < 0 || afterIndex < 0 || beforeIndex > afterIndex) {
    failures.push(message);
  }
}

console.log("CHECK 1: NEW_COLUMNS_ADDED_AND_INSERTED");
requireToken("add column if not exists requested_batch_id text", "requested_batch_id is not added as nullable text");
requireToken("add column if not exists requested_analyzer_serial text", "requested_analyzer_serial is not added as nullable text");
requireToken(
  "insert into public.inventory_operations(correlation_id,part_number,mode,requested_qty,requested_batch_id,requested_analyzer_serial)",
  "inventory_operations INSERT does not include requested_batch_id,requested_analyzer_serial",
);
requireToken("values (p_correlation_id,p_part_number,p_mode,p_qty,p_batch_id,p_analyzer_serial)", "new INSERT VALUES does not bind p_batch_id/p_analyzer_serial");

console.log("CHECK 2: TARGET_FUNCTION_SIGNATURE");
requireToken(
  "create or replace function public.apply_inventory_transition",
  "apply_inventory_transition forward migration body missing",
);
requireToken("p_analyzer_serial text default null", "apply_inventory_transition signature lacks p_analyzer_serial");
requireToken("p_batch_id text default null", "apply_inventory_transition signature lacks p_batch_id");

console.log("CHECK 3: MISMATCH_CHECKS_BEFORE_DUPLICATE_RETURN");
const partCheck = "upper(btrim(v_existing.part_number)) <> upper(btrim(p_part_number))";
const modeCheck = "v_existing.mode <> p_mode";
const qtyCheck = "v_existing.requested_qty <> p_qty";
const batchCheck = "v_existing.requested_batch_id is distinct from p_batch_id";
const analyzerCheck = "v_existing.requested_analyzer_serial is distinct from p_analyzer_serial";
const duplicateReturn = "return v_existing.result || jsonb_build_object('duplicate', true)";
requireToken(partCheck, "canonical part mismatch check missing");
requireToken(modeCheck, "mode mismatch check missing");
requireToken(qtyCheck, "requested quantity mismatch check missing");
requireToken(batchCheck, "requested_batch_id IS DISTINCT FROM check missing");
requireToken(analyzerCheck, "requested_analyzer_serial IS DISTINCT FROM check missing");
requireOrder("if not found then", partCheck, "part check not inside correlation-conflict branch");
requireOrder("if not found then", modeCheck, "mode check not inside correlation-conflict branch");
requireOrder("if not found then", qtyCheck, "qty check not inside correlation-conflict branch");
requireOrder("if not found then", batchCheck, "batch check not inside correlation-conflict branch");
requireOrder("if not found then", analyzerCheck, "analyzer check not inside correlation-conflict branch");
requireOrder(partCheck, duplicateReturn, "part mismatch check occurs after duplicate return");
requireOrder(modeCheck, duplicateReturn, "mode mismatch check occurs after duplicate return");
requireOrder(qtyCheck, duplicateReturn, "qty mismatch check occurs after duplicate return");
requireOrder(batchCheck, duplicateReturn, "batch mismatch check occurs after duplicate return");
requireOrder(analyzerCheck, duplicateReturn, "analyzer mismatch check occurs after duplicate return");
requireOrder(duplicateReturn, "select * into v_stock", "duplicate return not before business movement");
requireOrder(duplicateReturn, "raise exception 'Inventory operation is already in progress'", "duplicate return not before in-progress guard");

console.log("CHECK 4: IS_DISTINCT_FROM_FOR_NULLABLE_MATERIAL_FIELDS");
requireToken("v_existing.requested_batch_id is distinct from p_batch_id", "batch comparison does not use IS DISTINCT FROM");
requireToken("v_existing.requested_analyzer_serial is distinct from p_analyzer_serial", "analyzer comparison does not use IS DISTINCT FROM");

console.log("CHECK 5: SERVICE_ROLE_ONLY_GRANTS");
requireToken("revoke all on function public.apply_inventory_transition", "service-role-only REVOKE missing");
requireToken("from public, anon, authenticated;", "REVOKE does not remove public/anon/authenticated");
requireToken("grant execute on function public.apply_inventory_transition", "service_role EXECUTE grant missing");
requireToken("to service_role;", "EXECUTE grant is not limited to service_role");

console.log("CHECK 6: SECURITY_DEFINER_AND_SEARCH_PATH");
requireToken("security definer", "SECURITY DEFINER not set on apply_inventory_transition");
requireToken("set search_path = public, pg_temp", "search_path not set to public, pg_temp");

console.log("CHECK 7: STOCK_TO_AUDIT_TO_PENDING_SAP_STAGING");
requireToken("select * into v_stock from public.stock", "stock select missing from new-operation path");
requireToken("for update", "stock row lock missing from atomic movement path");
requireToken("insert into public.audit_log", "audit_log insert missing from atomic movement path");
requireToken("returning id into v_audit_id", "audit id capture missing");
requireToken("insert into public.sap_staging", "pending SAP staging insert missing from atomic movement path");
requireToken("returning id into v_sap_id", "sap staging id capture missing");
requireToken("export_status", "pending SAP staging insert lacks export_status column");
requireToken("'pending',now(),v_before,v_after,p_mode,p_correlation_id", "pending SAP staging row values incomplete");

console.log("CHECK 8: NO_PRODUCTION_SAP_POST");
for (const forbidden of ["sap_post", "POST /sap", "post to sap", "http_post", "pg_net("]) {
  if (source.includes(forbidden)) failures.push(`forbidden production SAP post token present: ${forbidden}`);
}

if (failures.length) {
  console.error("\nMigration structural gate FAILED:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("MIGRATION_STRUCTURAL_GATE=PASS");
console.log("NEW_COLUMNS_ADDED_AND_INSERTED=PASS");
console.log("MISMATCH_BEFORE_DUPLICATE_RETURN=PASS");
console.log("IS_DISTINCT_FROM=PASS");
console.log("SERVICE_ROLE_ONLY=PASS");
console.log("SECURITY_DEFINER_SEARCH_PATH=PASS");
console.log("STOCK_AUDIT_PENDING_SAP=PASS");
console.log("NO_PRODUCTION_SAP_POST=PASS");
console.log("NOTE: static structural gate, not a live database concurrency test");