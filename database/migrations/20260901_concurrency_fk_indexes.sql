-- VITROS concurrency hardening: additive indexes for foreign-key lookup paths.
--
-- Scope is intentionally limited to index creation. This migration does not
-- modify business data, RLS, grants, triggers, functions, or application logic.
-- Existing composite unique indexes are retained; standalone indexes below are
-- needed where the foreign-key column is not the leading column of that index.

CREATE INDEX IF NOT EXISTS inventory_batch_lines_part_number_idx
  ON public.inventory_batch_lines (part_number);

CREATE INDEX IF NOT EXISTS kit_components_part_number_idx
  ON public.kit_components (part_number);

CREATE INDEX IF NOT EXISTS sap_post_log_staging_id_idx
  ON public.sap_post_log (staging_id);

CREATE INDEX IF NOT EXISTS shortages_part_number_idx
  ON public.shortages (part_number);

CREATE INDEX IF NOT EXISTS stocking_plan_part_number_idx
  ON public.stocking_plan (part_number);

CREATE INDEX IF NOT EXISTS transaction_reversals_original_audit_id_idx
  ON public.transaction_reversals (original_audit_id);

CREATE INDEX IF NOT EXISTS transaction_reversals_reversal_audit_id_idx
  ON public.transaction_reversals (reversal_audit_id);
