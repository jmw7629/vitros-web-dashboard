-- Least-privilege correction for the immutable DHR session-event trigger guard.
-- Trigger execution remains available to the database trigger mechanism; browser
-- roles must never be able to invoke SECURITY DEFINER helpers directly.

REVOKE ALL ON FUNCTION public.reject_dhr_scan_session_event_mutation()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reject_dhr_scan_session_event_mutation()
  TO service_role;
