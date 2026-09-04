-- VITROS #74 containment: block creation of canonical duplicate part numbers
-- while preserving the one known legacy collision for separate audited reconciliation.
--
-- Canonicalization rule: UPPER(BTRIM(part_number)).
-- The partial unique index is the concurrency authority for every canonical key except
-- J32133, whose two legacy rows pre-date this migration. The trigger blocks all new
-- J32133 variants and provides a deterministic duplicate error while allowing unrelated
-- updates to the legacy rows until reconciliation is reviewed.

CREATE UNIQUE INDEX IF NOT EXISTS stock_part_number_canonical_unique_except_legacy_j32133
  ON public.stock ((upper(btrim(part_number))))
  WHERE upper(btrim(part_number)) <> 'J32133';

CREATE OR REPLACE FUNCTION public.enforce_stock_canonical_part_number_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_canonical text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.part_number IS NOT DISTINCT FROM OLD.part_number THEN
    RETURN NEW;
  END IF;

  v_canonical := upper(btrim(NEW.part_number));

  IF v_canonical IS NULL OR v_canonical = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Part number is required',
      CONSTRAINT = 'stock_part_number_required_guard';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1
      FROM public.stock AS s
      WHERE upper(btrim(s.part_number)) = v_canonical
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Part number already exists',
        DETAIL = 'Canonical part number ' || v_canonical || ' already exists.',
        CONSTRAINT = 'stock_part_number_canonical_guard';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM public.stock AS s
      WHERE upper(btrim(s.part_number)) = v_canonical
        AND s.id <> OLD.id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Part number already exists',
        DETAIL = 'Canonical part number ' || v_canonical || ' already exists.',
        CONSTRAINT = 'stock_part_number_canonical_guard';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_canonical_part_number_unique_guard ON public.stock;
CREATE TRIGGER stock_canonical_part_number_unique_guard
BEFORE INSERT OR UPDATE OF part_number ON public.stock
FOR EACH ROW
EXECUTE FUNCTION public.enforce_stock_canonical_part_number_guard();
