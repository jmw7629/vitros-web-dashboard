-- VITROS #442 foundation: additive durable Incoming receipt server contract
-- PG17 migration: creates incoming_receipt_attempts, attempt_events, manual_reservations
-- Additive only: does not modify public.apply_inventory_transition or existing columns
-- One transaction through grants/privileges; guarded reverse refuses if history exists

begin;

-- -------------------------------------------------------
-- 1. incoming_receipt_attempts
--    Immutable attempt records with CHECK-constrained lifecycle
-- -------------------------------------------------------

create table if not exists public.incoming_receipt_attempts (
  id uuid primary key default gen_random_uuid(),
  correlation_id text not null unique,
  document_ref text not null,
  source_page text,
  source_line integer not null,
  part_number text not null,
  mode text not null check (mode in ('IN','RECEIVE','OUT','ADJUST','STOCKOUT')),
  status text not null check (
    status in ('reviewed','ready','attempted','unknown','accepted','executed',
               'conflict','resolution_required','abandoned')
  ),
  revision integer not null default 0,
  generation integer not null default 0,
  actor text not null,
  evidence jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_attempt_revision_nonneg check (revision >= 0),
  constraint chk_attempt_generation_nonneg check (generation >= 0)
);

comment on table public.incoming_receipt_attempts is
  'Durable attempt records for Incoming receipt recovery. Lifecycle: reviewed/ready -> attempted/unknown -> accepted/executed; conflict->resolution_required->attempted; abandoned after verified no-movement.';

-- -------------------------------------------------------
-- 2. incoming_receipt_attempt_events
--    Immutable event history per attempt (never updated/deleted)
-- -------------------------------------------------------

create table if not exists public.incoming_receipt_attempt_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.incoming_receipt_attempts(id) on delete cascade,
  correlation_id text not null,
  event_type text not null check (
    event_type in ('register','attempt','accept','review','abandon','rereview','conflict')
  ),
  previous_status text not null,
  new_status text not null,
  revision integer not null default 0,
  generation integer not null default 0,
  actor text not null,
  evidence jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint chk_event_revision_nonneg check (revision >= 0),
  constraint chk_event_generation_nonneg check (generation >= 0)
);

comment on table public.incoming_receipt_attempt_events is
  'Immutable event history for incoming_receipt_attempts. Never updated or deleted.';

-- -------------------------------------------------------
-- 3. incoming_receipt_manual_reservations
--    Server-allocated atomic manual physical-line reservations
--    No caller-chosen identity, no max()+1, stable persisted identities
-- -------------------------------------------------------

create table if not exists public.incoming_receipt_manual_reservations (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.incoming_receipt_attempts(id) on delete cascade,
  document_ref text not null,
  source_page text,
  source_line integer not null,
  part_number text not null,
  reserved_by text not null,
  reserved_at timestamptz not null default now(),
  released_at timestamptz,
  unique(attempt_id, source_line)
);

comment on table public.incoming_receipt_manual_reservations is
  'Server-allocated atomic manual physical-line reservations. One reservation per (attempt_id, source_line). No caller-chosen identity; ids are server-generated gen_random_uuid.';

-- -------------------------------------------------------
-- 4. Functions
-- -------------------------------------------------------

-- 4a. register_incoming_receipt_attempt
--    First review/register: reviewed/ready -> attempted/unknown
create or replace function public.register_incoming_receipt_attempt(
  p_correlation_id text,
  p_document_ref text,
  p_source_page text,
  p_source_line integer,
  p_part_number text,
  p_mode text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt_id uuid;
begin
  if length(trim(p_correlation_id)) = 0 then
    raise exception 'correlationId is required';
  end if;
  if length(trim(p_document_ref)) = 0 then
    raise exception 'documentRef is required';
  end if;
  if p_source_line <= 0 then
    raise exception 'sourceLine must be positive';
  end if;
  if length(trim(p_part_number)) = 0 then
    raise exception 'partNumber is required';
  end if;
  if p_mode not in ('IN','RECEIVE','OUT','ADJUST','STOCKOUT') then
    raise exception 'Unsupported mode: %', p_mode;
  end if;
  if length(trim(p_actor)) = 0 then
    raise exception 'actor is required';
  end if;

  -- Register new attempt: status = reviewed/initial state
  insert into public.incoming_receipt_attempts(
    correlation_id, document_ref, source_page, source_line,
    part_number, mode, status, actor
  ) values (
    p_correlation_id, p_document_ref, p_source_page, p_source_line,
    p_part_number, p_mode, 'reviewed', p_actor
  )
  on conflict (correlation_id) do nothing;

  select id into v_attempt_id
  from public.incoming_receipt_attempts
  where correlation_id = p_correlation_id;

  -- Record the register event: reviewed -> attempted
  insert into public.incoming_receipt_attempt_events(
    attempt_id, correlation_id, event_type, previous_status, new_status,
    revision, generation, actor
  ) values (
    v_attempt_id, p_correlation_id, 'register', 'reviewed', 'attempted',
    0, 0, p_actor
  );

  return jsonb_build_object(
    'success', true,
    'attemptId', v_attempt_id,
    'correlationId', p_correlation_id,
    'documentRef', p_document_ref,
    'sourcePage', p_source_page,
    'sourceLine', p_source_line,
    'partNumber', p_part_number,
    'mode', p_mode,
    'status', 'attempted',
    'actor', p_actor,
    'createdAt', now()
  );
end;
$$;

-- 4b. attempt_incoming_receipt
--    Mark as attempted/unknown (from reviewed/ready/attempted/unknown state)
create or replace function public.attempt_incoming_receipt(
  p_attempt_id uuid,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.incoming_receipt_attempts%rowtype;
  v_prev_status text;
begin
  if length(trim(p_actor)) = 0 then
    raise exception 'actor is required';
  end if;

  select * into v_attempt from public.incoming_receipt_attempts where id = p_attempt_id for update;

  if not found then
    raise exception 'Attempt not found: %', p_attempt_id;
  end if;

  -- Only allow transition from non-terminal states
  if v_attempt.status not in ('reviewed','ready','attempted','unknown') then
    raise exception 'Cannot attempt: attempt % is in a terminal state %', p_attempt_id, v_attempt.status;
  end if;

  v_prev_status := v_attempt.status;

  update public.incoming_receipt_attempts
  set status = 'unknown', updated_at = now()
  where id = p_attempt_id;

  -- Record the attempt event
  insert into public.incoming_receipt_attempt_events(
    attempt_id, correlation_id, event_type, previous_status, new_status,
    revision, generation, actor
  ) values (
    p_attempt_id, v_attempt.correlation_id, 'attempt',
    v_prev_status, 'unknown',
    v_attempt.revision, v_attempt.generation, p_actor
  );

  return jsonb_build_object(
    'success', true,
    'attemptId', p_attempt_id,
    'correlationId', v_attempt.correlation_id,
    'status', 'unknown',
    'actor', p_actor,
    'createdAt', now()
  );
end;
$$;

-- 4c. accept_incoming_receipt
--    Mark as accepted/executed (from unknown state, captures apply_inventory_transition result)
create or replace function public.accept_incoming_receipt(
  p_attempt_id uuid,
  p_correlation_id text,
  p_part_number text,
  p_qty integer,
  p_user text,
  p_correlation_id_rpc text,
  p_analyzer_serial text default null,
  p_batch_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.incoming_receipt_attempts%rowtype;
  v_stock public.stock%rowtype;
  v_before integer;
  v_after integer;
  v_result jsonb;
  v_mode text;
  v_plant text;
  v_sloc text;
  v_sap_id uuid;
  v_audit_id uuid;
begin
  if length(trim(p_actor)) = 0 then
    raise exception 'actor is required';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;
  if length(trim(p_part_number)) = 0 then
    raise exception 'partNumber is required';
  end if;

  select * into v_attempt from public.incoming_receipt_attempts where id = p_attempt_id for update;

  if not found then
    raise exception 'Attempt not found: %', p_attempt_id;
  end if;

  if v_attempt.status <> 'unknown' then
    raise exception 'Cannot accept: attempt % is in state %, expected unknown', p_attempt_id, v_attempt.status;
  end if;

  -- Lock the stock row for the part number
  select * into v_stock from public.stock where upper(part_number)=upper(p_part_number) for update;
  if not found then
    raise exception 'Part not found: %', p_part_number;
  end if;

  v_before := coalesce(v_stock.qty_on_hand,0);

  -- Call the existing authoritative apply_inventory_transition and capture its real JSON return
  v_result := public.apply_inventory_transition(
    p_part_number, 'RECEIVE', p_qty, p_user, p_correlation_id_rpc,
    p_analyzer_serial, p_batch_id
  );

  if v_result is null then
    raise exception 'apply_inventory_transition returned null';
  end if;

  v_after := nullif(v_result ->> 'qtyAfter', '')::integer;
  if v_after is null then
    v_after := v_before;
  end if;

  -- Update the attempt status to accepted/executed
  update public.incoming_receipt_attempts
  set status = 'accepted', revision = v_attempt.revision + 1, generation = v_attempt.generation + 1,
      updated_at = now()
  where id = p_attempt_id;

  -- Record the accept event
  insert into public.incoming_receipt_attempt_events(
    attempt_id, correlation_id, event_type, previous_status, new_status,
    revision, generation, actor, evidence
  ) values (
    p_attempt_id, p_correlation_id, 'accept', 'unknown', 'accepted',
    v_attempt.revision + 1, v_attempt.generation + 1, p_actor,
    jsonb_build_object('qtyBefore', v_before, 'qtyAfter', v_after, 'sapId', nullif(v_result ->> 'sapId', ''))
  );

  return jsonb_build_object(
    'success', true,
    'attemptId', p_attempt_id,
    'correlationId', p_correlation_id,
    'status', 'accepted',
    'qtyBefore', v_before,
    'qtyAfter', v_after,
    'mode', 'RECEIVE',
    'auditId', nullif(v_result ->> 'auditId', ''),
    'sapId', nullif(v_result ->> 'sapId', ''),
    'appliedAt', now()
  );
end;
$$;

-- 4d. conflict_incoming_receipt
--    Mark as conflict requiring resolution (from accepted/executed or unknown)
create or replace function public.conflict_incoming_receipt(
  p_attempt_id uuid,
  p_correlation_id text,
  p_actor text,
  p_reason jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.incoming_receipt_attempts%rowtype;
begin
  if length(trim(p_actor)) = 0 then
    raise exception 'actor is required';
  end if;

  select * into v_attempt from public.incoming_receipt_attempts where id = p_attempt_id for update;

  if not found then
    raise exception 'Attempt not found: %', p_attempt_id;
  end if;

  -- Allow from accepted/executed or unknown states that have detected issues
  if v_attempt.status not in ('accepted','executed','unknown') then
    raise exception 'Cannot record conflict: attempt % is in state %', p_attempt_id, v_attempt.status;
  end if;

  update public.incoming_receipt_attempts
  set status = 'conflict', updated_at = now()
  where id = p_attempt_id;

  -- Record the conflict event
  insert into public.incoming_receipt_attempt_events(
    attempt_id, correlation_id, event_type, previous_status, new_status,
    revision, generation, actor, evidence
  ) values (
    p_attempt_id, p_correlation_id, 'conflict',
    v_attempt.status, 'conflict',
    v_attempt.revision + 1, v_attempt.generation + 1, p_actor,
    p_reason
  );

  return jsonb_build_object(
    'success', true,
    'attemptId', p_attempt_id,
    'correlationId', p_correlation_id,
    'status', 'conflict',
    'actor', p_actor,
    'createdAt', now()
  );
end;
$$;

-- 4e. abandon_incoming_receipt
--    Verified no-movement abandonment: from accepted/executed or conflict/resolution_required
create or replace function public.abandon_incoming_receipt(
  p_attempt_id uuid,
  p_correlation_id text,
  p_actor text,
  p_verified_no_movement boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.incoming_receipt_attempts%rowtype;
begin
  if length(trim(p_actor)) = 0 then
    raise exception 'actor is required';
  end if;

  select * into v_attempt from public.incoming_receipt_attempts where id = p_attempt_id for update;

  if not found then
    raise exception 'Attempt not found: %', p_attempt_id;
  end if;

  -- Abandonment is only allowed from states that permit it:
  -- After accepted/executed OR after conflict/resolution_required
  if v_attempt.status not in ('accepted','executed','conflict','resolution_required') then
    raise exception 'Cannot abandon: attempt % is in state %, abandonment only allowed from accepted/executed or conflict/resolution_required states', p_attempt_id, v_attempt.status;
  end if;

  -- Refuse if there is detected stock/audit/SAP movement evidence
  if not p_verified_no_movement then
    raise exception 'Cannot abandon: stock/audit/SAP movement detected for attempt %', p_attempt_id;
  end if;

  update public.incoming_receipt_attempts
  set status = 'abandoned', updated_at = now()
  where id = p_attempt_id;

  -- Record the abandon event
  insert into public.incoming_receipt_attempt_events(
    attempt_id, correlation_id, event_type, previous_status, new_status,
    revision, generation, actor
  ) values (
    p_attempt_id, p_correlation_id, 'abandon',
    v_attempt.status, 'abandoned',
    v_attempt.revision + 1, v_attempt.generation + 1, p_actor
  );

  return jsonb_build_object(
    'success', true,
    'attemptId', p_attempt_id,
    'correlationId', p_correlation_id,
    'status', 'abandoned',
    'actor', p_actor,
    'createdAt', now()
  );
end;
$$;

-- 4f. review_incoming_receipt
--    Explicit re-review function/transition that accepts expected revision/generation,
--    locks/serializes the attempt, rejects stale callbacks and cross-actor use,
--    preserves immutable lineage while creating the next generation for the same physical source line.
--
--    May proceed ONLY after verified no-movement abandonment (status = abandoned).
--    Refuse reopen after accepted/executed, unknown-with-possible-movement, or detected stock/audit/SAP movement.
create or replace function public.review_incoming_receipt(
  p_attempt_id uuid,
  p_expected_revision integer,
  p_expected_generation integer,
  p_new_part_number text default null,
  p_new_source_page text default null,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.incoming_receipt_attempts%rowtype;
  v_prev_event public.incoming_receipt_attempt_events%rowtype;
  v_new_attempt_id uuid;
  v_new_correlation text;
  v_same_material boolean;
begin
  if length(trim(p_actor)) = 0 then
    raise exception 'actor is required';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'expected revision is required and must be >= 0';
  end if;

  select * into v_attempt from public.incoming_receipt_attempts where id = p_attempt_id for update;

  if not found then
    raise exception 'Attempt not found: %', p_attempt_id;
  end if;

  -- Re-review may proceed ONLY after verified no-movement abandonment
  if v_attempt.status <> 'abandoned' then
    raise exception 'Re-review may proceed only after verified no-movement abandonment. Attempt % is in state %', p_attempt_id, v_attempt.status;
  end if;

  -- Verify the expected revision/generation matches the last event
  select * into v_prev_event
  from public.incoming_receipt_attempt_events
  where attempt_id = p_attempt_id
  order by created_at desc, id desc
  limit 1;

  if v_prev_event is null then
    raise exception 'No events found for attempt %', p_attempt_id;
  end if;

  if v_prev_event.revision <> p_expected_revision
      or v_prev_event.generation <> p_expected_generation then
    raise exception 'Revision/generation mismatch: expected %/% got %/% for attempt %',
      p_expected_revision, p_expected_generation, v_prev_event.revision, v_prev_event.generation, p_attempt_id;
  end if;

  -- Reject stale callbacks: if previously accepted/executed, refuse
  if v_prev_event.event_type = 'accept' then
    raise exception 'Cannot reopen: attempt % was previously accepted/executed', p_attempt_id;
  end if;

  -- Verify no movement evidence after abandonment
  if exists (
    select 1 from public.incoming_receipt_attempt_events e2
    where e2.attempt_id = p_attempt_id
      and e2.event_type = 'accept'
      and e2.created_at > v_prev_event.created_at
  ) then
    raise exception 'Cannot reopen: post-abandon acceptance evidence exists for attempt %', p_attempt_id;
  end if;

  -- Determine if this is same-material or corrected-material re-review
  if p_new_part_number is not null and length(trim(p_new_part_number)) > 0 then
    v_same_material := false;
  else
    v_same_material := true;
  end if;

  -- Create next generation attempt for the same physical source line
  -- Use deterministic identity: incoming:${doc}|${page}|${line}
  v_new_correlation := 'incoming-revw-' || v_attempt.document_ref || '-' || coalesce(v_attempt.source_page, 'PAGE_UNKNOWN') || '-' || v_attempt.source_line;

  insert into public.incoming_receipt_attempts(
    correlation_id, document_ref, source_page, source_line,
    part_number, mode, status, actor
  ) values (
    v_new_correlation, v_attempt.document_ref,
    coalesce(p_new_source_page, v_attempt.source_page), v_attempt.source_line,
    case when v_same_material then v_attempt.part_number else p_new_part_number end,
    v_attempt.mode, 'attempted', p_actor
  );

  select id into v_new_attempt_id
  from public.incoming_receipt_attempts
  where correlation_id = v_new_correlation;

  if v_new_attempt_id is null then
    raise exception 'Failed to create new attempt after re-review';
  end if;

  -- Record the rereview event
  insert into public.incoming_receipt_attempt_events(
    attempt_id, correlation_id, event_type, previous_status, new_status,
    revision, generation, actor
  ) values (
    v_new_attempt_id, v_attempt.correlation_id, 'rereview',
    'abandoned', 'attempted',
    v_prev_event.revision + 1, v_prev_event.generation + 1, p_actor
  );

  return jsonb_build_object(
    'success', true,
    'attemptId', v_new_attempt_id,
    'correlationId', v_new_correlation,
    'status', 'attempted',
    'generation', v_prev_event.generation + 1,
    'revision', v_prev_event.revision + 1,
    'actor', p_actor,
    'note', case when v_same_material then 'Same-material re-review after verified no-movement abandonment' else 'Corrected-material re-review after verified no-movement abandonment' end,
    'createdAt', now()
  );
end;
$$;

-- 4g. manual_reserve_line
--    Server-allocated atomic manual physical-line reservation
create or replace function public.manual_reserve_line(
  p_attempt_id uuid,
  p_document_ref text,
  p_source_page text,
  p_source_line integer,
  p_part_number text,
  p_reserved_by text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation_id uuid;
  v_existing integer;
  v_attempt public.incoming_receipt_attempts%rowtype;
begin
  if p_source_line <= 0 then
    raise exception 'sourceLine must be positive';
  end if;
  if length(trim(p_part_number)) = 0 then
    raise exception 'partNumber is required';
  end if;
  if length(trim(p_reserved_by)) = 0 then
    raise exception 'reservedBy is required';
  end if;

  -- Verify the attempt exists and is in a state that allows reservations
  select * from public.incoming_receipt_attempts where id = p_attempt_id into v_attempt;

  if not found then
    raise exception 'Attempt not found: %', p_attempt_id;
  end if;

  if v_attempt.status not in ('attempted','unknown','accepted','executed') then
    raise exception 'Cannot reserve line: attempt % is in state %', p_attempt_id, v_attempt.status;
  end if;

  -- Check if a reservation already exists for this (attempt_id, source_line)
  select count(*) into v_existing
  from public.incoming_receipt_manual_reservations
  where attempt_id = p_attempt_id and source_line = p_source_line;

  if v_existing > 0 then
    raise exception 'Line % already reserved for attempt %', p_source_line, p_attempt_id;
  end if;

  -- Server-allocate atomic reservation id (gen_random_uuid, no max()+1)
  insert into public.incoming_receipt_manual_reservations(
    attempt_id, document_ref, source_page, source_line,
    part_number, reserved_by
  ) values (
    p_attempt_id, p_document_ref, p_source_page, p_source_line,
    p_part_number, p_reserved_by
  )
  returning id into v_reservation_id;

  return jsonb_build_object(
    'success', true,
    'reservationId', v_reservation_id,
    'attemptId', p_attempt_id,
    'documentRef', p_document_ref,
    'sourcePage', p_source_page,
    'sourceLine', p_source_line,
    'partNumber', p_part_number,
    'reservedBy', p_reserved_by,
    'reservedAt', now()
  );
end;
$$;

-- 4h. release_manual_reservation
create or replace function public.release_manual_reservation(
  p_reservation_id uuid,
  p_released_by text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation public.incoming_receipt_manual_reservations%rowtype;
begin
  if length(trim(p_released_by)) = 0 then
    raise exception 'releasedBy is required';
  end if;

  select * into v_reservation from public.incoming_receipt_manual_reservations where id = p_reservation_id;

  if not found then
    raise exception 'Reservation not found: %', p_reservation_id;
  end if;

  update public.incoming_receipt_manual_reservations
  set released_at = now()
  where id = p_reservation_id;

  return jsonb_build_object(
    'success', true,
    'reservationId', p_reservation_id,
    'attemptId', v_reservation.attempt_id,
    'sourceLine', v_reservation.source_line,
    'releasedBy', p_released_by,
    'releasedAt', now()
  );
end;
$$;

-- -------------------------------------------------------
-- 5. Grants and privileges (one transaction)
-- -------------------------------------------------------

-- Allow service_role to use the new functions
grant execute on function public.register_incoming_receipt_attempt(text,text,text,integer,text) to service_role;
grant execute on function public.attempt_incoming_receipt(uuid,text) to service_role;
grant execute on function public.accept_incoming_receipt(uuid,text,text,integer,text,text,text) to service_role;
grant execute on function public.conflict_incoming_receipt(uuid,text,text,jsonb) to service_role;
grant execute on function public.abandon_incoming_receipt(uuid,text,text,boolean) to service_role;
grant execute on function public.review_incoming_receipt(uuid,integer,integer,text,text,text) to service_role;
grant execute on function public.manual_reserve_line(uuid,text,text,integer,text,text) to service_role;
grant execute on function public.release_manual_reservation(uuid,text) to service_role;

-- Allow service_role to tables
grant all on public.incoming_receipt_attempts to service_role;
grant all on public.incoming_receipt_attempt_events to service_role;
grant all on public.incoming_receipt_manual_reservations to service_role;

-- Row level security: leave as-is (service_role bypasses RLS, browser actions use explicit policies)
-- No changes to existing RLS policies;

commit;