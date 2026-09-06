-- Enterprise administration foundation for the existing non-secret VITROS settings.
-- This migration is additive and does not change any current setting values.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.admin_setting_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  correlation_id text NOT NULL UNIQUE,
  setting_key text NOT NULL,
  previous_value text NOT NULL,
  new_value text NOT NULL,
  previous_version integer NOT NULL CHECK (previous_version >= 1),
  new_version integer NOT NULL CHECK (new_version = previous_version + 1),
  actor text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_setting_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_setting_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.admin_setting_events_event_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reject_admin_setting_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'admin setting history is immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS admin_setting_events_immutable ON public.admin_setting_events;
CREATE TRIGGER admin_setting_events_immutable
BEFORE UPDATE OR DELETE ON public.admin_setting_events
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_setting_event_mutation();

REVOKE ALL ON FUNCTION public.reject_admin_setting_event_mutation() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_admin_setting_change(
  p_key text,
  p_value text,
  p_expected_version integer,
  p_actor text,
  p_correlation_id text,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (
  event_id bigint,
  setting_key text,
  value text,
  version integer,
  updated_at timestamptz,
  duplicate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_key text := btrim(coalesce(p_key, ''));
  v_value text := btrim(coalesce(p_value, ''));
  v_actor text := btrim(coalesce(p_actor, ''));
  v_correlation text := btrim(coalesce(p_correlation_id, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_current_value text;
  v_current_version integer;
  v_updated_at timestamptz;
  v_event public.admin_setting_events%ROWTYPE;
BEGIN
  IF v_key NOT IN (
    'sapPlantCode',
    'sapStorageLocation',
    'sapMovementIN',
    'sapMovementOUT',
    'sapMovementADJUST',
    'sapHeaderText'
  ) THEN
    RAISE EXCEPTION 'setting is not editable' USING ERRCODE = '22023';
  END IF;

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'expected version must be a positive integer' USING ERRCODE = '22023';
  END IF;
  IF v_actor = '' OR char_length(v_actor) > 200 THEN
    RAISE EXCEPTION 'invalid actor' USING ERRCODE = '22023';
  END IF;
  IF v_correlation = '' OR char_length(v_correlation) > 200 THEN
    RAISE EXCEPTION 'invalid correlation id' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason is too long' USING ERRCODE = '22023';
  END IF;

  IF v_key = 'sapPlantCode' THEN
    v_value := upper(v_value);
    IF v_value !~ '^[A-Z0-9]{2,8}$' THEN
      RAISE EXCEPTION 'invalid SAP plant code' USING ERRCODE = '22023';
    END IF;
  ELSIF v_key = 'sapStorageLocation' THEN
    v_value := upper(v_value);
    IF v_value !~ '^[A-Z0-9_-]{1,12}$' THEN
      RAISE EXCEPTION 'invalid SAP storage location' USING ERRCODE = '22023';
    END IF;
  ELSIF v_key IN ('sapMovementIN', 'sapMovementOUT', 'sapMovementADJUST') THEN
    IF v_value !~ '^[0-9]{3}$' THEN
      RAISE EXCEPTION 'SAP movement type must be three digits' USING ERRCODE = '22023';
    END IF;
  ELSIF v_key = 'sapHeaderText' THEN
    IF char_length(v_value) < 1 OR char_length(v_value) > 120 OR v_value ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'invalid SAP header text' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Serialize both exact retries and concurrent edits of the same setting.
  PERFORM pg_advisory_xact_lock(hashtextextended('admin-setting:' || v_key, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('admin-correlation:' || v_correlation, 0));

  SELECT e.* INTO v_event
  FROM public.admin_setting_events e
  WHERE e.correlation_id = v_correlation;

  IF FOUND THEN
    IF v_event.setting_key <> v_key OR v_event.new_value <> v_value THEN
      RAISE EXCEPTION 'correlation id was already used for a different change' USING ERRCODE = '23505';
    END IF;

    SELECT s.updated_at INTO v_updated_at
    FROM public.settings s
    WHERE s.key = v_key;

    RETURN QUERY SELECT
      v_event.event_id,
      v_event.setting_key,
      v_event.new_value,
      v_event.new_version,
      coalesce(v_updated_at, v_event.created_at),
      true;
    RETURN;
  END IF;

  SELECT s.value, s.version
    INTO v_current_value, v_current_version
  FROM public.settings s
  WHERE s.key = v_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'editable setting is not configured' USING ERRCODE = 'P0002';
  END IF;

  IF v_current_version <> p_expected_version THEN
    RAISE EXCEPTION 'setting version conflict: expected %, current %', p_expected_version, v_current_version
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.settings s
  SET value = v_value,
      version = v_current_version + 1,
      updated_at = now()
  WHERE s.key = v_key
  RETURNING s.updated_at INTO v_updated_at;

  INSERT INTO public.admin_setting_events (
    correlation_id,
    setting_key,
    previous_value,
    new_value,
    previous_version,
    new_version,
    actor,
    reason
  ) VALUES (
    v_correlation,
    v_key,
    v_current_value,
    v_value,
    v_current_version,
    v_current_version + 1,
    v_actor,
    v_reason
  ) RETURNING * INTO v_event;

  RETURN QUERY SELECT
    v_event.event_id,
    v_event.setting_key,
    v_event.new_value,
    v_event.new_version,
    v_updated_at,
    false;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_admin_setting_change(text, text, integer, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_admin_setting_change(text, text, integer, text, text, text)
  TO service_role;
