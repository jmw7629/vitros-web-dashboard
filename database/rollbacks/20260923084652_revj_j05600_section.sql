-- OPERATOR-ONLY guarded reverse; never auto-executed in Production.
-- Both old/new section histories must remain deleted-session-only.
DO $migration$
DECLARE
  candidate public.dhr_expected_parts;
  matches integer;
  changed integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  -- Short, bounded serialization prevents new history/config between guard and update.
  LOCK TABLE public.dhr_scan_sessions IN SHARE MODE;
  LOCK TABLE public.dhr_scan_results IN SHARE MODE;
  LOCK TABLE public.dhr_expected_parts IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO matches FROM public.dhr_expected_parts
   WHERE analyzer_model='5600' AND section_id='5.12'
     AND upper(btrim(part_number))='J05600';
  IF matches<>1 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='revj_j05600_reverse_source_count';
  END IF;
  SELECT * INTO STRICT candidate FROM public.dhr_expected_parts
   WHERE analyzer_model='5600' AND section_id='5.12'
     AND upper(btrim(part_number))='J05600';
  IF lower(btrim(candidate.description)) IS DISTINCT FROM 'filter, air'
     OR candidate.category IS DISTINCT FROM 'required'
     OR candidate.bom_qty IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='revj_j05600_reverse_source_attributes';
  END IF;
  IF EXISTS (SELECT 1 FROM public.dhr_expected_parts
      WHERE analyzer_model='5600' AND section_id='5.10'
        AND upper(btrim(part_number))='J05600') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='revj_j05600_reverse_target_conflict';
  END IF;
  -- A matched result is allowed when its OWNING SESSION is deleted.
  IF EXISTS (SELECT 1 FROM public.dhr_scan_results r
      JOIN public.dhr_scan_sessions s ON s.id=r.session_id
      WHERE s.analyzer_model='5600' AND r.section_id IN ('5.10','5.12')
        AND upper(btrim(r.part_number))='J05600'
        AND s.status IS DISTINCT FROM 'deleted') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='revj_j05600_reverse_session_conflict';
  END IF;

  UPDATE public.dhr_expected_parts SET section_id='5.10'
   WHERE id=candidate.id AND analyzer_model='5600' AND section_id='5.12'
     AND upper(btrim(part_number))='J05600';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='revj_j05600_reverse_update_count';
  END IF;
END
$migration$;
