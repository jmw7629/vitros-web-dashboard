-- Rev-J J05600 Section Reconciliation migration.
-- Moves the J05600 expected part from Section 5.10 to Section 5.12 for model 5600,
-- preserving all historical DHR rows unchanged.
--
-- Guard conditions (fail closed unless all pass):
--   1. Exactly one dhr_expected_parts row exists for analyzer_model='5600',
--      section_id='5.10', part_number='J05600', category='required', bom_qty=1.
--   2. No dhr_expected_parts row exists for analyzer_model='5600',
--      section_id='5.12', part_number='J05600' (no conflicting 5.12 row).
--   3. No non-deleted dhr_scan_results row exists for J05600 at section 5.10
--      in a session whose status is not 'deleted'.
--   4. No non-deleted dhr_scan_sessions row exists for model 5600 with
--      J05600 at section 5.10 that would make the correction ambiguous.
--
-- Action (if all guards pass): update only the section_id from 5.10 to 5.12
-- for the single matching expected-part row. No stock, audit, SAP, scan result,
-- session, manifest, auth/RLS, or setting changes.
--
-- Recovery: To roll back, re-run this migration with section_id reverted
-- from 5.12 to 5.10 under the same guard conditions (i.e. ensure no
-- non-deleted historical rows reference J05600 at 5.12 before rolling back).

create or replace function public.revj_j05600_section_reconcile()
returns void language plpgsql set search_path=public,pg_temp as
$$
declare
  v_expected_count integer;
  v_conflicting_count integer;
  v_deleted_result_count integer;
  v_nondeleted_session_count integer;
  v_nondeleted_result_count integer;
begin
  -- Guard 1: exactly one J05600 expected row exists for model 5600 in section 5.10
  -- with the currently observed semantics (Required, BOM 1, "Filter, Air")
  select count(*) into v_expected_count
  from public.dhr_expected_parts
  where analyzer_model = '5600'
    and section_id = '5.10'
    and upper(btrim(part_number)) = 'J05600'
    and category = 'required'
    and bom_qty = 1;

  if v_expected_count <> 1 then
    raise exception 'Guard 1 failed: expected 1 J05600 row in 5.10/Required/BOM1, found %', v_expected_count;
  end if;

  -- Guard 2: no conflicting J05600 expected row exists in section 5.12
  select count(*) into v_conflicting_count
  from public.dhr_expected_parts
  where analyzer_model = '5600'
    and section_id = '5.12'
    and upper(btrim(part_number)) = 'J05600';

  if v_conflicting_count > 0 then
    raise exception 'Guard 2 failed: conflicting J05600 row already exists in section 5.12';
  end if;

  -- Guard 3: no non-deleted dhr_scan_results row for J05600 at section 5.10
  -- The scan result row under a deleted session is allowed to remain untouched.
  select count(*) into v_nondeleted_result_count
  from public.dhr_scan_results r
  join public.dhr_scan_sessions s on r.session_id = s.id
  where upper(btrim(r.part_number)) = 'J05600'
    and r.section_id = '5.10'
    and lower(btrim(coalesce(s.status, ''))) <> 'deleted';

  if v_nondeleted_result_count > 0 then
    raise exception 'Guard 3 failed: non-deleted J05600 scan result at section 5.10 found';
  end if;

  -- Guard 4: no non-deleted dhr_scan_sessions for model 5600 with J05600 at 5.10
  select count(*) into v_nondeleted_session_count
  from public.dhr_scan_sessions s
  join public.dhr_scan_results r on s.id = r.session_id
  where s.analyzer_model = '5600'
    and upper(btrim(r.part_number)) = 'J05600'
    and r.section_id = '5.10'
    and lower(btrim(coalesce(s.status, ''))) <> 'deleted';

  if v_nondeleted_session_count > 0 then
    raise exception 'Guard 4 failed: non-deleted session with J05600 at section 5.10 found';
  end if;

  -- All guards passed; perform the forward-only update
  update public.dhr_expected_parts
  set section_id = '5.12'
  where analyzer_model = '5600'
    and section_id = '5.10'
    and upper(btrim(part_number)) = 'J05600'
    and category = 'required'
    and bom_qty = 1;
end
$$;

-- Grant execute to service_role so the bridge can invoke it
grant execute on function public.revj_j05600_section_reconcile() to service_role;