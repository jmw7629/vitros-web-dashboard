-- Run only after the existing synthetic DHR document bootstrap/migrations.
BEGIN;
INSERT INTO public.dhr_scan_sessions(id,instrument_sn,analyzer_model,status,revision)
VALUES ('dcde0001-cccc-4ccc-8ccc-cccccccccccc','SYNTHETIC-DELETE','5600','in_progress',0),
('dcde0002-dddd-4ddd-8ddd-dddddddddddd','SYNTHETIC-ARCHIVED','5600','completed',0),
('dcde0003-eeee-4eee-8eee-eeeeeeeeeeee','SYNTHETIC-CONFLICT','5600','in_progress',0);
SELECT public.apply_dhr_scan_transition(
 'dcde0001-cccc-4ccc-8ccc-cccccccccccc','SYNTHETIC','ABC123',2,1,'required',
 'Synthetic part','Synthetic Admin','synthetic-delete-scan',0,'SYNTHETIC-DELETE');
CREATE TEMP TABLE before_delete AS SELECT
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY id)::text,'')) FROM public.stock s) stock_hash,
 (SELECT count(*) FROM public.audit_log) audit_count,
 (SELECT count(*) FROM public.sap_staging) sap_count,
 (SELECT count(*) FROM public.dhr_scan_results) result_count;
DO $$
DECLARE r jsonb; n integer;
BEGIN
 r:=public.delete_active_dhr_session('dcde0001-cccc-4ccc-8ccc-cccccccccccc',0,'Synthetic Admin','Duplicate work order','synthetic-delete');
 IF r->>'status'<>'deleted' OR (r->>'duplicate')::boolean THEN RAISE EXCEPTION 'Bad delete receipt'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.dhr_scan_sessions WHERE id='dcde0001-cccc-4ccc-8ccc-cccccccccccc' AND status='deleted' AND revision=1) THEN RAISE EXCEPTION 'Deletion not recorded'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.dhr_scan_session_events WHERE correlation_id='synthetic-delete' AND deletion_reason='Duplicate work order' AND actor='Synthetic Admin' AND from_status='in_progress' AND to_status='deleted') THEN RAISE EXCEPTION 'Audit reason missing'; END IF;
 r:=public.delete_active_dhr_session('dcde0001-cccc-4ccc-8ccc-cccccccccccc',0,'Synthetic Admin','Duplicate work order','synthetic-delete');
 IF NOT (r->>'duplicate')::boolean THEN RAISE EXCEPTION 'Replay not deduplicated'; END IF;
 SELECT count(*) INTO n FROM public.dhr_scan_session_events WHERE correlation_id='synthetic-delete';
 IF n<>1 THEN RAISE EXCEPTION 'Duplicate event'; END IF;
 BEGIN
  PERFORM public.delete_active_dhr_session('dcde0001-cccc-4ccc-8ccc-cccccccccccc',0,'Synthetic Admin','Different intent','synthetic-delete');
  RAISE EXCEPTION 'Conflicting retry accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  PERFORM public.delete_active_dhr_session('dcde0002-dddd-4ddd-8ddd-dddddddddddd',0,'Synthetic Admin','Test','archived-delete');
  RAISE EXCEPTION 'Archived DHR deleted';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 BEGIN
  PERFORM public.delete_active_dhr_session('dcde0003-eeee-4eee-8eee-eeeeeeeeeeee',1,'Synthetic Admin','Test','stale-delete');
  RAISE EXCEPTION 'Stale revision accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  PERFORM public.delete_active_dhr_session('dcde00ff-ffff-4fff-8fff-ffffffffffff',0,'Synthetic Admin','Test','missing-delete');
  RAISE EXCEPTION 'Missing DHR accepted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
  PERFORM public.apply_dhr_session_lifecycle('dcde0001-cccc-4ccc-8ccc-cccccccccccc','in_progress','Synthetic Admin','deleted-reopen',1);
  RAISE EXCEPTION 'Deleted DHR reopened';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 BEGIN
  PERFORM public.apply_dhr_scan_transition('dcde0001-cccc-4ccc-8ccc-cccccccccccc','SYNTHETIC','ABC123',2,2,'required','Synthetic part','Synthetic Admin','deleted-scan',1,'SYNTHETIC-DELETE');
  RAISE EXCEPTION 'Deleted DHR scan accepted';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 BEGIN
  UPDATE public.dhr_scan_session_events SET deletion_reason='Overwrite' WHERE correlation_id='synthetic-delete';
  RAISE EXCEPTION 'Immutable event changed';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 IF has_function_privilege('anon','public.delete_active_dhr_session(uuid,integer,text,text,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.delete_active_dhr_session(uuid,integer,text,text,text)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.delete_active_dhr_session(uuid,integer,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'RPC privilege boundary incorrect'; END IF;
 IF (SELECT stock_hash FROM before_delete) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY id)::text,'')) FROM public.stock s)
 OR (SELECT audit_count FROM before_delete)<>(SELECT count(*) FROM public.audit_log)
 OR (SELECT sap_count FROM before_delete)<>(SELECT count(*) FROM public.sap_staging)
 OR (SELECT result_count FROM before_delete)<>(SELECT count(*) FROM public.dhr_scan_results) THEN
  RAISE EXCEPTION 'Deletion changed inventory, SAP or scan evidence';
 END IF;
END $$;
-- Prove an audit insertion failure rolls the lifecycle change back atomically.
CREATE FUNCTION pg_temp.reject_delete_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'synthetic audit failure' USING ERRCODE='P0001'; END $$;
CREATE TRIGGER synthetic_delete_failure BEFORE INSERT ON public.dhr_scan_session_events FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_delete_event();
DO $$ BEGIN
 BEGIN
  PERFORM public.delete_active_dhr_session('dcde0003-eeee-4eee-8eee-eeeeeeeeeeee',0,'Synthetic Admin','Test','failed-audit-delete');
  RAISE EXCEPTION 'Audit failure did not abort';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'synthetic audit failure' THEN RAISE; END IF;
 END;
 IF NOT EXISTS(SELECT 1 FROM public.dhr_scan_sessions WHERE id='dcde0003-eeee-4eee-8eee-eeeeeeeeeeee' AND status='in_progress' AND revision=0) THEN RAISE EXCEPTION 'Partial deletion persisted'; END IF;
END $$;
ROLLBACK;
SELECT 'DHR_DELETE_DATABASE=PASS: state, audit, replay, conflicts, terminal lifecycle, stock/SAP preservation, privileges, rollback' AS result;
