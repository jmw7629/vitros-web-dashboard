-- VITROS J05600 Rev-J Section Reconciliation Migration
-- Forward-only one-shot migration: replace rejected PR #430 design.
-- Updates dhr_expected_parts.section_id from 5.10 to 5.12 for the exact
-- J05600 row that meets all fail-closed preconditions.
--
-- Authoritative artifact: Object 0000005226, Revision J, SHA-256
-- 4b4ab0fdff404eead682ea2a57a6e7e000434c87d63a121fd00cefba4cd8c4e2
-- Part J05600 / Filter, Air / Required / BOM 1 / Section 5.12
--
-- Safety model (fail-closed):
--   1. Exactly one dhr_expected_parts row must match:
--      analyzer_model='5600', section_id='5.10', part_number='J05600',
--      category='required', bom_qty=1, description='Filter, Air'
--   2. NO dhr_expected_parts row may exist for analyzer_model='5600',
--      section_id='5.12', part_number='J05600'
--   3. No non-deleted J05600 scan result/session at section 5.10 may exist
--      that would make the correction ambiguous.
--      A J05600 result in a session whose status is 'deleted' is allowed
--      and must remain byte/field unchanged.
--   4. The UPDATE must affect exactly one row; otherwise the entire
--      transaction aborts with no partial change.
--
-- Rollback: issue a ROLLBACK; the migration is transactional.
-- Do not execute rollback in Production.
--
-- Changes: ONLY dhr_expected_parts.section_id 5.10 -> 5.12 for the
--           exact matching row. No stock, scan result, session, audit,
--           SAP, manifest, digital-DHR, auth/RLS, settings, UI changes.

DO $$
DECLARE
  v_row_count integer;
  v_existing_512_count integer;
  v_deleted_session_count integer;
  v_affected integer;
BEGIN
  -- Precondition 1: Exactly one matching row in 5.10 with the exact identity.
  SELECT count(*)
    INTO v_row_count
    FROM public.dhr_expected_parts
   WHERE analyzer_model = '5600'
     AND section_id = '5.10'
     AND part_number = 'J05600'
     AND category = 'required'
     AND bom_qty = 1
     AND description = 'Filter, Air';

  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: J05600 expected-part precondition 1: expected exactly 1 row matching analyzer_model=5600, section_id=5.10, part_number=J05600, category=required, bom_qty=1, description=Filter, Air; found %', v_row_count;
  END IF;

  -- Precondition 2: No J05600 expected row already in section 5.12.
  SELECT count(*)
    INTO v_existing_512_count
    FROM public.dhr_expected_parts
   WHERE analyzer_model = '5600'
     AND section_id = '5.12'
     AND part_number = 'J05600';

  IF v_existing_512_count > 0 THEN
    RAISE EXCEPTION 'FAIL: J05600 expected-part precondition 2: a row already exists in section_id=5.12 for part_number=J05600; cannot forward-migrate';
  END IF;

  -- Precondition 3: No non-deleted J05600 scan result/session at section 5.10.
  -- A deleted-session result is allowed and must remain byte/field unchanged.
  SELECT count(*)
    INTO v_deleted_session_count
    FROM public.dhr_scan_results
   WHERE part_number = 'J05600'
     AND section_id = '5.10'
     AND status <> 'deleted';

  IF v_deleted_session_count > 0 THEN
    RAISE EXCEPTION 'FAIL: J05600 expected-part precondition 3: a non-deleted J05600 scan result at section 5.10 exists, making the correction ambiguous';
  END IF;

  -- Perform the guarded one-row update.
  UPDATE public.dhr_expected_parts
     SET section_id = '5.12'
   WHERE analyzer_model = '5600'
     AND section_id = '5.10'
     AND part_number = 'J05600'
     AND category = 'required'
     AND bom_qty = 1
     AND description = 'Filter, Air';

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'FAIL: J05600 expected-part update affected % row(s), expected exactly 1; transaction aborting', v_affected;
  END IF;

  RAISE NOTICE 'PASS: J05600 section_id updated from 5.10 to 5.12 for exactly one row';
END $$;