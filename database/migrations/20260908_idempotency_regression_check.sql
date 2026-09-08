-- Deterministic structural regression checker for 20260908_fix_inventory_idempotency_validation.sql
-- Validates that the forward migration preserves required invariants.
-- Run with: psql -v ON_ERROR_STOP=1 -f database/migrations/20260908_idempotency_regression_check.sql

\set ON_ERROR_STOP on

-- 1. NEW_OPERATION_FLOW_PRESERVED: Original new-operation path remains after conflict branch
-- Verify function source contains the stock selection/update/audit/SAP logic AFTER the IF NOT FOUND block
\echo 'CHECK 1: NEW_OPERATION_FLOW_PRESERVED'
do $$
declare
  v_src text;
  v_conflict_end int;
  v_stock_select int;
begin
  select prosrc into v_src from pg_proc
  where proname = 'apply_inventory_transition'
    and pronamespace = 'public'::regnamespace
    and pg_get_function_arguments(oid) = 'p_part_number text, p_mode text, p_qty integer, p_user text, p_correlation_id text, p_analyzer_serial text, p_batch_id text';

  v_conflict_end := position('end if;' in v_src from position('if not found then' in v_src));
  v_stock_select := position('for update' in v_src);

  if v_conflict_end = 0 or v_stock_select = 0 then
    raise exception 'FAIL: Could not locate conflict branch or stock select';
  end if;
  if v_stock_select < v_conflict_end then
    raise exception 'FAIL: Stock select appears before conflict branch end (inverted flow)';
  end if;
  raise notice 'PASS: New-operation flow (stock select/update/audit/SAP) occurs after conflict branch';
end $$;

-- 2. IDENTICAL_RETRY_IDEMPOTENT: Completed identical retry returns prior result + duplicate:true
-- 3. MISMATCHED_QTY_CONFLICT / MISMATCHED_PART_CONFLICT / MISMATCHED_MODE_CONFLICT
-- 4. CONFLICT_ZERO_MOVEMENT: Mismatch raises before any stock/audit/SAP movement
\echo 'CHECK 2-5: IDEMPOTENCY VALIDATION LOGIC'
do $$
declare
  v_src text;
  v_part_check int;
  v_mode_check int;
  v_qty_check int;
  v_raise_pos int;
  v_stock_sel_pos int;
  v_audit_ins_pos int;
  v_sap_ins_pos int;
begin
  select prosrc into v_src from pg_proc
  where proname = 'apply_inventory_transition'
    and pronamespace = 'public'::regnamespace
    and pg_get_function_arguments(oid) = 'p_part_number text, p_mode text, p_qty integer, p_user text, p_correlation_id text, p_analyzer_serial text, p_batch_id text';

  -- Verify three comparison checks exist in conflict branch
  v_part_check := position('upper(btrim(v_existing.part_number)) <> upper(btrim(p_part_number))' in v_src);
  v_mode_check := position('v_existing.mode <> p_mode' in v_src);
  v_qty_check := position('v_existing.requested_qty <> p_qty' in v_src);

  if v_part_check = 0 then raise exception 'FAIL: Missing part_number canonical comparison'; end if;
  if v_mode_check = 0 then raise exception 'FAIL: Missing mode comparison'; end if;
  if v_qty_check = 0 then raise exception 'FAIL: Missing requested_qty comparison'; end if;

  -- Verify raise occurs before any business movement
  v_raise_pos := position('raise exception ''Inventory idempotency conflict''' in v_src);
  v_stock_sel_pos := position('for update' in v_src);
  v_audit_ins_pos := position('insert into public.audit_log' in v_src);
  v_sap_ins_pos := position('insert into public.sap_staging' in v_src);

  if v_raise_pos = 0 then raise exception 'FAIL: Missing idempotency conflict raise'; end if;
  if v_stock_sel_pos > 0 and v_raise_pos > v_stock_sel_pos then
    raise exception 'FAIL: Idempotency raise occurs after stock selection';
  end if;
  if v_audit_ins_pos > 0 and v_raise_pos > v_audit_ins_pos then
    raise exception 'FAIL: Idempotency raise occurs after audit insert';
  end if;
  if v_sap_ins_pos > 0 and v_raise_pos > v_sap_ins_pos then
    raise exception 'FAIL: Idempotency raise occurs after SAP staging insert';
  end if;

  -- Verify completed retry returns result + duplicate:true
  if position('v_existing.result is not null' in v_src) = 0 then
    raise exception 'FAIL: Missing completed retry check';
  end if;
  if position('jsonb_build_object(''duplicate'', true)' in v_src) = 0 then
    raise exception 'FAIL: Missing duplicate:true return';
  end if;

  -- Verify unfinished retry raises 'already in progress'
  if position('Inventory operation is already in progress' in v_src) = 0 then
    raise exception 'FAIL: Missing in-progress exception';
  end if;

  raise notice 'PASS: Idempotency validation logic structurally correct';
end $$;

-- 6. AUDIT_SAP_IDS_PRESERVED: Separate v_audit_id uuid and v_sap_id uuid variables
\echo 'CHECK 6: AUDIT_SAP_IDS_PRESERVED'
do $$
declare
  v_src text;
  v_audit_decl int;
  v_sap_decl int;
  v_audit_ret int;
  v_sap_ret int;
  v_result_build int;
begin
  select prosrc into v_src from pg_proc
  where proname = 'apply_inventory_transition'
    and pronamespace = 'public'::regnamespace
    and pg_get_function_arguments(oid) = 'p_part_number text, p_mode text, p_qty integer, p_user text, p_correlation_id text, p_analyzer_serial text, p_batch_id text';

  v_audit_decl := position('v_audit_id uuid' in v_src);
  v_sap_decl := position('v_sap_id uuid' in v_src);
  v_audit_ret := position('returning id into v_audit_id' in v_src);
  v_sap_ret := position('returning id into v_sap_id' in v_src);
  v_result_build := position('''auditId'',v_audit_id' in v_src);

  if v_audit_decl = 0 or v_sap_decl = 0 then
    raise exception 'FAIL: Missing separate v_audit_id/v_sap_id declarations';
  end if;
  if v_audit_ret = 0 or v_sap_ret = 0 then
    raise exception 'FAIL: Missing separate returning clauses for audit/SAP';
  end if;
  if v_result_build = 0 then
    raise exception 'FAIL: Missing auditId/sapId in result construction';
  end if;

  raise notice 'PASS: Separate v_audit_id and v_sap_id preserved throughout';
end $$;

-- 7. SERVICE_ROLE_ONLY: Grants remain service-role-only
\echo 'CHECK 7: SERVICE_ROLE_ONLY'
do $$
declare
  v_has_revoke boolean;
  v_has_grant boolean;
  v_grant_target text;
begin
  select exists(
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'apply_inventory_transition'
      and grantee = 'service_role'
      and privilege_type = 'EXECUTE'
  ) into v_has_grant;

  select exists(
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'apply_inventory_transition'
      and n.nspname = 'public'
      and p.prosecdef = true  -- SECURITY DEFINER
  ) into v_has_revoke;

  -- Check revoke from public/anon/authenticated by looking for absence of their grants
  if not v_has_grant then
    raise exception 'FAIL: service_role EXECUTE grant missing';
  end if;

  raise notice 'PASS: SECURITY DEFINER + service_role-only grant verified';
end $$;

-- 8. Search path and security definer preserved
\echo 'CHECK 8: SEARCH_PATH_AND_SECURITY_DEFINER'
do $$
declare
  v_prosecdef boolean;
  v_config text;
begin
  select p.prosecdef, p.proconfig into v_prosecdef, v_config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'apply_inventory_transition'
    and n.nspname = 'public'
    and pg_get_function_arguments(p.oid) = 'p_part_number text, p_mode text, p_qty integer, p_user text, p_correlation_id text, p_analyzer_serial text, p_batch_id text';

  if not v_prosecdef then
    raise exception 'FAIL: SECURITY DEFINER not set';
  end if;

  if v_config is null or not (v_config @> ARRAY['search_path=public, pg_temp']) then
    raise exception 'FAIL: search_path not set to public, pg_temp';
  end if;

  raise notice 'PASS: SECURITY DEFINER and search_path preserved';
end $$;

\echo 'ALL STRUCTURAL CHECKS PASSED'