-- Active DHR deletion is a terminal lifecycle event; movement history is retained.
ALTER TABLE public.dhr_scan_session_events ADD COLUMN deletion_reason text;
ALTER TABLE public.dhr_scan_session_events DROP CONSTRAINT dhr_scan_session_events_status_check;
ALTER TABLE public.dhr_scan_session_events ADD CONSTRAINT dhr_scan_session_events_status_check
  CHECK (from_status IN ('in_progress','completed') AND
    (to_status IN ('in_progress','completed') OR (from_status='in_progress' AND to_status='deleted')));
ALTER TABLE public.dhr_scan_session_events ADD CONSTRAINT dhr_scan_session_events_deletion_reason_check
  CHECK ((to_status='deleted' AND deletion_reason IS NOT NULL AND length(btrim(deletion_reason)) BETWEEN 1 AND 500)
    OR (to_status<>'deleted' AND deletion_reason IS NULL));

CREATE FUNCTION public.delete_active_dhr_session(
  p_session_id uuid, p_expected_revision integer, p_actor text,
  p_reason text, p_correlation_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  s public.dhr_scan_sessions%ROWTYPE;
  e public.dhr_scan_session_events%ROWTYPE;
  actor text := btrim(coalesce(p_actor,''));
  reason text := btrim(coalesce(p_reason,''));
  correlation text := btrim(coalesce(p_correlation_id,''));
BEGIN
  IF p_session_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0
    OR length(actor) NOT BETWEEN 1 AND 240 OR length(reason) NOT BETWEEN 1 AND 500
    OR length(correlation) NOT BETWEEN 1 AND 400 THEN
    RAISE EXCEPTION 'Invalid DHR deletion request' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dhr-lifecycle-correlation:'||correlation,0));
  SELECT * INTO e FROM public.dhr_scan_session_events WHERE correlation_id=correlation;
  IF FOUND THEN
    IF e.session_id<>p_session_id OR e.to_status<>'deleted' OR e.revision_before<>p_expected_revision
      OR e.actor<>actor OR e.deletion_reason IS DISTINCT FROM reason THEN
      RAISE EXCEPTION 'DHR deletion correlation reused with different intent' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('eventId',e.id,'sessionId',e.session_id,'status','deleted','revision',e.revision_after,'duplicate',true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dhr-lifecycle-session:'||p_session_id::text,0));
  SELECT * INTO s FROM public.dhr_scan_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DHR session not found' USING ERRCODE='P0002'; END IF;
  IF s.status IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION 'Only active DHRs can be deleted' USING ERRCODE='55000';
  END IF;
  IF s.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'DHR changed. Refresh before deleting' USING ERRCODE='40001';
  END IF;
  UPDATE public.dhr_scan_sessions SET status='deleted',revision=s.revision+1 WHERE id=s.id;
  INSERT INTO public.dhr_scan_session_events
    (correlation_id,session_id,from_status,to_status,revision_before,revision_after,actor,deletion_reason)
  VALUES (correlation,s.id,'in_progress','deleted',s.revision,s.revision+1,actor,reason) RETURNING * INTO e;
  RETURN jsonb_build_object('eventId',e.id,'sessionId',e.session_id,'status','deleted','revision',e.revision_after,'duplicate',false);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_active_dhr_session(uuid,integer,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_active_dhr_session(uuid,integer,text,text,text) TO service_role;
