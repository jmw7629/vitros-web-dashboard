-- Atomic, server-only DHR scanner quantity transition foundation.
--
-- This migration is intentionally additive. It does not alter existing DHR rows,
-- post anything to SAP, or grant browser/anonymous access. The callable RPC is
-- restricted to service_role so browser callers must go through an authenticated
-- server action that derives the actor identity.

alter table public.dhr_scan_results
  add column if not exists revision integer not null default 0;

create table if not exists public.dhr_scan_result_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id text not null unique,
  result_id uuid not null references public.dhr_scan_results(id) on delete restrict,
  session_id uuid not null references public.dhr_scan_sessions(id) on delete restrict,
  section_id text not null,
  part_number text not null,
  previous_qty integer not null check (previous_qty >= 0),
  new_qty integer not null check (new_qty >= 0),
  delta integer not null,
  revision_before integer not null check (revision_before >= 0),
  revision_after integer not null check (revision_after > revision_before),
  actor text not null,
  inventory_mode text check (inventory_mode is null or inventory_mode in ('IN','OUT')),
  audit_id uuid null,
  sap_id uuid null,
  created_at timestamptz not null default now()
);

alter table public.dhr_scan_result_events enable row level security;
revoke all on table public.dhr_scan_result_events from public, anon, authenticated;

create or replace function public.block_dhr_scan_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'DHR scan event history is immutable';
end;
$$;

drop trigger if exists dhr_scan_result_events_immutable on public.dhr_scan_result_events;
create trigger dhr_scan_result_events_immutable
before update or delete on public.dhr_scan_result_events
for each row execute function public.block_dhr_scan_event_mutation();

create or replace function public.apply_dhr_scan_transition(
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
  p_analyzer_serial text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_event public.dhr_scan_result_events%rowtype;
  v_result public.dhr_scan_results%rowtype;
  v_stock public.stock%rowtype;
  v_previous_qty integer := 0;
  v_delta integer := 0;
  v_revision_before integer := 0;
  v_revision_after integer := 0;
  v_status text;
  v_mode text := null;
  v_inventory jsonb := null;
  v_stock_before integer := null;
  v_stock_after integer := null;
  v_audit_id uuid := null;
  v_sap_id uuid := null;
  v_event_id uuid;
  v_canonical_part text;
  v_result_match_count integer := 0;
  v_stock_match_count integer := 0;
begin
  if p_session_id is null then
    raise exception 'sessionId is required';
  end if;
  if p_section_id is null or btrim(p_section_id) = '' then
    raise exception 'sectionId is required';
  end if;
  if p_part_number is null or btrim(p_part_number) = '' then
    raise exception 'partNumber is required';
  end if;
  if p_expected_qty is null or p_expected_qty < 0 then
    raise exception 'expected quantity must be zero or greater';
  end if;
  if p_new_qty is null or p_new_qty < 0 then
    raise exception 'scanned quantity must be zero or greater';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'expected revision must be zero or greater';
  end if;
  if p_category is null or btrim(p_category) = '' then
    raise exception 'category is required';
  end if;
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'actor is required';
  end if;
  if p_correlation_id is null or btrim(p_correlation_id) = '' then
    raise exception 'correlationId is required';
  end if;

  v_canonical_part := upper(btrim(p_part_number));

  -- Serialize globally on the idempotency key first, then on the logical DHR
  -- field. The field lock exists even before a result row does, which closes the
  -- concurrent-first-write race that a row lock alone cannot prevent.
  perform pg_advisory_xact_lock(hashtextextended('dhr-correlation|' || p_correlation_id, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'dhr-field|' || p_session_id::text || '|' || p_section_id || '|' || v_canonical_part,
    0
  ));

  -- Retry of an already committed event returns the original receipt and never
  -- moves stock again, even if the DHR row has since advanced to a newer revision.
  -- Reusing a correlation id for different intent is rejected rather than
  -- disclosing or aliasing another DHR event.
  select * into v_existing_event
  from public.dhr_scan_result_events
  where correlation_id = p_correlation_id;

  if found then
    if v_existing_event.session_id <> p_session_id
      or v_existing_event.section_id <> p_section_id
      or upper(btrim(v_existing_event.part_number)) <> v_canonical_part
      or v_existing_event.new_qty <> p_new_qty then
      raise exception 'correlationId already used for a different DHR event';
    end if;

    return jsonb_build_object(
      'success', true,
      'duplicate', true,
      'eventId', v_existing_event.id,
      'resultId', v_existing_event.result_id,
      'sessionId', v_existing_event.session_id,
      'sectionId', v_existing_event.section_id,
      'partNumber', v_existing_event.part_number,
      'previousQty', v_existing_event.previous_qty,
      'newQty', v_existing_event.new_qty,
      'delta', v_existing_event.delta,
      'revisionBefore', v_existing_event.revision_before,
      'revisionAfter', v_existing_event.revision_after,
      'mode', v_existing_event.inventory_mode,
      'auditId', v_existing_event.audit_id,
      'sapId', v_existing_event.sap_id,
      'processedAt', v_existing_event.created_at
    );
  end if;

  -- Fail closed if historic data contains more than one canonical DHR result.
  -- The raw unique constraint is case/whitespace sensitive, so ambiguity must not
  -- be silently resolved by SELECT INTO.
  select count(*) into v_result_match_count
  from public.dhr_scan_results
  where session_id = p_session_id
    and section_id = p_section_id
    and upper(btrim(part_number)) = v_canonical_part;

  if v_result_match_count > 1 then
    raise exception 'Ambiguous canonical DHR result for part %', p_part_number;
  end if;

  select * into v_result
  from public.dhr_scan_results
  where session_id = p_session_id
    and section_id = p_section_id
    and upper(btrim(part_number)) = v_canonical_part
  for update;

  if found then
    v_previous_qty := coalesce(v_result.scanned_qty, 0);
    v_revision_before := coalesce(v_result.revision, 0);
  else
    v_previous_qty := 0;
    v_revision_before := 0;
  end if;

  if v_revision_before <> p_expected_revision then
    raise exception 'DHR revision conflict: expected %, current %', p_expected_revision, v_revision_before;
  end if;

  v_delta := p_new_qty - v_previous_qty;
  v_revision_after := v_revision_before + 1;

  if p_new_qty = 0 then
    v_status := 'pending';
  elsif p_new_qty = p_expected_qty then
    v_status := 'matched';
  elsif p_new_qty < p_expected_qty then
    v_status := 'short';
  else
    v_status := 'over';
  end if;

  -- Tools/non-consumables update checklist state only. Consumable deltas use the
  -- existing audited/idempotent inventory primitive inside this same transaction,
  -- making stock + audit + SAP staging + DHR state all-or-nothing.
  if lower(p_category) <> 'tool' then
    -- Production currently contains a quarantined legacy canonical collision.
    -- Never select an arbitrary stock row when a canonical key is ambiguous.
    select count(*) into v_stock_match_count
    from public.stock
    where upper(btrim(part_number)) = v_canonical_part;

    if v_stock_match_count = 0 then
      raise exception 'Part not found: %', p_part_number;
    elsif v_stock_match_count > 1 then
      raise exception 'Ambiguous canonical stock part: %', p_part_number;
    end if;

    select * into v_stock
    from public.stock
    where upper(btrim(part_number)) = v_canonical_part
    for update;

    v_stock_before := coalesce(v_stock.qty_on_hand, 0);
    v_stock_after := v_stock_before;

    if v_delta > 0 then
      v_mode := 'OUT';
      v_inventory := public.apply_inventory_transition(
        v_stock.part_number,
        v_mode,
        v_delta,
        p_actor,
        p_correlation_id,
        p_analyzer_serial,
        p_session_id::text
      );
    elsif v_delta < 0 then
      v_mode := 'IN';
      v_inventory := public.apply_inventory_transition(
        v_stock.part_number,
        v_mode,
        abs(v_delta),
        p_actor,
        p_correlation_id,
        p_analyzer_serial,
        p_session_id::text
      );
    end if;

    if v_inventory is not null then
      v_stock_before := nullif(v_inventory ->> 'qtyBefore', '')::integer;
      v_stock_after := nullif(v_inventory ->> 'qtyAfter', '')::integer;
      v_audit_id := nullif(v_inventory ->> 'auditId', '')::uuid;
      v_sap_id := nullif(v_inventory ->> 'sapId', '')::uuid;
    end if;
  end if;

  if v_result.id is null then
    insert into public.dhr_scan_results(
      session_id, section_id, part_number, description, expected_qty,
      scanned_qty, category, status, stock_before, stock_after, stock_id,
      scanned_at, scanned_by, updated_at, revision
    ) values (
      p_session_id, p_section_id, btrim(p_part_number), p_description, p_expected_qty,
      p_new_qty, p_category, v_status, v_stock_before, v_stock_after, v_stock.id,
      now(), p_actor, now(), v_revision_after
    )
    returning * into v_result;
  else
    update public.dhr_scan_results
    set description = p_description,
        expected_qty = p_expected_qty,
        scanned_qty = p_new_qty,
        category = p_category,
        status = v_status,
        stock_before = v_stock_before,
        stock_after = v_stock_after,
        stock_id = case when lower(p_category) = 'tool' then null else v_stock.id end,
        scanned_at = now(),
        scanned_by = p_actor,
        updated_at = now(),
        revision = v_revision_after
    where id = v_result.id
    returning * into v_result;
  end if;

  insert into public.dhr_scan_result_events(
    correlation_id, result_id, session_id, section_id, part_number,
    previous_qty, new_qty, delta, revision_before, revision_after,
    actor, inventory_mode, audit_id, sap_id
  ) values (
    p_correlation_id, v_result.id, p_session_id, p_section_id, v_result.part_number,
    v_previous_qty, p_new_qty, v_delta, v_revision_before, v_revision_after,
    p_actor, v_mode, v_audit_id, v_sap_id
  ) returning id into v_event_id;

  return jsonb_build_object(
    'success', true,
    'duplicate', false,
    'eventId', v_event_id,
    'resultId', v_result.id,
    'sessionId', p_session_id,
    'sectionId', p_section_id,
    'partNumber', v_result.part_number,
    'previousQty', v_previous_qty,
    'newQty', p_new_qty,
    'delta', v_delta,
    'revisionBefore', v_revision_before,
    'revisionAfter', v_revision_after,
    'mode', v_mode,
    'stockBefore', v_stock_before,
    'stockAfter', v_stock_after,
    'auditId', v_audit_id,
    'sapId', v_sap_id,
    'processedAt', now()
  );
end;
$$;

revoke all on function public.apply_dhr_scan_transition(
  uuid, text, text, integer, integer, text, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.apply_dhr_scan_transition(
  uuid, text, text, integer, integer, text, text, text, text, integer, text
) to service_role;
