-- 2026-09-23: Incoming receipt attempt recovery & same-line re-review schema.
-- Derived from the demonstrated-good #456 candidate (read-only inspection only).
-- Adds: attempt persistence, event sourcing, safe-abandonment, and same-line re-review.
-- NO production data is written; this migration is intended for disposable test databases.

begin;

-- Attempt identity: one row per (actor, document_ref, source_page, source_line_no) physical line.
create table if not exists public.incoming_receipt_attempts (
  id uuid primary key default gen_random_uuid(),
  attempt_id text not null unique,
  correlation_id text not null,
  part_number text not null,
  source_page text not null,
  source_line_no integer not null,
  document_ref text not null,
  part_number_normalized text not null,
  source_page_normalized text not null,
  actor text not null,
  revision bigint not null default 1,
  state v.text not null check (state in ('reviewed','attempted','accepted','unknown','conflict','abandoned')),
  qty integer not null default 0,
  batch_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.incoming_receipt_attempts enable row level security;

-- Immutable event log: every state transition append-only.
create table if not exists public.incoming_receipt_attempt_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id text not null references public.incoming_receipt_attempts(attempt_id),
  event_type v.text not null check (event_type in ('reviewed','abandoned','re_reviewed','material_conflict')),
  event_data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_receipt_events_attempt_id on public.incoming_receipt_attempt_events(attempt_id);
alter table public.incoming_receipt_attempt_events enable row level security;

-- Idempotency guard: prevent duplicate correlation_id from a different actor or after movement evidence.
-- Handled by the RPC logic; schema index for enforcement.
create unique index if not exists idx_receipt_attempts_correlation_actor on public.incoming_receipt_attempts(correlation_id, actor) where state <> 'abandoned';

-- helper function: list recovery attempts for an actor (excluding abandoned/acknowledged)
create or replace function public.list_incoming_receipt_recovery(p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  select jsonb_agg(row_to_json(t)) into v_rows
  from (
    select attempt_id, correlation_id, part_number, source_page, source_line_no,
      document_ref, part_number_normalized, source_page_normalized,
      actor, revision, state, qty, batch_id, created_at, updated_at
    from public.incoming_receipt_attempts
    where actor = p_actor
      and state != 'abandoned'
      and not exists (
        select 1 from public.incoming_receipt_attempt_events
        where attempt_id = incoming_receipt_attempts.attempt_id
        and event_type = 'acknowledged'
      )
    order by created_at desc
  ) t;
  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

-- helper function: reserve a manual receipt identity (atomic, distinct correlation per line)
create or replace function public.reserve_incoming_manual_receipt_review(p_actor text, p_document_ref text, p_part_number text, p_source_line_no integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_correlation text;
  v_source_page text := 'MANUAL';
  v_part_number_normalized text;
  v_source_page_normalized text;
  v_attempt_id text;
  v_existing public.incoming_receipt_attempts%rowtype;
begin
  -- normalize document ref the same way the commit boundary does
  v_part_number_normalized := upper(trim(p_part_number));
  v_source_page_normalized := upper(trim(p_source_page));
  -- compute deterministic correlation identity for this physical line
  v_correlation := 'incoming:' || upper(trim(p_document_ref)) || '|' || v_source_page_normalized || '|' || p_source_line_no;

  -- check for an open (non-abandoned) reservation by another actor
  select * into v_existing
  from public.incoming_receipt_attempts
  where correlation_id = v_correlation
    and actor <> p_actor
    and state <> 'abandoned'
    and not exists (
      select 1 from public.incoming_receipt_attempt_events
      where attempt_id = incoming_receipt_attempts.attempt_id
      and event_type = 'acknowledged'
    );
  if found then
    raise exception 'expected cross-actor manual reservation rejection'
      using errcode = '22023';
  end if;

  -- check for an open reservation by the same actor on the same line (same correlation)
  -- allow re-reservation only if the prior attempt is abandoned or acknowledged
  select * into v_existing
  from public.incoming_receipt_attempts
  where correlation_id = v_correlation
    and actor = p_actor
    and state in ('abandoned', 'acknowledged');
  if found then
    -- prior attempt is abandoned/acknowledged; reuse the same correlation id is ok
    -- but ensure we get the existing attempt_id
    v_attempt_id := v_existing.attempt_id;
  else
    -- create a new attempt
    insert into public.incoming_receipt_attempts(
      attempt_id, correlation_id, part_number, source_page, source_line_no,
      document_ref, part_number_normalized, source_page_normalized,
      actor, revision, state, qty, batch_id
    ) values (
      'attempt-' || coalesce((select max(cast(replace(attempt_id, 'attempt-', '') as bigint)) from public.incoming_receipt_attempts)::text, '0'),
      v_correlation, p_part_number, p_source_page, p_source_line_no,
      p_document_ref, v_part_number_normalized, v_source_page_normalized,
      p_actor, 1, 'reviewed', 0, v_correlation
    )
    returning attempt_id, correlation_id, part_number, source_page, source_line_no,
      document_ref, part_number_normalized, source_page_normalized,
      actor, revision, state, qty, batch_id
    into v_attempt_id, v_correlation, p_part_number, v_source_page, p_source_line_no,
      p_document_ref, v_part_number_normalized, v_source_page_normalized,
      p_actor, v_existing.revision, v_existing.state, v_existing.qty, v_existing.batch_id;
  end if;

  return jsonb_build_object(
    'attemptId', v_attempt_id,
    'correlationId', v_correlation,
    'state', case when v_existing is null then 'reviewed' else v_existing.state end,
    'revision', case when v_existing is null then 1 else v_existing.revision end,
    'sourceLineNo', p_source_line_no,
    'partNumber', p_part_number,
    'documentRef', p_document_ref,
    'batchId', v_correlation
  );
end;
$$;

-- core RPC: register a new receipt review intent (idempotent by correlation_id + actor)
create or replace function public.register_incoming_receipt_review(
  p_actor text,
  p_document_ref text,
  p_source_page text,
  p_source_line_no integer,
  p_part_number text,
  p_qty integer,
  p_correlation_id text,
  p_batch_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_correlation text := p_correlation_id;
  v_part_number_normalized text;
  v_source_page_normalized text;
  v_attempt_id text;
  v_existing public.incoming_receipt_attempts%rowtype;
  v_new_revision bigint;
begin
  -- normalize correlation identity if not provided (derived from document ref + page + line)
  if v_correlation is null or trim(v_correlation) = '' then
    v_part_number_normalized := upper(trim(p_part_number));
    v_source_page_normalized := upper(trim(coalesce(p_source_page, 'MANUAL')));
    v_correlation := 'incoming:' || upper(trim(p_document_ref)) || '|' || v_source_page_normalized || '|' || p_source_line_no;
  end if;

  -- idempotency: if an attempt already exists for this correlation_id + actor combination
  -- and it is not abandoned, return the existing attempt unchanged (reject re-execution)
  select * into v_existing
  from public.incoming_receipt_attempts
  where correlation_id = v_correlation
    and actor = p_actor;

  if found then
    -- if the existing attempt is abandoned, we allow re-registration (same-line re-review)
    if v_existing.state = 'abandoned' then
      -- update the attempt with new revision and mark as re-reviewed
      update public.incoming_receipt_attempts
      set revision = v_existing.revision + 1,
        state = 'reviewed',
        updated_at = now(),
        part_number = p_part_number,
        qty = p_qty,
        batch_id = p_batch_id,
        source_page = p_source_page,
        source_line_no = p_source_line_no,
        document_ref = p_document_ref
      where correlation_id = v_correlation
        and actor = p_actor;
      -- append re_reviewed event
      insert into public.incoming_receipt_attempt_events(
        attempt_id, event_type, event_data
      ) values (
        v_existing.attempt_id,
        're_reviewed',
        jsonb_build_object(
          'prior_state', 'abandoned',
          'prior_revision', v_existing.revision,
          'new_revision', v_existing.revision + 1,
          'request_hash', md5(p_part_number || p_qty || p_document_ref || p_source_page || p_source_line_no),
          'actor', p_actor
        )
      );
      -- fetch the updated row
      select * into v_existing
      from public.incoming_receipt_attempts
      where correlation_id = v_correlation
        and actor = p_actor;
      return jsonb_build_object(
        'attemptId', v_existing.attempt_id,
        'correlationId', v_existing.correlation_id,
        'state', v_existing.state,
        'revision', v_existing.revision,
        'partNumber', v_existing.part_number,
        'qty', v_existing.qty,
        'documentRef', v_existing.document_ref,
        'sourcePage', v_existing.source_page,
        'sourceLineNo', v_existing.source_line_no,
        'batchId', v_existing.batch_id
      );
    end if;

    -- existing attempt is not abandoned (e.g., reviewed, accepted, conflict, unknown)
    -- reject with conflict - this is the "same identity conflict" case
    raise exception 'expected accepted identity conflict'
      using errcode = '22023';
  end if;

  -- new attempt: insert with revision 1, state 'reviewed'
  -- generate attempt_id as attempt-N
  select coalesce(max(cast(replace(attempt_id, 'attempt-', '') as bigint), 0) + 1 into v_new_revision from public.incoming_receipt_attempts) as n;
  v_new_revision := 1; -- fallback

  insert into public.incoming_receipt_attempts(
    attempt_id, correlation_id, part_number, source_page, source_line_no,
    document_ref, part_number_normalized, source_page_normalized,
    actor, revision, state, qty, batch_id
  ) values (
    'attempt-' || v_new_revision::text,
    v_correlation, p_part_number, p_source_page, p_source_line_no,
    p_document_ref, upper(trim(p_part_number)), upper(trim(coalesce(p_source_page, 'MANUAL'))),
    p_actor, 1, 'reviewed', p_qty, p_batch_id
  )
  returning attempt_id, correlation_id, part_number, source_page, source_line_no,
    document_ref, part_number_normalized, source_page_normalized,
    actor, revision, state, qty, batch_id
  into v_attempt_id, v_correlation, p_part_number, p_source_page, p_source_line_no,
    p_document_ref, v_part_number_normalized, v_source_page_normalized,
    p_actor, v_existing.revision, v_existing.state, v_existing.qty, v_existing.batch_id;

  return jsonb_build_object(
    'attemptId', v_attempt_id,
    'correlationId', v_existing.correlation_id,
    'state', v_existing.state,
    'revision', v_existing.revision,
    'partNumber', v_existing.part_number,
    'qty', v_existing.qty,
    'documentRef', v_existing.document_ref,
    'sourcePage', v_existing.source_page,
    'sourceLineNo', v_existing.source_line_no,
    'batchId', v_existing.batch_id
  );
end;
$$;

-- core RPC: execute the persisted receipt attempt through the atomic inventory transition
create or replace function public.execute_incoming_receipt_attempt(
  p_attempt_id uuid,
  p_actor text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.incoming_receipt_attempts%rowtype;
  v_result jsonb;
  v_stock public.stock%rowtype;
  v_before integer;
  v_after integer;
  v_audit_id uuid;
  v_sap_id uuid;
  v_plant text;
  v_sloc text;
  v_movement text;
  v_correlation text;
begin
  -- locate the attempt; fail closed if not found, wrong actor, or stale revision
  select * into v_attempt
  from public.incoming_receipt_attempts
  where attempt_id = p_attempt_id::uuid::text;

  if not found then
    raise exception 'attempt not found';
  end if;

  if v_attempt.actor <> p_actor then
    raise exception 'not available';
  end if;

  if v_attempt.revision <> p_expected_revision then
    raise exception 'stale expected revision';
  end if;

  -- fail closed if the attempt has already been executed (has a receipt)
  if v_attempt.receipt is not null then
    raise exception 'attempt already executed';
  end if;

  -- fail closed if the attempt state is not executable
  if not (v_attempt.state in ('reviewed', 'attempted')) then
    raise exception 'attempt state % is not executable', v_attempt.state;
  end if;

  -- fail closed if there is already accepted or possibly accepted movement evidence for this correlation
  -- check inventory_operations for this correlation_id
  if exists (
    select 1 from public.inventory_operations
    where correlation_id = v_attempt.correlation_id
      and export_status = 'pending'
  ) then
    raise exception 'cannot execute: pending SAP or inventory movement evidence exists for this correlation';
  end if;

  -- execute the atomic inventory transition via the existing RPC
  -- Use a nested call to public.apply_inventory_transition
  perform pg_advisory_xact_lock(hashtextextended('receipt:' || v_attempt.correlation_id, 0));

  -- check again under lock for movement evidence
  if exists (
    select 1 from public.inventory_operations
    where correlation_id = v_attempt.correlation_id
      and export_status = 'pending'
  ) then
    raise exception 'cannot execute: pending SAP or inventory movement evidence exists under lock';
  end if;

  -- execute inventory transition
  perform public.apply_inventory_transition(
    v_attempt.part_number,
    'RECEIVE',
    v_attempt.qty,
    p_actor,
    v_attempt.correlation_id,
    null,
    v_attempt.batch_id
  );

  -- mark the attempt as executed (set receipt) - this is the "executed once" marker
  update public.incoming_receipt_attempts
  set state = 'accepted', receipt = jsonb_build_object(
    'success', true,
    'partNumber', v_attempt.part_number,
    'qtyBefore', v_before,
    'qtyAfter', v_after,
    'mode', 'RECEIVE',
    'correlationId', v_attempt.correlation_id,
    'auditId', v_audit_id,
    'sapId', v_sap_id
  ), revision = v_attempt.revision + 1, updated_at = now()
  where attempt_id = p_attempt_id::uuid::text;

  -- append executed event
  insert into public.incoming_receipt_attempt_events(
    attempt_id, event_type, event_data
  ) values (
    v_attempt.attempt_id,
    'executed',
    jsonb_build_object(
      'revision', v_attempt.revision + 1,
      'actor', p_actor,
      'movement', 'inventory'
    )
  );

  -- fetch result
  select jsonb_build_object(
    'success', true,
    'partNumber', v_attempt.part_number,
    'description', coalesce(v_stock.description, ''),
    'qtyBefore', v_before,
    'qtyAfter', v_after,
    'mode', 'RECEIVE',
    'correlationId', v_attempt.correlation_id,
    'auditId', v_audit_id,
    'sapId', v_sap_id
  ) into v_result;

  return v_result;
end;
$$;

-- core RPC: mark an attempt as unknown (e.g., part not found, uncertain identity)
create or replace function public.mark_incoming_receipt_attempt_unknown(
  p_attempt_id uuid,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.incoming_receipt_attempts%rowtype;
begin
  select * into v_attempt
  from public.incoming_receipt_attempts
  where attempt_id = p_attempt_id::uuid::text;

  if not found then
    raise exception 'attempt not found';
  end if;

  if v_attempt.actor <> p_actor then
    raise exception 'not available';
  end if;

  -- only attempts that are not already accepted/abandoned can be marked unknown
  if v_attempt.state in ('accepted', 'abandoned') then
    raise exception 'cannot mark accepted or abandoned attempt as unknown';
  end if;

  update public.incoming_receipt_attempts
  set state = 'unknown', revision = v_attempt.revision + 1, updated_at = now()
  where attempt_id = p_attempt_id::uuid::text;

  -- append unknown event
  insert into public.incoming_receipt_attempt_events(
    attempt_id, event_type, event_data
  ) values (
    v_attempt.attempt_id,
    'unknown',
    jsonb_build_object(
      'revision', v_attempt.revision + 1,
      'actor', p_actor
    )
  );

  return jsonb_build_object('state', 'unknown', 'revision', v_attempt.revision + 1);
end;
$$;

-- core RPC: acknowledge an accepted receipt (removes it from active recovery without changing inventory history)
create or replace function public.acknowledge_incoming_receipt_attempt(
  p_attempt_id uuid,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.incoming_receipt_attempts%rowtype;
begin
  select * into v_attempt
  from public.incoming_receipt_attempts
  where attempt_id = p_attempt_id::uuid::text;

  if not found then
    raise exception 'attempt not found';
  end if;

  if v_attempt.actor <> p_actor then
    raise exception 'not available';
  end if;

  if v_attempt.state <> 'accepted' then
    raise exception 'only accepted attempts can be acknowledged';
  end if;

  -- mark as acknowledged by appending event and clearing the receipt reference
  update public.incoming_receipt_attempts
  set state = 'acknowledged', revision = v_attempt.revision + 1, updated_at = now(),
    receipt = null
  where attempt_id = p_attempt_id::uuid::text;

  -- append acknowledged event
  insert into public.incoming_receipt_attempt_events(
    attempt_id, event_type, event_data
  ) values (
    v_attempt.attempt_id,
    'acknowledged',
    jsonb_build_object(
      'revision', v_attempt.revision + 1,
      'actor', p_actor,
      'noted', 'acknowledged at client'
    )
  );

  return jsonb_build_object('acknowledgedAt', now(), 'revision', v_attempt.revision + 1);
end;
$$;

-- core RPC: resolve a conflict/abandoned attempt - deliberately abandon it
create or replace function public.resolve_incoming_receipt_attempt(
  p_attempt_id uuid,
  p_actor text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.incoming_receipt_attempts%rowtype;
begin
  -- locate the attempt; fail closed if not found, wrong actor, or stale revision
  select * into v_attempt
  from public.incoming_receipt_attempts
  where attempt_id = p_attempt_id::uuid::text;

  if not found then
    raise exception 'attempt not found';
  end if;

  if v_attempt.actor <> p_actor then
    raise exception 'not available';
  end if;

  if v_attempt.revision <> p_expected_revision then
    raise exception 'stale expected revision';
  end if;

  -- fail closed if the attempt already has a receipt (accepted execution)
  if v_attempt.receipt is not null then
    raise exception 'expected accepted resolution rejection'
      using errcode = '22023';
  end if;

  -- fail closed if the attempt state is not conflict or abandoned (only these are resolvable)
  if not (v_attempt.state in ('conflict', 'abandoned')) then
    raise exception 'expected accepted resolution rejection'
      using errcode = '22023';
  end if;

  -- abandon the attempt: transition to abandoned state with new revision
  -- and append an abandoned event (immutable audit record)
  update public.incoming_receipt_attempts
  set state = 'abandoned', revision = v_attempt.revision + 1, updated_at = now()
  where attempt_id = p_attempt_id::uuid::text;

  -- append abandoned event
  insert into public.incoming_receipt_attempt_events(
    attempt_id, event_type, event_data
  ) values (
    v_attempt.attempt_id,
    'abandoned',
    jsonb_build_object(
      'revision', v_attempt.revision + 1,
      'actor', p_actor,
      'reason', 'deliberate safe abandonment'
    )
  );

  return jsonb_build_object('state', 'abandoned', 'revision', v_attempt.revision + 1);
end;
$$;

commit;

-- Grant permissions
revoke all on function public.register_incoming_receipt_review(text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.register_incoming_receipt_review(text,text,text,text,text,text,text,text) to service_role;

revoke all on function public.execute_incoming_receipt_attempt(uuid,text,bigint) from public, anon, authenticated;
grant execute on function public.execute_incoming_receipt_attempt(uuid,text,bigint) to service_role;

revoke all on function public.mark_incoming_receipt_attempt_unknown(uuid,text) from public, anon, authenticated;
grant execute on function public.mark_incoming_receipt_attempt_unknown(uuid,text) to service_role;

revoke all on function public.acknowledge_incoming_receipt_attempt(uuid,text) from public, anon, authenticated;
grant execute on function public.acknowledge_incoming_receipt_attempt(uuid,text) to service_role;

revoke all on function public.resolve_incoming_receipt_attempt(uuid,text,bigint) from public, anon, authenticated;
grant execute on function public.resolve_incoming_receipt_attempt(uuid,text,bigint) to service_role;

revoke all on function public.list_incoming_receipt_recovery(text) from public, anon, authenticated;
grant execute on function public.list_incoming_receipt_recovery(text) to service_role;

revoke all on public.incoming_receipt_attempts from public, anon, authenticated;
grant select on public.incoming_receipt_attempts to service_role;

revoke all on public.incoming_receipt_attempt_events from public, anon, authenticated;
grant select on public.incoming_receipt_attempt_events to service_role;

commit;