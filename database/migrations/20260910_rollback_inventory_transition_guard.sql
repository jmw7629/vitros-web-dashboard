-- Guarded rollback for public.apply_inventory_transition
-- Run on a DISPOSABLE test database (no pre-existing durable history).
-- On a clean DB with no inventory_operations rows, the rollback succeeds.
-- On any DB with existing inventory_operations rows, audit_log entries, or sap_staging rows,
-- the rollback aborts and raises an exception, preserving the authoritative ledger.

\set ON_ERROR_STOP on

\echo 'ROLLBACK GUARD: Check for durable history before allowing rollback'
do $$
declare
  v_op_count integer;
  v_audit_count integer;
  v_sap_count integer;
begin
  select count(*) into v_op_count from public.inventory_operations;
  select count(*) into v_audit_count from public.audit_log;
  select count(*) into v_sap_count from public.sap_staging;

  if v_op_count > 0 then
    raise exception 'ROLLBACK ABORT: durable inventory_operations history exists (%, row(s)). Cannot rollback migration that has been applied.', v_op_count;
  end if;
  if v_audit_count > 0 then
    raise exception 'ROLLBACK ABORT: durable audit_log history exists (%, row(s)). Cannot rollback migration that has been applied.', v_audit_count;
  end if;
  if v_sap_count > 0 then
    raise exception 'ROLLBACK ABORT: durable sap_staging history exists (%, row(s)). Cannot rollback migration that has been applied.', v_sap_count;
  end if;

  raise notice 'ROLLBACK GUARD: Clean database detected - rollback permitted';
end $$;

\echo 'ROLLBACK GUARD: Attempt safe function drop'
do $$
declare
  v_oid oid;
begin
  -- Only drop if no durable history (checked above). This block runs only on clean DB.
  drop function if exists public.apply_inventory_transition(text,text,integer,text,text,text,text);
  raise notice 'ROLLBACK GUARD: Function dropped successfully on clean database';
end $$;

\echo 'ROLLBACK GUARD: Attempt table column removal'
do $$
declare
begin
  -- Only run on clean DB where rollback is permitted
  alter table public.inventory_operations drop column if exists requested_batch_id;
  alter table public.inventory_operations drop column if exists requested_analyzer_serial;
  raise notice 'ROLLBACK GUARD: Extended columns removed successfully on clean database';
end $$;

\echo 'ROLLBACK GUARD: Complete - clean DB rollback succeeded; any DB with history refuses rollback.'