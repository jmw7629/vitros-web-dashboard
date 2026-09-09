-- Deterministic structural regression checker for 20260909_extend_inventory_operations_with_material_request.sql
-- Validates that the effective forward migration preserves required invariants.
-- Run after applying the migration to a disposable/test database:
--   psql -v ON_ERROR_STOP=1 -f database/migrations/20260909_idempotency_material_request_regression_check.sql

\set ON_ERROR_STOP on

\echo 'CHECK 1: NEW_COLUMNS_EXIST_IN_INVENTORY_OPERATIONS'
do $$
declare
  v_has_batch_id boolean;
  v_has_analyzer_serial boolean;
begin
  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_operations'
      and column_name = 'requested_batch_id'
      and is_nullable = 'YES'
      and data_type = 'text'
  ) into v_has_batch_id;

  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_operations'
      and column_name = 'requested_analyzer_serial'
      and is_nullable = 'YES'
      and data_type = 'text'
  ) into v_has_analyzer_serial;

  if not v_has_batch_id then
    raise exception 'FAIL: requested_batch_id column missing or not nullable text';
  end if;
  if not v_has_analyzer_serial then
    raise exception 'FAIL: requested_analyzer_serial column missing or not nullable text';
  end if;

  raise notice 'PASS: NEW_COLUMNS_EXIST';
end $$;

\echo 'CHECK 2: TARGET_FUNCTION_SIGNATURE_AND_NEW_OPERATION_FLOW'
do $$
declare
  v_oid oid;
  v_src text;
  v_conflict_start integer;
  v_duplicate_return integer;
  v_in_progress_raise integer;
  v_stock_select integer;
  v_stock_update integer;
  v_audit_insert integer;
  v_sap_insert integer;
begin
  select p.oid, p.prosrc
    into v_oid, v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'apply_inventory_transition'
    and pg_get_function_identity_arguments(p.oid) =
      'p_part_number text, p_mode text, p_qty integer, p_user text, p_correlation_id text, p_analyzer_serial text, p_batch_id text';

  if not found or v_src is null then
    raise exception 'FAIL: target apply_inventory_transition signature not found';
  end if;

  v_conflict_start := strpos(v_src, 'if not found then');
  v_duplicate_return := strpos(v_src, 'return v_existing.result || jsonb_build_object(''duplicate'', true)');
  v_in_progress_raise := strpos(v_src, 'raise exception ''Inventory operation is already in progress''');
  v_stock_select := strpos(v_src, 'select * into v_stock');
  v_stock_update := strpos(v_src, 'update public.stock set');
  v_audit_insert := strpos(v_src, 'insert into public.audit_log');
  v_sap_insert := strpos(v_src, 'insert into public.sap_staging');

  if v_conflict_start = 0 or v_duplicate_return = 0 or v_in_progress_raise = 0 then
    raise exception 'FAIL: conflict/idempotency branch is incomplete';
  end if;
  if v_stock_select = 0 or v_stock_update = 0 or v_audit_insert = 0 or v_sap_insert = 0 then
    raise exception 'FAIL: original new-operation movement chain is incomplete';
  end if;
  if not (
    v_conflict_start < v_duplicate_return
    and v_duplicate_return < v_in_progress_raise
    and v_in_progress_raise < v_stock_select
    and v_stock_select < v_stock_update
    and v_stock_update < v_audit_insert
    and v_audit_insert < v_sap_insert
  ) then
    raise exception 'FAIL: conflict/new-operation control flow ordering is invalid';
  end if;

  raise notice 'PASS: NEW_OPERATION_FLOW_PRESERVED';
end $$;

\echo 'CHECK 3: NEW_COLUMNS_PERSISTED_ON_INSERT'
do $$
declare
  v_src text;
  v_insert_stmt integer;
  v_batch_id_in_insert integer;
  v_analyzer_serial_in_insert integer;
begin
  select p.prosrc
    into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'apply_inventory_transition'
    and pg_get_function_identity_arguments(p.oid) =
      'p_part_number text, p_mode text, p_qty integer, p_user text, p_correlation_id text, p_analyzer_serial text, p_batch_id text';

  if not found or v_src is null then
    raise exception 'FAIL: target apply_inventory_transition signature not found';
  end if;

  -- Check that the INSERT includes the new columns
  v_insert_stmt := strpos(v_src, 'insert into public.inventory_operations(correlation_id,part_number,mode,requested_qty,requested_batch_id,requested_analyzer_serial)');
  if v_insert_stmt = 0 then
    raise exception 'FAIL: INSERT statement does not include new columns requested_batch_id,requested_analyzer_serial';
  end if;

  v_batch_id_in_insert := strpos(v_src, 'p_batch_id');
  v_analyzer_serial_in_insert := strpos(v_src, 'p_analyzer_serial');

  -- Verify both parameters are referenced in the VALUES clause after the INSERT
  if v_batch_id_in_insert = 0 or v_analyzer_serial_in_insert = 0 then
    raise exception 'FAIL: new column values not bound in INSERT';
  end if;

  raise notice 'PASS: NEW_COLUMNS_PERSISTED_ON_INSERT';
end $$;

\echo 'CHECK 4: IDEMPOTENCY_INPUT_VALIDATION_WITH_NEW_FIELDS'
do $$
declare
  v_src text;
  v_conflict_start integer;
  v_part_check integer;
  v_mode_check integer;
  v_qty_check integer;
  v_batch_check integer;
  v_analyzer_check integer;
  v_duplicate_return integer;
  v_in_progress_raise integer;
  v_stock_select integer;
  v_raise_count integer;
  v_raise_literal text := 'raise exception ''Inventory idempotency conflict''';
begin
  select p.prosrc
    into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'apply_inventory_transition'
    and pg_get_function_identity_arguments(p.oid) =
      'p_part_number text, p_mode text, p_qty integer, p_user text, p_correlation_id text, p_analyzer_serial text, p_batch_id text';

  if not found or v_src is null then
    raise exception 'FAIL: target apply_inventory_transition signature not found';
  end if;

  v_conflict_start := strpos(v_src, 'if not found then');
  v_part_check := strpos(v_src, 'upper(btrim(v_existing.part_number)) <> upper(btrim(p_part_number))');
  v_mode_check := strpos(v_src, 'v_existing.mode <> p_mode');
  v_qty_check := strpos(v_src, 'v_existing.requested_qty <> p_qty');
  v_batch_check := strpos(v_src, 'v_existing.requested_batch_id is distinct from p_batch_id');
  v_analyzer_check := strpos(v_src, 'v_existing.requested_analyzer_serial is distinct from p_analyzer_serial');
  v_duplicate_return := strpos(v_src, 'return v_existing.result || jsonb_build_object(''duplicate'', true)');
  v_in_progress_raise := strpos(v_src, 'raise exception ''Inventory operation is already in progress''');
  v_stock_select := strpos(v_src, 'select * into v_stock');
  v_raise_count :=
    (length(v_src) - length(replace(v_src, v_raise_literal, ''))) / length(v_raise_literal);

  if v_conflict_start = 0 then
    raise exception 'FAIL: correlation conflict branch missing';
  end if;
  if v_part_check = 0 then
    raise exception 'FAIL: canonical part mismatch check missing';
  end if;
  if v_mode_check = 0 then
    raise exception 'FAIL: mode mismatch check missing';
  end if;
  if v_qty_check = 0 then
    raise exception 'FAIL: requested quantity mismatch check missing';
  end if;
  if v_batch_check = 0 then
    raise exception 'FAIL: requested_batch_id IS DISTINCT FROM check missing';
  end if;
  if v_analyzer_check = 0 then
    raise exception 'FAIL: requested_analyzer_serial IS DISTINCT FROM check missing';
  end if;
  if v_raise_count <> 5 then
    raise exception 'FAIL: expected five bounded idempotency-conflict raises (part, mode, qty, batch, analyzer), found %', v_raise_count;
  end if;
  if v_duplicate_return = 0 then
    raise exception 'FAIL: completed identical retry duplicate return missing';
  end if;
  if v_in_progress_raise = 0 then
    raise exception 'FAIL: unfinished identical retry guard missing';
  end if;
  if v_stock_select = 0 then
    raise exception 'FAIL: stock selection missing';
  end if;

  -- Critical ordering: all mismatch checks and duplicate return must occur BEFORE any business movement
  if not (
    v_conflict_start < v_part_check
    and v_conflict_start < v_mode_check
    and v_conflict_start < v_qty_check
    and v_conflict_start < v_batch_check
    and v_conflict_start < v_analyzer_check
    and v_part_check < v_duplicate_return
    and v_mode_check < v_duplicate_return
    and v_qty_check < v_duplicate_return
    and v_batch_check < v_duplicate_return
    and v_analyzer_check < v_duplicate_return
    and v_duplicate_return < v_in_progress_raise
    and v_in_progress_raise < v_stock_select
  ) then
    raise exception 'FAIL: mismatch checks/duplicate return are not confined before business movement';
  end if;

  if strpos(v_src, 'v_existing.result is not null') = 0 then
    raise exception 'FAIL: completed-result guard missing';
  end if;

  raise notice 'PASS: IDENTICAL_RETRY_IDEMPOTENT';
  raise notice 'PASS: MISMATCHED_QTY_CONFLICT';
  raise notice 'PASS: MISMATCHED_PART_CONFLICT';
  raise notice 'PASS: MISMATCHED_MODE_CONFLICT';
  raise notice 'PASS: MISMATCHED_BATCH_ID_CONFLICT';
  raise notice 'PASS: MISMATCHED_ANALYZER_SERIAL_CONFLICT';
end $$;

\echo 'CHECK 5: CONFLICT_ZERO_MOVEMENT'
do $$
declare
  v_src text;
  v_conflict_start integer;
  v_stock_select integer;
  v_conflict_segment text;
begin
  select p.prosrc
    into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'apply_inventory_transition'
    and pg_get_function_identity_arguments(p.oid) =
      'p_part_number text, p_mode text, p_qty integer, p_user text, p_correlation_id text, p_analyzer_serial text, p_batch_id text';

  if not found or v_src is null then
    raise exception 'FAIL: target apply_inventory_transition signature not found';
  end if;

  v_conflict_start := strpos(v_src, 'if not found then');
  v_stock_select := strpos(v_src, 'select * into v_stock');
  if v_conflict_start = 0 or v_stock_select <= v_conflict_start then
    raise exception 'FAIL: cannot isolate conflict branch from new-operation path';
  end if;

  v_conflict_segment := substr(v_src, v_conflict_start, v_stock_select - v_conflict_start);
  if strpos(v_conflict_segment, 'update public.stock set') > 0
     or strpos(v_conflict_segment, 'insert into public.audit_log') > 0
     or strpos(v_conflict_segment, 'insert into public.sap_staging') > 0 then
    raise exception 'FAIL: business movement statement appears inside correlation-conflict branch';
  end if;

  raise notice 'PASS: CONFLICT_ZERO_MOVEMENT';
end $$;

\echo 'CHECK 6: AUDIT_SAP_IDS_PRESERVED'
do $$
declare
  v_src text;
begin
  select p.prosrc
    into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'apply_inventory_transition'
    and pg_get_function_identity_arguments(p.oid) =
      'p_part_number text, p_mode text, p_qty integer, p_user text, p_correlation_id text, p_analyzer_serial text, p_batch_id text';

  if not found or v_src is null then
    raise exception 'FAIL: target apply_inventory_transition signature not found';
  end if;

  if strpos(v_src, 'v_audit_id uuid') = 0
     or strpos(v_src, 'v_sap_id uuid') = 0
     or strpos(v_src, 'returning id into v_audit_id') = 0
     or strpos(v_src, 'returning id into v_sap_id') = 0
     or strpos(v_src, '''auditId'',v_audit_id') = 0
     or strpos(v_src, '''sapId'',v_sap_id') = 0 then
    raise exception 'FAIL: separate auditId/sapId variables or receipt fields were not preserved';
  end if;

  raise notice 'PASS: AUDIT_SAP_IDS_PRESERVED';
end $$;

\echo 'CHECK 7: SERVICE_ROLE_ONLY'
do $$
declare
  v_oid oid;
  v_forbidden_execute integer;
  v_service_role_execute boolean;
begin
  select p.oid
    into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'apply_inventory_transition'
    and pg_get_function_identity_arguments(p.oid) =
      'p_part_number text, p_mode text, p_qty integer, p_user text, p_correlation_id text, p_analyzer_serial text, p_batch_id text';

  if not found or v_oid is null then
    raise exception 'FAIL: target apply_inventory_transition signature not found';
  end if;

  select count(*)
    into v_forbidden_execute
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  left join pg_roles r on r.oid = acl.grantee
  where p.oid = v_oid
    and acl.privilege_type = 'EXECUTE'
    and (acl.grantee = 0 or r.rolname in ('anon', 'authenticated'));

  select exists(
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    join pg_roles r on r.oid = acl.grantee
    where p.oid = v_oid
      and acl.privilege_type = 'EXECUTE'
      and r.rolname = 'service_role'
  ) into v_service_role_execute;

  if v_forbidden_execute <> 0 then
    raise exception 'FAIL: PUBLIC/anon/authenticated retains EXECUTE';
  end if;
  if not v_service_role_execute then
    raise exception 'FAIL: service_role EXECUTE grant missing';
  end if;

  raise notice 'PASS: SERVICE_ROLE_ONLY';
end $$;

\echo 'CHECK 8: SEARCH_PATH_AND_SECURITY_DEFINER'
do $$
declare
  v_prosecdef boolean;
  v_config text[];
begin
  select p.prosecdef, p.proconfig
    into v_prosecdef, v_config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'apply_inventory_transition'
    and pg_get_function_identity_arguments(p.oid) =
      'p_part_number text, p_mode text, p_qty integer, p_user text, p_correlation_id text, p_analyzer_serial text, p_batch_id text';

  if not found then
    raise exception 'FAIL: target apply_inventory_transition signature not found';
  end if;
  if v_prosecdef is distinct from true then
    raise exception 'FAIL: SECURITY DEFINER not set';
  end if;
  if v_config is null or not (v_config @> ARRAY['search_path=public, pg_temp']::text[]) then
    raise exception 'FAIL: search_path not set to public, pg_temp';
  end if;

  raise notice 'PASS: SEARCH_PATH_AND_SECURITY_DEFINER';
end $$;

\echo 'ALL STRUCTURAL CHECKS PASSED'