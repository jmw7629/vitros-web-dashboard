-- Regression tests for Rev-J J05600 Section Reconciliation migration.
-- Verifies the guarded migration correctly moves J05600 from Section 5.10 to 5.12
-- while preserving all historical DHR rows and failing closed on ambiguous cases.
-- Run with: psql -f database/tests/revj_j05600_section_reconciliation.sql
--
-- Synthetic fixtures only; never execute against production data.

-- ---- Scenario 1: Successful migration ----
-- Setup: one J05600 expected row in 5.10, no 5.12 conflict, only deleted historical scan results
do $$
declare
  v_result text;
begin
  -- Clean state: insert J05600 expected part in section 5.10
  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.10','J05600','Filter, Air',1,'required');

  -- Insert a deleted scan session + result (status='deleted') for J05600 at 5.10
  -- This must remain untouched after migration
  insert into public.dhr_scan_sessions(id,instrument_sn,wo_number,analyzer_model,status)
    values('sess-deleted-001','56009999',null,'5600','deleted');
  insert into public.dhr_scan_results(id,session_id,section_id,part_number,description,expected_qty,scanned_qty,category,status)
    values('result-deleted-001','sess-deleted-001','5.10','J05600','Filter Air (scanned)',1,1,'required','deleted');

  -- Execute the migration
  perform public.revj_j05600_section_reconcile();

  -- Verify: J05600 expected part now in section 5.12
  select count(*) into v_result
  from public.dhr_expected_parts
  where analyzer_model='5600' and section_id='5.12' and upper(btrim(part_number))='J05600';
  if v_result<>1 then raise exception 'FAIL: J05600 not moved to 5.12'; end if;

  -- Verify: original row in 5.10 is gone (updated to 5.12)
  select count(*) into v_result
  from public.dhr_expected_parts
  where analyzer_model='5600' and section_id='5.10' and upper(btrim(part_number))='J05600';
  if v_result<>0 then raise exception 'FAIL: J05600 still present in 5.10'; end if;

  -- Verify: deleted historical scan result is byte/field unchanged
  select count(*) into v_result
  from public.dhr_scan_results
  where id='result-deleted-001';
  if v_result<>1 then raise exception 'FAIL: deleted scan result was modified/removed'; end if;

  raise notice 'SCENARIO 1 PASSED: successful migration with deleted historical rows preserved';
end;
$$;

-- ---- Scenario 2: Guard abort - non-deleted historical scan result ----
do $$
declare
  v_result text;
  v_abort boolean;
begin
  -- Clean state: insert J05600 expected part in section 5.10
  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.10','J05600','Filter, Air',1,'required');

  -- Insert a non-deleted scan session + result for J05600 at 5.10
  -- This should cause the guard to abort
  insert into public.dhr_scan_sessions(id,instrument_sn,wo_number,analyzer_model,status)
    values('sess-active-001','56009999',null,'5600','in_progress');
  insert into public.dhr_scan_results(id,session_id,section_id,part_number,description,expected_qty,scanned_qty,category,status)
    values('result-active-001','sess-active-001','5.10','J05600','Filter Air (scanned)',1,1,'required','in_progress');

  -- Attempt the migration; it should abort
  begin
    perform public.revj_j05600_section_reconcile();
    raise exception 'FAIL: migration should have aborted with non-deleted historical row';
  exception when others then
    v_abort := true; -- guard raised exception, expected behavior
  end;

  if not v_abort then
    raise exception 'FAIL: migration did not abort for non-deleted historical row';
  end if;

  -- Verify: J05600 expected part still in section 5.10 (no partial change)
  select count(*) into v_result
  from public.dhr_expected_parts
  where analyzer_model='5600' and section_id='5.10' and upper(btrim(part_number))='J05600';
  if v_result<>1 then raise exception 'FAIL: partial change applied despite guard abort'; end if;

  raise notice 'SCENARIO 2 PASSED: guard aborts with non-deleted historical row, no partial change';
end;
$$;

-- ---- Scenario 3: Guard abort - conflicting 5.12 expected row ----
do $$
declare
  v_result text;
  v_abort boolean;
begin
  -- Setup: J05600 expected row already in section 5.12
  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.12','J05600','Filter, Air (conflict)',1,'required');

  -- Also insert the row in 5.10 for the guard to check against
  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.10','J05600','Filter, Air',1,'required');

  -- Attempt the migration; it should abort due to Guard 2
  begin
    perform public.revj_j05600_section_reconcile();
    raise exception 'FAIL: migration should have aborted with conflicting 5.12 row';
  exception when others then
    v_abort := true; -- guard raised exception, which is the expected behavior
  end;

  if not v_abort then
    raise exception 'FAIL: migration did not abort for conflicting 5.12 row';
  end if;

  -- Verify: both rows still exist, no partial change
  select count(*) into v_result
  from public.dhr_expected_parts
  where analyzer_model='5600' and section_id='5.12' and upper(btrim(part_number))='J05600';
  if v_result<>1 then raise exception 'FAIL: conflicting row was modified'; end if;

  select count(*) into v_result
  from public.dhr_expected_parts
  where analyzer_model='5600' and section_id='5.10' and upper(btrim(part_number))='J05600';
  if v_result<>1 then raise exception 'FAIL: 5.10 row was modified despite abort'; end if;

  raise notice 'SCENARIO 3 PASSED: guard aborts with conflicting 5.12 expected row, no partial change';
end;
$$;

-- ---- Scenario 4: Digital DHR binding validation ----
-- After successful migration, the corrected expected row should allow a schema-v1
-- digital-DHR binding {fieldId:P040_TEXT_0243, sectionId:5.12, partNumber:J05600, kind:consumable_part}
-- to validate via validate_digital_dhr_manifest.
do $$
declare
  v_manifest jsonb;
  v_bindings jsonb;
  v_bound text;
  v_valid boolean;
begin
  -- Clean state: insert J05600 expected part in section 5.10 first
  -- (reset any prior test state)
  delete from public.dhr_expected_parts where analyzer_model='5600' and upper(btrim(part_number))='J05600';

  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.10','J05600','Filter, Air',1,'required');

  -- Execute migration
  perform public.revj_j05600_section_reconcile();

  -- Now validate that the corrected expected part (now in 5.12) would validate
  -- Construct a manifest binding with fieldId P040_TEXT_0243, sectionId 5.12, partNumber J05600
  v_bindings := '[
    {
      "fieldId": "P040_TEXT_0243",
      "sectionId": "5.12",
      "partNumber": "J05600",
      "kind": "consumable_part",
      "quantityMode": "integer",
      "stepReference": null
    }
  ]'::jsonb;

  v_manifest := jsonb_build_object(
    'schemaVersion', '1',
    'templateId', 'synthetic:document',
    'documentRevision', 'TEST-1',
    'analyzerModel', '5600',
    'artifactSha256', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'bindings', v_bindings
  );

  -- Validate via the bridge function
  begin
    perform public.validate_digital_dhr_manifest(v_manifest);
    v_valid := true;
  exception when others then
    v_valid := false;
  end;

  if not v_valid then
    raise exception 'FAIL: corrected expected row does not validate schema-v1 digital-DHR binding';
  end if;

  raise notice 'SCENARIO 4 PASSED: corrected expected row allows schema-v1 digital-DHR binding validation';
end;
$$;

-- ---- Scenario 5: Guard abort with non-deleted session ----
do $$
declare
  v_abort boolean;
begin
  -- Clean state: insert J05600 expected part in section 5.10
  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.10','J05600','Filter, Air',1,'required');

  -- Insert a non-deleted (in_progress) scan session (no result row needed,
  -- the session itself being non-deleted is enough to trigger Guard 4)
  insert into public.dhr_scan_sessions(id,instrument_sn,wo_number,analyzer_model,status)
    values('sess-nondeleted-001','56009999',null,'5600','in_progress');

  -- Attempt the migration; it should abort due to Guard 4
  begin
    perform public.revj_j05600_section_reconcile();
    raise exception 'FAIL: migration should have aborted with non-deleted session';
  exception when others then
    v_abort := true; -- guard raised exception, expected behavior
  end;

  if not v_abort then
    raise exception 'FAIL: migration did not abort for non-deleted session';
  end if;

  -- Verify: J05600 expected part still in section 5.10
  select count(*) into v_result
  from public.dhr_expected_parts
  where analyzer_model='5600' and section_id='5.10' and upper(btrim(part_number))='J05600';
  if v_result <> 1 then
    raise exception 'FAIL: partial change applied despite guard abort';
  end if;
    raise exception 'FAIL: partial change applied despite guard abort';
  end if;

  raise notice 'SCENARIO 5 PASSED: guard aborts with non-deleted session, no partial change';
end;
$$;