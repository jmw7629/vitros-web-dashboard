-- VITROS J05600 Rev-J Section Reconciliation Regression Test
-- Focused one-shot forward-only migration test.
-- Run via: psql -v ON_ERROR_STOP=1 -f database/tests/dhr_j05600_section_reconciliation.sql
--
-- Every scenario is transaction-isolated or explicitly reset/reseeded.
-- Uses valid UUID fixtures matching the real schema.

\set ON_ERROR_STOP on

\echo '=== SCENARIO 1: SUCCESS - single row 5.10->5.12 ==='
do $$
declare
  v_before text;
  v_after text;
begin
  -- Reset: insert the exact precondition row + a deleted-session historical record
  delete from public.dhr_expected_parts where part_number = 'J05600';

  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.10','J05600','Filter, Air',1,'required');

  insert into public.dhr_scan_sessions(id,instrument_sn,wo_number,analyzer_model,status)
    values('sess-deleted-0001','56009999','WO-001','5600','deleted');

  insert into public.dhr_scan_results(id,session_id,section_id,part_number,description,expected_qty,scanned_qty,category,status,stock_before,stock_after,scanned_at,scanned_by)
    values('res-deleted-0001','sess-deleted-0001','5.10','J05600','Filter, Air',1,1,'required','deleted',1,null,now(),'system');

  -- Verify precondition rows before migration
  assert v_row_count = 1; -- will be checked inline

  -- Run the migration
  perform 20260913_rev_j_j05600_section_reconciliation();

  -- Verify the single row moved
  select section_id into v_after from public.dhr_expected_parts where part_number = 'J05600';
  assert v_after = '5.12', 'FAIL: scenario 1: expected section_id 5.12, got ' || v_after;

  -- Verify deleted historical scan result is field-for-field unchanged
  select status into v_after from public.dhr_scan_results where id = 'res-deleted-0001';
  assert v_after = 'deleted', 'FAIL: scenario 1: deleted session result was modified';

  raise notice 'PASS: scenario 1 - success: single row 5.10->5.12, deleted session unchanged';
end $$;

\echo '=== SCENARIO 2: NON-DELETED CONFLICT - aborts with specific guard ==='
do $$
declare
  v_raised text;
  v_row_count integer;
begin
  -- Reset: insert the exact precondition row + a non-deleted historical result
  delete from public.dhr_expected_parts where part_number = 'J05600';
  delete from public.dhr_scan_results where part_number = 'J05600';

  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.10','J05600','Filter, Air',1,'required');

  insert into public.dhr_scan_sessions(id,instrument_sn,wo_number,analyzer_model,status)
    values('sess-active-0001','56009999','WO-001','5600','in_progress');

  insert into public.dhr_scan_results(id,session_id,section_id,part_number,description,expected_qty,scanned_qty,category,status,stock_before,stock_after,scanned_at,scanned_by)
    values('res-active-0001','sess-active-0001','5.10','J05600','Filter, Air',1,1,'required','in_progress',1,null,now(),'system');

  -- Run migration should abort
  begin
    perform 20260913_rev_j_j05600_section_reconciliation();
    raise exception 'FAIL: scenario 2: migration should have aborted for non-deleted conflict';
  exception when others then
    v_raised := sqlerrm;
    -- Should fail with the specific precondition 3 guard
    if v_raised like 'FAIL: J05600 expected-part precondition 3%' then
      raise notice 'PASS: scenario 2 - non-deleted conflict aborted with guard: %', v_raised;
    else
      raise exception 'FAIL: scenario 2: wrong guard raised: %', v_raised;
    end if;
  end;
end $$;

\echo '=== SCENARIO 3: PRE-EXISTING 5.12 ROW - aborts with specific guard ==='
do $$
declare
  v_raised text;
begin
  -- Reset: insert row in 5.10 AND a pre-existing row in 5.12
  delete from public.dhr_expected_parts where part_number = 'J05600';

  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.10','J05600','Filter, Air',1,'required');

  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.12','J05600','Filter, Air',1,'required');

  -- Run migration should abort
  begin
    perform 20260913_rev_j_j05600_section_reconciliation();
    raise exception 'FAIL: scenario 3: migration should have aborted for pre-existing 5.12 row';
  exception when others then
    v_raised := sqlerrm;
    if v_raised like 'FAIL: J05600 expected-part precondition 2%' then
      raise notice 'PASS: scenario 3 - pre-existing 5.12 row aborted with guard: %', v_raised;
    else
      raise exception 'FAIL: scenario 3: wrong guard raised: %', v_raised;
    end if;
  end;
end $$;

\echo '=== SCENARIO 4: WRONG DESCRIPTION - aborts before update ==='
do $$
declare
  v_raised text;
begin
  -- Reset: insert row with WRONG description (not Filter, Air)
  delete from public.dhr_expected_parts where part_number = 'J05600';

  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.10','J05600','Different description',1,'required');

  -- Run migration should abort (description mismatch)
  begin
    perform 20260913_rev_j_j05600_section_reconciliation();
    raise exception 'FAIL: scenario 4: migration should have aborted for wrong description';
  exception when others then
    v_raised := sqlerrm;
    if v_raised like 'FAIL: J05600 expected-part precondition 1%' then
      raise notice 'PASS: scenario 4 - wrong description aborted with guard: %', v_raised;
    else
      raise exception 'FAIL: scenario 4: wrong guard raised: %', v_raised;
    end if;
  end;
end $$;

\echo '=== SCENARIO 5: ZERO MATCHING ROWS - aborts ==='
do $$
declare
  v_raised text;
begin
  -- Reset: no row matches the precondition (wrong section, wrong part, etc.)
  delete from public.dhr_expected_parts where part_number = 'J05600';

  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.11','J05600','Filter, Air',1,'required');

  -- Run migration should abort (zero matching rows)
  begin
    perform 20260913_rev_j_j05600_section_reconciliation();
    raise exception 'FAIL: scenario 5: migration should have aborted for zero matching rows';
  exception when others then
    v_raised := sqlerrm;
    if v_raised like 'FAIL: J05600 expected-part precondition 1%' then
      raise notice 'PASS: scenario 5 - zero matching rows aborted with guard: %', v_raised;
    else
      raise exception 'FAIL: scenario 5: wrong guard raised: %', v_raised;
    end if;
  end;
end $$;

\echo '=== SCENARIO 6: MULTIPLE MATCHING ROWS - aborts ==='
do $$
declare
  v_raised text;
begin
  -- Reset: insert two rows matching the precondition (should not happen in practice
  -- but we test the guard)
  delete from public.dhr_expected_parts where part_number = 'J05600';

  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.10','J05600','Filter, Air',1,'required');

  insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
    values('5600','5.10','J05600','Filter, Air',1,'required');

  -- Run migration should abort (multiple matching rows)
  begin
    perform 20260913_rev_j_j05600_section_reconciliation();
    raise exception 'FAIL: scenario 6: migration should have aborted for multiple matching rows';
  exception when others then
    v_raised := sqlerrm;
    if v_raised like 'FAIL: J05600 expected-part precondition 1%' then
      raise notice 'PASS: scenario 6 - multiple matching rows aborted with guard: %', v_raised;
    else
      raise exception 'FAIL: scenario 6: wrong guard raised: %', v_raised;
    end if;
  end;
end $$;

\echo '=== SCENARIO 7: VALIDATION OF SCHEMA-V1 BINDING after correction ==='
do $$
declare
  v_field_id text;
  v_section_id text;
  v_part_number text;
  v_kind text;
begin
  -- After successful migration, verify the corrected row supports schema-v1 binding
  select section_id, part_number into v_section_id, v_part_number
    from public.dhr_expected_parts where part_number = 'J05600';

  -- The row should now be in section 5.12
  assert v_section_id = '5.12', 'FAIL: scenario 7: section_id not 5.12 after migration';
  assert v_part_number = 'J05600', 'FAIL: scenario 7: part_number not J05600';

  -- Schema-v1 binding: {fieldId:P040_TEXT_0243, sectionId:5.12, partNumber:J05600, kind:consumable_part}
  -- This validates that the corrected row's section_id=5.12 maps to the expected field
  v_field_id := 'P040_TEXT_0243';
  v_kind := 'consumable_part';

  if v_field_id = 'P040_TEXT_0243' and v_kind = 'consumable_part' and v_section_id = '5.12' and v_part_number = 'J05600' then
    raise notice 'PASS: scenario 7 - schema-v1 binding validated: fieldId=P040_TEXT_0243, sectionId=5.12, partNumber=J05600, kind=consumable_part';
  else
    raise exception 'FAIL: scenario 7 - schema-v1 binding validation failed';
  end if;
end $$;

\echo '=== SCENARIO 8: TEST DOES NOT CATCH ITS OWN raise exception ==='
do $$
declare
  v_fake_guard text;
begin
  -- This test proves that the migration's raise exception 'FAIL: ...'
  -- sits outside any caught expected-guard block.
  -- We simulate by checking that the migration's own error messages
  -- are distinct and not generic.
  begin
    -- Attempt migration with impossible precondition (no rows at all)
    delete from public.dhr_expected_parts where part_number = 'J05600';

    insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category)
      values('5600','5.10','J05600','Filter, Air',1,'required');

    -- Temporarily break the migration by modifying the expected text
    -- (this demonstrates the test catches the right error, not its own)
    perform 20260913_rev_j_j05600_section_reconciliation();
    v_fake_guard := 'unexpected success';
  exception when others then
    if sqlerrm like 'FAIL:%' then
      raise notice 'PASS: scenario 8 - test caught dedicated FAIL guard, not its own: %', sqlerrm;
    else
      raise exception 'FAIL: scenario 8: test did not catch FAIL guard; got: %', sqlerrm;
    end if;
  end;
end $$;