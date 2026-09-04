-- DHR session lifecycle revisions.
-- Finalize/reopen changes lifecycle state only; inventory movement remains exclusively
-- in apply_dhr_scan_transition / apply_inventory_transition.

ALTER TABLE public.dhr_scan_sessions
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.dhr_scan_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text NOT NULL UNIQUE,
  session_id uuid NOT NULL REFERENCES public.dhr_scan_sessions(id) ON DELETE RESTRICT,
  from_status text NOT NULL,
  to_status text NOT NULL,
  revision_before integer NOT NULL,
  revision_after integer NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dhr_scan_session_events_status_check
    CHECK (from_status IN ('in_progress', 'completed') AND to_status IN ('in_progress', 'completed')),
  CONSTRAINT dhr_scan_session_events_revision_check
    CHECK (revision_before >= 0 AND revision_after = revision_before + 1),
  CONSTRAINT dhr_scan_session_events_transition_check
    CHECK (from_status <> to_status),
  CONSTRAINT dhr_scan_session_events_actor_check
    CHECK (length(btrim(actor)) BETWEEN 1 AND 240)
);

CREATE INDEX IF NOT EXISTS dhr_scan_session_events_session_revision_idx
  ON public.dhr_scan_session_events(session_id, revision_after DESC);

ALTER TABLE public.dhr_scan_session_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dhr_scan_session_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reject_dhr_scan_session_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'DHR session lifecycle history is immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS dhr_scan_session_events_immutable ON public.dhr_scan_session_events;
CREATE TRIGGER dhr_scan_session_events_immutable
BEFORE UPDATE OR DELETE ON public.dhr_scan_session_events
FOR EACH ROW EXECUTE FUNCTION public.reject_dhr_scan_session_event_mutation();

CREATE OR REPLACE FUNCTION public.apply_dhr_session_lifecycle(
  p_session_id uuid,
  p_target_status text,
  p_actor text,
  p_correlation_id text,
  p_expected_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.dhr_scan_sessions%ROWTYPE;
  v_existing public.dhr_scan_session_events%ROWTYPE;
  v_event public.dhr_scan_session_events%ROWTYPE;
  v_target text := lower(btrim(coalesce(p_target_status, '')));
  v_actor text := btrim(coalesce(p_actor, ''));
  v_correlation text := btrim(coalesce(p_correlation_id, ''));
  v_current_status text;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'DHR session id is required' USING ERRCODE = '22023';
  END IF;
  IF v_target NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'Invalid DHR lifecycle status' USING ERRCODE = '22023';
  END IF;
  IF length(v_actor) < 1 OR length(v_actor) > 240 THEN
    RAISE EXCEPTION 'Invalid DHR lifecycle actor' USING ERRCODE = '22023';
  END IF;
  IF length(v_correlation) < 1 OR length(v_correlation) > 400 THEN
    RAISE EXCEPTION 'Invalid DHR lifecycle correlation id' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Invalid DHR lifecycle expected revision' USING ERRCODE = '22023';
  END IF;

  -- Serialize exact retries before inspecting mutable session state.
  PERFORM pg_advisory_xact_lock(hashtextextended('dhr-lifecycle-correlation:' || v_correlation, 0));

  SELECT * INTO v_existing
  FROM public.dhr_scan_session_events
  WHERE correlation_id = v_correlation;

  IF FOUND THEN
    IF v_existing.session_id <> p_session_id
       OR v_existing.to_status <> v_target
       OR v_existing.revision_before <> p_expected_revision THEN
      RAISE EXCEPTION 'DHR lifecycle correlation id reused with different intent' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'event_id', v_existing.id,
      'session_id', v_existing.session_id,
      'from_status', v_existing.from_status,
      'to_status', v_existing.to_status,
      'revision_before', v_existing.revision_before,
      'revision_after', v_existing.revision_after,
      'actor', v_existing.actor,
      'created_at', v_existing.created_at,
      'duplicate', true
    );
  END IF;

  -- Serialize all lifecycle changes for the same DHR session, including two users
  -- racing finalize/reopen from the same browser state.
  PERFORM pg_advisory_xact_lock(hashtextextended('dhr-lifecycle-session:' || p_session_id::text, 0));

  SELECT * INTO v_session
  FROM public.dhr_scan_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DHR session not found' USING ERRCODE = 'P0002';
  END IF;

  v_current_status := lower(btrim(coalesce(v_session.status, 'in_progress')));
  IF v_current_status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'DHR session has unsupported lifecycle status' USING ERRCODE = '55000';
  END IF;
  IF v_session.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'DHR session revision conflict: expected %, current %', p_expected_revision, v_session.revision USING ERRCODE = '40001';
  END IF;
  IF v_current_status = v_target THEN
    RAISE EXCEPTION 'DHR session is already in requested lifecycle status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.dhr_scan_sessions
  SET status = v_target,
      completed_at = CASE WHEN v_target = 'completed' THEN now() ELSE NULL END,
      revision = v_session.revision + 1
  WHERE id = p_session_id;

  INSERT INTO public.dhr_scan_session_events (
    correlation_id,
    session_id,
    from_status,
    to_status,
    revision_before,
    revision_after,
    actor
  ) VALUES (
    v_correlation,
    p_session_id,
    v_current_status,
    v_target,
    v_session.revision,
    v_session.revision + 1,
    v_actor
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'session_id', v_event.session_id,
    'from_status', v_event.from_status,
    'to_status', v_event.to_status,
    'revision_before', v_event.revision_before,
    'revision_after', v_event.revision_after,
    'actor', v_event.actor,
    'created_at', v_event.created_at,
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_dhr_session_lifecycle(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_dhr_session_lifecycle(uuid, text, text, text, integer) TO service_role;
