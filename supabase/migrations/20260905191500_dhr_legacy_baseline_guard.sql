-- Fail closed on legacy DHR scan-result baselines that predate the immutable
-- inventory-event chain. Production currently contains historical positive
-- scan-result rows with no dhr_scan_result_events provenance. Treating those
-- values as an already-consumed baseline would under-consume inventory when a
-- user later edits the same row. This trigger makes that impossible.
--
-- This migration does not change existing business rows and does not reconcile
-- or post anything. Legacy rows remain readable and their session can still be
-- finalized/reopened; a new scanner quantity revision is blocked until an
-- explicit, separately reviewed reconciliation decision establishes provenance.

CREATE OR REPLACE FUNCTION public.guard_dhr_legacy_inventory_baseline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(OLD.scanned_qty, 0) > 0
     AND (
       NEW.scanned_qty IS DISTINCT FROM OLD.scanned_qty
       OR NEW.revision IS DISTINCT FROM OLD.revision
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.dhr_scan_result_events AS event
       WHERE event.result_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'Legacy DHR result requires inventory reconciliation before scanner mutation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dhr_legacy_inventory_baseline_guard
  ON public.dhr_scan_results;

CREATE TRIGGER dhr_legacy_inventory_baseline_guard
BEFORE UPDATE OF scanned_qty, revision
ON public.dhr_scan_results
FOR EACH ROW
EXECUTE FUNCTION public.guard_dhr_legacy_inventory_baseline();

REVOKE ALL ON FUNCTION public.guard_dhr_legacy_inventory_baseline()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_dhr_legacy_inventory_baseline()
  TO service_role;
