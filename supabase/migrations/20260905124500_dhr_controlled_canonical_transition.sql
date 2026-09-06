-- Controlled DHR consumption hardening.
--
-- The browser wire shape still carries expected quantity/category/description for
-- backward compatibility, but those fields are no longer authoritative. The
-- transaction resolves the active DHR session plus the configured expected part
-- from Supabase, derives the instrument serial from that session, and refuses any
-- new quantity mutation after the DHR is completed. Exact correlation retries are
-- resolved before lifecycle checks so a committed request can still be retried
-- safely after the session is subsequently finalized.

CREATE OR REPLACE FUNCTION public.apply_dhr_scan_transition(
  p_session_id uuid,
  p_section_id text,
  p_part_number text,
  p_expected_qty integer,
  p_new_qty integer,
  p_category text,
  p_description text,
  p_actor text,
  p_correlation_id text,
  p_expected_revision integer,
  p_analyzer_serial text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_event public.dhr_scan_result_events%ROWTYPE;
  v_session public.dhr_scan_sessions%ROWTYPE;
  v_expected public.dhr_expected_parts%ROWTYPE;
  v_result public.dhr_scan_results%ROWTYPE;
  v_stock public.stock%ROWTYPE;
  v_previous_qty integer := 0;
  v_delta integer := 0;
  v_revision_before integer := 0;
  v_revision_after integer := 0;
  v_status text;
  v_mode text := NULL;
  v_inventory jsonb := NULL;
  v_stock_before integer := NULL;
  v_stock_after integer := NULL;
  v_audit_id uuid := NULL;
  v_sap_id uuid := NULL;
  v_event_id uuid;
  v_canonical_part text;
  v_result_match_count integer := 0;
  v_stock_match_count integer := 0;
  v_expected_match_count integer := 0;
  v_expected_qty integer;
  v_category text;
  v_description text;
BEGIN
  IF p_session_id IS NULL THEN RAISE EXCEPTION 'sessionId is required'; END IF;
  IF p_section_id IS NULL OR btrim(p_section_id) = '' THEN RAISE EXCEPTION 'sectionId is required'; END IF;
  IF p_part_number IS NULL OR btrim(p_part_number) = '' THEN RAISE EXCEPTION 'partNumber is required'; END IF;
  IF p_new_qty IS NULL OR p_new_qty < 0 THEN RAISE EXCEPTION 'scanned quantity must be zero or greater'; END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN RAISE EXCEPTION 'expected revision must be zero or greater'; END IF;
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN RAISE EXCEPTION 'actor is required'; END IF;
  IF p_correlation_id IS NULL OR btrim(p_correlation_id) = '' THEN RAISE EXCEPTION 'correlationId is required'; END IF;

  v_canonical_part := upper(btrim(p_part_number));

  PERFORM pg_advisory_xact_lock(hashtextextended('dhr-correlation|' || p_correlation_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'dhr-field|' || p_session_id::text || '|' || p_section_id || '|' || v_canonical_part,
    0
  ));

  SELECT * INTO v_existing_event
  FROM public.dhr_scan_result_events
  WHERE correlation_id = p_correlation_id;

  IF FOUND THEN
    IF v_existing_event.session_id <> p_session_id
      OR v_existing_event.section_id <> p_section_id
      OR upper(btrim(v_existing_event.part_number)) <> v_canonical_part
      OR v_existing_event.new_qty <> p_new_qty THEN
      RAISE EXCEPTION 'correlationId already used for a different DHR event';
    END IF;
    RETURN jsonb_build_object(
      'success', true, 'duplicate', true, 'eventId', v_existing_event.id,
      'resultId', v_existing_event.result_id, 'sessionId', v_existing_event.session_id,
      'sectionId', v_existing_event.section_id, 'partNumber', v_existing_event.part_number,
      'previousQty', v_existing_event.previous_qty, 'newQty', v_existing_event.new_qty,
      'delta', v_existing_event.delta, 'revisionBefore', v_existing_event.revision_before,
      'revisionAfter', v_existing_event.revision_after, 'mode', v_existing_event.inventory_mode,
      'auditId', v_existing_event.audit_id, 'sapId', v_existing_event.sap_id,
      'processedAt', v_existing_event.created_at
    );
  END IF;

  -- Lock the DHR session before any inventory decision. This serializes quantity
  -- mutations against finalize/reopen and makes lifecycle state authoritative.
  SELECT * INTO v_session
  FROM public.dhr_scan_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'DHR session not found'; END IF;
  IF lower(btrim(coalesce(v_session.status, ''))) <> 'in_progress' THEN
    RAISE EXCEPTION 'DHR session is not open for inventory consumption';
  END IF;

  -- Resolve the controlled-form part from authoritative DHR configuration. The
  -- caller cannot change category to bypass stock movement, change expected qty,
  -- substitute description, or supply a different analyzer serial.
  SELECT count(*) INTO v_expected_match_count
  FROM public.dhr_expected_parts
  WHERE analyzer_model = v_session.analyzer_model
    AND section_id = p_section_id
    AND upper(btrim(part_number)) = v_canonical_part;

  IF v_expected_match_count = 0 THEN
    RAISE EXCEPTION 'Part % is not configured for DHR model % section %',
      p_part_number, v_session.analyzer_model, p_section_id;
  ELSIF v_expected_match_count > 1 THEN
    RAISE EXCEPTION 'Ambiguous configured DHR part % for model % section %',
      p_part_number, v_session.analyzer_model, p_section_id;
  END IF;

  SELECT * INTO v_expected
  FROM public.dhr_expected_parts
  WHERE analyzer_model = v_session.analyzer_model
    AND section_id = p_section_id
    AND upper(btrim(part_number)) = v_canonical_part;

  v_canonical_part := upper(btrim(v_expected.part_number));
  v_expected_qty := v_expected.bom_qty;
  v_category := btrim(v_expected.category);
  v_description := v_expected.description;

  IF v_expected_qty IS NULL OR v_expected_qty < 0 THEN
    RAISE EXCEPTION 'Configured DHR expected quantity is invalid';
  END IF;
  IF v_category IS NULL OR v_category = '' THEN
    RAISE EXCEPTION 'Configured DHR category is invalid';
  END IF;

  SELECT count(*) INTO v_result_match_count
  FROM public.dhr_scan_results
  WHERE session_id = p_session_id
    AND section_id = p_section_id
    AND upper(btrim(part_number)) = v_canonical_part;
  IF v_result_match_count > 1 THEN
    RAISE EXCEPTION 'Ambiguous canonical DHR result for part %', p_part_number;
  END IF;

  SELECT * INTO v_result
  FROM public.dhr_scan_results
  WHERE session_id = p_session_id
    AND section_id = p_section_id
    AND upper(btrim(part_number)) = v_canonical_part
  FOR UPDATE;

  IF FOUND THEN
    v_previous_qty := coalesce(v_result.scanned_qty, 0);
    v_revision_before := coalesce(v_result.revision, 0);
  ELSE
    v_previous_qty := 0;
    v_revision_before := 0;
  END IF;

  IF v_revision_before <> p_expected_revision THEN
    RAISE EXCEPTION 'DHR revision conflict: expected %, current %',
      p_expected_revision, v_revision_before;
  END IF;

  v_delta := p_new_qty - v_previous_qty;
  v_revision_after := v_revision_before + 1;

  IF p_new_qty = 0 THEN v_status := 'pending';
  ELSIF p_new_qty = v_expected_qty THEN v_status := 'matched';
  ELSIF p_new_qty < v_expected_qty THEN v_status := 'short';
  ELSE v_status := 'over';
  END IF;

  IF lower(v_category) <> 'tool' THEN
    SELECT count(*) INTO v_stock_match_count
    FROM public.stock
    WHERE upper(btrim(part_number)) = v_canonical_part;
    IF v_stock_match_count = 0 THEN
      RAISE EXCEPTION 'Part not found: %', p_part_number;
    ELSIF v_stock_match_count > 1 THEN
      RAISE EXCEPTION 'Ambiguous canonical stock part: %', p_part_number;
    END IF;

    SELECT * INTO v_stock
    FROM public.stock
    WHERE upper(btrim(part_number)) = v_canonical_part
    FOR UPDATE;

    v_stock_before := coalesce(v_stock.qty_on_hand, 0);
    v_stock_after := v_stock_before;

    IF v_delta > 0 THEN
      v_mode := 'OUT';
      v_inventory := public.apply_inventory_transition(
        v_stock.part_number, v_mode, v_delta, p_actor, p_correlation_id,
        v_session.instrument_sn, p_session_id::text
      );
    ELSIF v_delta < 0 THEN
      v_mode := 'IN';
      v_inventory := public.apply_inventory_transition(
        v_stock.part_number, v_mode, abs(v_delta), p_actor, p_correlation_id,
        v_session.instrument_sn, p_session_id::text
      );
    END IF;

    IF v_inventory IS NOT NULL THEN
      v_stock_before := nullif(v_inventory ->> 'qtyBefore', '')::integer;
      v_stock_after := nullif(v_inventory ->> 'qtyAfter', '')::integer;
      v_audit_id := nullif(v_inventory ->> 'auditId', '')::uuid;
      v_sap_id := nullif(v_inventory ->> 'sapId', '')::uuid;
    END IF;
  END IF;

  IF v_result.id IS NULL THEN
    INSERT INTO public.dhr_scan_results(
      session_id, section_id, part_number, description, expected_qty,
      scanned_qty, category, status, stock_before, stock_after, stock_id,
      scanned_at, scanned_by, updated_at, revision
    ) VALUES (
      p_session_id, p_section_id, btrim(v_expected.part_number), v_description, v_expected_qty,
      p_new_qty, v_category, v_status, v_stock_before, v_stock_after, v_stock.id,
      now(), p_actor, now(), v_revision_after
    ) RETURNING * INTO v_result;
  ELSE
    UPDATE public.dhr_scan_results
    SET description = v_description,
        expected_qty = v_expected_qty,
        scanned_qty = p_new_qty,
        category = v_category,
        status = v_status,
        stock_before = v_stock_before,
        stock_after = v_stock_after,
        stock_id = CASE WHEN lower(v_category) = 'tool' THEN NULL ELSE v_stock.id END,
        scanned_at = now(),
        scanned_by = p_actor,
        updated_at = now(),
        revision = v_revision_after
    WHERE id = v_result.id
    RETURNING * INTO v_result;
  END IF;

  INSERT INTO public.dhr_scan_result_events(
    correlation_id, result_id, session_id, section_id, part_number,
    previous_qty, new_qty, delta, revision_before, revision_after,
    actor, inventory_mode, audit_id, sap_id
  ) VALUES (
    p_correlation_id, v_result.id, p_session_id, p_section_id, v_result.part_number,
    v_previous_qty, p_new_qty, v_delta, v_revision_before, v_revision_after,
    p_actor, v_mode, v_audit_id, v_sap_id
  ) RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true, 'duplicate', false, 'eventId', v_event_id, 'resultId', v_result.id,
    'sessionId', p_session_id, 'sectionId', p_section_id, 'partNumber', v_result.part_number,
    'previousQty', v_previous_qty, 'newQty', p_new_qty, 'delta', v_delta,
    'revisionBefore', v_revision_before, 'revisionAfter', v_revision_after, 'mode', v_mode,
    'stockBefore', v_stock_before, 'stockAfter', v_stock_after, 'auditId', v_audit_id,
    'sapId', v_sap_id, 'processedAt', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_dhr_scan_transition(
  uuid, text, text, integer, integer, text, text, text, text, integer, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_dhr_scan_transition(
  uuid, text, text, integer, integer, text, text, text, text, integer, text
) TO service_role;
