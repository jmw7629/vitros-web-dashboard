-- VITROS #86: reconcile the one quarantined legacy canonical collision J32133/J32133<space>.
--
-- Safety model:
-- - canonical identity is UPPER(BTRIM(part_number));
-- - preserve the canonical J32133 row as the survivor;
-- - the trailing-space duplicate may be retired only while its QOH is exactly zero;
-- - fail closed if any active/master/operational reference still points to the trailing raw key
--   or to its stock UUID;
-- - preserve all historical audit rows unchanged and add an explicit reconciliation audit event;
-- - after reconciliation, replace the temporary J32133 exception with unconditional canonical
--   uniqueness for all stock rows.
--
-- This migration must run transactionally. Any failed assertion aborts the entire migration.

LOCK TABLE public.stock IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_canonical_count integer;
  v_survivor public.stock%ROWTYPE;
  v_duplicate public.stock%ROWTYPE;
  v_reference_count bigint;
BEGIN
  SELECT count(*)
    INTO v_canonical_count
    FROM public.stock
   WHERE upper(btrim(part_number)) = 'J32133';

  -- Idempotent rerun after a successful reconciliation: keep validating that the survivor is
  -- canonical, then let the index replacement below converge to the final invariant.
  IF v_canonical_count = 1 THEN
    IF NOT EXISTS (SELECT 1 FROM public.stock WHERE part_number = 'J32133') THEN
      RAISE EXCEPTION 'J32133 reconciliation cannot continue: sole canonical row is not raw J32133';
    END IF;
    RETURN;
  END IF;

  IF v_canonical_count <> 2 THEN
    RAISE EXCEPTION 'J32133 reconciliation requires exactly two canonical rows; found %', v_canonical_count;
  END IF;

  SELECT * INTO STRICT v_survivor
    FROM public.stock
   WHERE part_number = 'J32133'
   FOR UPDATE;

  SELECT * INTO STRICT v_duplicate
    FROM public.stock
   WHERE part_number = 'J32133 '
   FOR UPDATE;

  IF v_duplicate.qty_on_hand <> 0 THEN
    RAISE EXCEPTION 'J32133 trailing-space duplicate QOH must be zero before retirement; found %', v_duplicate.qty_on_hand;
  END IF;

  -- Mutable/master/operational references must be absent before the duplicate master is retired.
  -- Immutable audit_log history is intentionally excluded and preserved exactly as recorded.
  SELECT
      (SELECT count(*) FROM public.consume_stock_log WHERE part_number = 'J32133 ')
    + (SELECT count(*) FROM public.incoming_stock_log WHERE part_number = 'J32133 ')
    + (SELECT count(*) FROM public.inventory_batch_lines WHERE part_number = 'J32133 ')
    + (SELECT count(*) FROM public.kit_components WHERE part_number = 'J32133 ')
    + (SELECT count(*) FROM public.shortages WHERE part_number = 'J32133 ')
    + (SELECT count(*) FROM public.stocking_plan WHERE part_number = 'J32133 ')
    + (SELECT count(*) FROM public.dhr_expected_parts WHERE part_number = 'J32133 ')
    + (SELECT count(*) FROM public.dhr_scan_results WHERE part_number = 'J32133 ' OR stock_id = v_duplicate.id)
    + (SELECT count(*) FROM public.dhr_scan_result_events WHERE part_number = 'J32133 ')
    + (SELECT count(*) FROM public.inventory_operations WHERE part_number = 'J32133 ')
    + (SELECT count(*) FROM public.sap_staging WHERE part_number = 'J32133 ')
    + (SELECT count(*) FROM public.error_queue WHERE part_number = 'J32133 ')
    INTO v_reference_count;

  IF v_reference_count <> 0 THEN
    RAISE EXCEPTION 'J32133 trailing-space duplicate still has % active/master/operational references', v_reference_count;
  END IF;

  -- Preserve an explicit immutable reconciliation record in addition to the stock DELETE audit
  -- trigger. The fixed correlation id makes a rerun observable and idempotent.
  INSERT INTO public.audit_log (
    action,
    entity_type,
    entity_id,
    part_number,
    user_name,
    details,
    old_value,
    new_value,
    correlation_id
  )
  SELECT
    'CANONICAL_RECONCILIATION',
    'stock',
    v_survivor.id::text,
    'J32133',
    'system',
    jsonb_build_object(
      'canonical_rule', 'UPPER(BTRIM(part_number))',
      'survivor_stock_id', v_survivor.id,
      'retired_stock_id', v_duplicate.id,
      'retired_raw_part_number', v_duplicate.part_number,
      'qoh_preserved', v_survivor.qty_on_hand + v_duplicate.qty_on_hand,
      'reason', 'Retire zero-QOH trailing-space duplicate after reference inventory proved no active dependencies'
    ),
    to_jsonb(v_duplicate),
    to_jsonb(v_survivor),
    'canonical-reconciliation:J32133:v1'
  WHERE NOT EXISTS (
    SELECT 1
      FROM public.audit_log
     WHERE correlation_id = 'canonical-reconciliation:J32133:v1'
  );

  DELETE FROM public.stock
   WHERE id = v_duplicate.id;

  IF (SELECT count(*) FROM public.stock WHERE upper(btrim(part_number)) = 'J32133') <> 1 THEN
    RAISE EXCEPTION 'J32133 reconciliation failed to leave exactly one canonical stock master';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.stock
     WHERE id = v_survivor.id
       AND part_number = 'J32133'
       AND qty_on_hand = v_survivor.qty_on_hand
  ) THEN
    RAISE EXCEPTION 'J32133 survivor/QOH changed unexpectedly during reconciliation';
  END IF;
END;
$$;

DROP INDEX IF EXISTS public.stock_part_number_canonical_unique_except_legacy_j32133;

CREATE UNIQUE INDEX IF NOT EXISTS stock_part_number_canonical_unique
  ON public.stock ((upper(btrim(part_number))));

COMMENT ON INDEX public.stock_part_number_canonical_unique IS
  'Canonical stock identity: one row per UPPER(BTRIM(part_number)); J32133 legacy exception reconciled by #86.';
