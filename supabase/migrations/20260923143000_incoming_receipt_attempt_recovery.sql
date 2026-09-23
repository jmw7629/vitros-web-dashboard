-- Durable Incoming Stock receipt-attempt recovery.
-- Persists the exact human-reviewed physical line before RECEIVE so reload/lost-ack
-- recovery cannot silently re-key an uncertain receipt into a second movement.
-- This migration is additive and service-role-only. It does not post to SAP.
begin;

create table if not exists public.incoming_receipt_attempts (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  document_ref text not null,
  document_ref_normalized text not null,
  source_page text,
  source_page_normalized text not null,
  source_line_no integer not null check (source_line_no > 0 and source_line_no <= 500),
  part_number text not null,
  part_number_canonical text not null,
  qty integer not null check (qty > 0),
  correlation_id text not null unique,
  batch_id text not null,
  state text not null check (state in ('reviewed','attempted','accepted','unknown','conflict')),
  revision bigint not null default 1 check (revision > 0),
  receipt jsonb,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_ref_normalized, source_page_normalized, source_line_no)
);

create table if not exists public.incoming_receipt_attempt_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.incoming_receipt_attempts(id),
  revision bigint not null,
  event_type text not null,
  from_state text,
  to_state text not null,
  actor text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (attempt_id, revision)
);

create index if not exists incoming_receipt_attempts_actor_open_idx
  on public.incoming_receipt_attempts(actor, acknowledged_at, state, created_at);
create index if not exists incoming_receipt_attempt_events_attempt_idx
  on public.incoming_receipt_attempt_events(attempt_id, created_at);

alter table public.incoming_receipt_attempts enable row level security;
alter table public.incoming_receipt_attempt_events enable row level security;
revoke all on table public.incoming_receipt_attempts from public, anon, authenticated;
revoke all on table public.incoming_receipt_attempt_events from public, anon, authenticated;

create or replace function public.incoming_receipt_attempt_events_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Incoming receipt attempt history is immutable';
end;
$$;

drop trigger if exists incoming_receipt_attempt_events_immutable_trg
  on public.incoming_receipt_attempt_events;
create trigger incoming_receipt_attempt_events_immutable_trg
before update or delete on public.incoming_receipt_attempt_events
for each row execute function public.incoming_receipt_attempt_events_immutable();

create or replace function public.incoming_receipt_attempt_payload(
  p_attempt public.incoming_receipt_attempts
) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'attemptId', p_attempt.id,
    'state', p_attempt.state,
    'revision', p_attempt.revision,
    'documentRef', p_attempt.document_ref,
    'sourcePage', p_attempt.source_page,
    'sourceLineNo', p_attempt.source_line_no,
    'partNumber', p_attempt.part_number,
    'qty', p_attempt.qty,
    'correlationId', p_attempt.correlation_id,
    'batchId', p_attempt.batch_id,
    'receipt', p_attempt.receipt,
    'acknowledgedAt', p_attempt.acknowledged_at,
    'createdAt', p_attempt.created_at,
    'updatedAt', p_attempt.updated_at
  );
$$;
revoke all on function public.incoming_receipt_attempt_payload(public.incoming_receipt_attempts)
  from public, anon, authenticated;

create or replace function public.register_incoming_receipt_review(
  p_actor text,
  p_document_ref text,
  p_source_page text,
  p_source_line_no integer,
  p_part_number text,
  p_qty integer,
  p_correlation_id text,
  p_batch_id text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(btrim(p_actor), '');
  v_doc text := upper(regexp_replace(btrim(coalesce(p_document_ref,'')), '[[:space:]]+', ' ', 'g'));
  v_page text := case when nullif(btrim(coalesce(p_source_page,'')), '') is null
    then 'PAGE_UNKNOWN'
    else left(upper(regexp_replace(btrim(p_source_page), '[[:space:]]+', ' ', 'g')), 50) end;
  v_part text := upper(btrim(coalesce(p_part_number,'')));
  v_expected text;
  v_existing public.incoming_receipt_attempts%rowtype;
  v_attempt public.incoming_receipt_attempts%rowtype;
begin
  if v_actor is null then raise exception 'Receipt actor is required'; end if;
  if v_doc = '' or length(v_doc) > 200 then raise exception 'Receipt document reference is invalid'; end if;
  if p_source_line_no is null or p_source_line_no <= 0 or p_source_line_no > 500 then
    raise exception 'Receipt source line is invalid';
  end if;
  if v_part = '' then raise exception 'Receipt part number is required'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Receipt quantity is invalid'; end if;
  if p_batch_id is distinct from v_doc then raise exception 'Receipt batch identity is invalid'; end if;
  v_expected := 'incoming:' || v_doc || '|' || v_page || '|' || p_source_line_no::text;
  if p_correlation_id is distinct from v_expected then raise exception 'Receipt correlation identity is invalid'; end if;

  -- Serialize physical-line reservation independently of browser/device timing.
  perform pg_advisory_xact_lock(hashtextextended('incoming-receipt-line:' || v_expected, 0));
  select * into v_existing from public.incoming_receipt_attempts
   where document_ref_normalized = v_doc
     and source_page_normalized = v_page
     and source_line_no = p_source_line_no
   for update;

  if found then
    if v_existing.actor is distinct from v_actor then
      raise exception 'Receipt line is already reserved';
    end if;
    if v_existing.part_number_canonical = v_part
       and v_existing.qty = p_qty
       and v_existing.correlation_id = v_expected
       and v_existing.batch_id = p_batch_id then
      return public.incoming_receipt_attempt_payload(v_existing);
    end if;
    if v_existing.state = 'accepted' then
      raise exception 'Receipt identity conflicts with an accepted receipt';
    end if;
    update public.incoming_receipt_attempts
       set state='conflict', revision=revision+1, updated_at=now()
     where id=v_existing.id returning * into v_attempt;
    insert into public.incoming_receipt_attempt_events
      (attempt_id,revision,event_type,from_state,to_state,actor,details)
    values (v_attempt.id,v_attempt.revision,'material_conflict',v_existing.state,'conflict',v_actor,
      jsonb_build_object('requestedPartNumber',v_part,'requestedQty',p_qty));
    return public.incoming_receipt_attempt_payload(v_attempt);
  end if;

  -- An unresolved attempt from a different receipt cannot be silently abandoned/re-keyed.
  if exists (
    select 1 from public.incoming_receipt_attempts
     where actor=v_actor and acknowledged_at is null and batch_id <> p_batch_id
       and state in ('reviewed','attempted','accepted','unknown','conflict')
  ) then
    raise exception 'A prior receipt requires reconciliation before another receipt can start';
  end if;

  insert into public.incoming_receipt_attempts (
    actor,document_ref,document_ref_normalized,source_page,source_page_normalized,
    source_line_no,part_number,part_number_canonical,qty,correlation_id,batch_id,state
  ) values (
    v_actor,btrim(p_document_ref),v_doc,nullif(btrim(coalesce(p_source_page,'')),''),v_page,
    p_source_line_no,v_part,v_part,p_qty,v_expected,p_batch_id,'reviewed'
  ) returning * into v_attempt;

  insert into public.incoming_receipt_attempt_events
    (attempt_id,revision,event_type,from_state,to_state,actor,details)
  values (v_attempt.id,v_attempt.revision,'reviewed',null,'reviewed',v_actor,
    jsonb_build_object('correlationId',v_expected));
  return public.incoming_receipt_attempt_payload(v_attempt);
end;
$$;

create or replace function public.execute_incoming_receipt_attempt(
  p_attempt_id uuid,
  p_actor text,
  p_expected_revision bigint
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(btrim(p_actor), '');
  v_before public.incoming_receipt_attempts%rowtype;
  v_attempt public.incoming_receipt_attempts%rowtype;
  v_receipt jsonb;
begin
  if v_actor is null then raise exception 'Receipt actor is required'; end if;
  select * into v_before from public.incoming_receipt_attempts
   where id=p_attempt_id for update;
  if not found then raise exception 'Receipt attempt was not found'; end if;
  if v_before.actor is distinct from v_actor then raise exception 'Receipt attempt is not available'; end if;
  if v_before.state = 'accepted' then return public.incoming_receipt_attempt_payload(v_before); end if;
  if v_before.state = 'conflict' then raise exception 'Receipt attempt requires review'; end if;
  if v_before.state not in ('reviewed','unknown') then raise exception 'Receipt attempt is already in progress'; end if;
  if p_expected_revision is distinct from v_before.revision then raise exception 'Receipt attempt revision is stale'; end if;

  update public.incoming_receipt_attempts
     set state='attempted', revision=revision+1, updated_at=now()
   where id=v_before.id returning * into v_attempt;
  insert into public.incoming_receipt_attempt_events
    (attempt_id,revision,event_type,from_state,to_state,actor,details)
  values (v_attempt.id,v_attempt.revision,'attempted',v_before.state,'attempted',v_actor,
    jsonb_build_object('correlationId',v_attempt.correlation_id));

  -- Same database transaction as stock/audit/pending-SAP. A database failure rolls
  -- back both the attempt state and the inventory movement.
  v_receipt := public.apply_inventory_transition(
    v_attempt.part_number,
    'RECEIVE',
    v_attempt.qty,
    v_actor,
    v_attempt.correlation_id,
    null,
    v_attempt.batch_id
  );

  update public.incoming_receipt_attempts
     set state='accepted', receipt=v_receipt, revision=revision+1, updated_at=now()
   where id=v_attempt.id returning * into v_attempt;
  insert into public.incoming_receipt_attempt_events
    (attempt_id,revision,event_type,from_state,to_state,actor,details)
  values (v_attempt.id,v_attempt.revision,'accepted','attempted','accepted',v_actor,
    jsonb_build_object('correlationId',v_attempt.correlation_id));
  return public.incoming_receipt_attempt_payload(v_attempt);
end;
$$;

create or replace function public.mark_incoming_receipt_attempt_unknown(
  p_attempt_id uuid,
  p_actor text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(btrim(p_actor), '');
  v_before public.incoming_receipt_attempts%rowtype;
  v_attempt public.incoming_receipt_attempts%rowtype;
begin
  if v_actor is null then raise exception 'Receipt actor is required'; end if;
  select * into v_before from public.incoming_receipt_attempts where id=p_attempt_id for update;
  if not found or v_before.actor is distinct from v_actor then raise exception 'Receipt attempt is not available'; end if;
  if v_before.state in ('accepted','conflict','unknown') then
    return public.incoming_receipt_attempt_payload(v_before);
  end if;
  if v_before.state not in ('reviewed','attempted') then
    return public.incoming_receipt_attempt_payload(v_before);
  end if;
  update public.incoming_receipt_attempts
     set state='unknown', revision=revision+1, updated_at=now()
   where id=v_before.id returning * into v_attempt;
  insert into public.incoming_receipt_attempt_events
    (attempt_id,revision,event_type,from_state,to_state,actor,details)
  values (v_attempt.id,v_attempt.revision,'outcome_unknown',v_before.state,'unknown',v_actor,
    jsonb_build_object('correlationId',v_attempt.correlation_id));
  return public.incoming_receipt_attempt_payload(v_attempt);
end;
$$;

create or replace function public.acknowledge_incoming_receipt_attempt(
  p_attempt_id uuid,
  p_actor text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(btrim(p_actor), '');
  v_before public.incoming_receipt_attempts%rowtype;
  v_attempt public.incoming_receipt_attempts%rowtype;
begin
  if v_actor is null then raise exception 'Receipt actor is required'; end if;
  select * into v_before from public.incoming_receipt_attempts where id=p_attempt_id for update;
  if not found or v_before.actor is distinct from v_actor then raise exception 'Receipt attempt is not available'; end if;
  if v_before.state <> 'accepted' then raise exception 'Only an accepted receipt can be acknowledged'; end if;
  if v_before.acknowledged_at is not null then return public.incoming_receipt_attempt_payload(v_before); end if;
  update public.incoming_receipt_attempts
     set acknowledged_at=now(), revision=revision+1, updated_at=now()
   where id=v_before.id returning * into v_attempt;
  insert into public.incoming_receipt_attempt_events
    (attempt_id,revision,event_type,from_state,to_state,actor,details)
  values (v_attempt.id,v_attempt.revision,'acknowledged','accepted','accepted',v_actor,
    jsonb_build_object('correlationId',v_attempt.correlation_id));
  return public.incoming_receipt_attempt_payload(v_attempt);
end;
$$;

create or replace function public.list_incoming_receipt_recovery(
  p_actor text
) returns jsonb
language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(public.incoming_receipt_attempt_payload(a) order by a.created_at, a.id), '[]'::jsonb)
  from public.incoming_receipt_attempts a
  where a.actor = nullif(btrim(p_actor), '')
    and a.acknowledged_at is null
    and a.state in ('reviewed','attempted','accepted','unknown','conflict');
$$;

create or replace function public.next_incoming_manual_line(
  p_actor text,
  p_document_ref text
) returns integer
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(btrim(p_actor), '');
  v_doc text := upper(regexp_replace(btrim(coalesce(p_document_ref,'')), '[[:space:]]+', ' ', 'g'));
  v_next integer;
begin
  if v_actor is null then raise exception 'Receipt actor is required'; end if;
  if v_doc = '' then raise exception 'Receipt document reference is required'; end if;
  select coalesce(max(source_line_no),0) + 1 into v_next
  from public.incoming_receipt_attempts
  where actor=v_actor and document_ref_normalized=v_doc and source_page_normalized='MANUAL';
  if v_next > 500 then raise exception 'Receipt manual line limit reached'; end if;
  return v_next;
end;
$$;

revoke all on function public.register_incoming_receipt_review(text,text,text,integer,text,integer,text,text) from public, anon, authenticated;
revoke all on function public.execute_incoming_receipt_attempt(uuid,text,bigint) from public, anon, authenticated;
revoke all on function public.mark_incoming_receipt_attempt_unknown(uuid,text) from public, anon, authenticated;
revoke all on function public.acknowledge_incoming_receipt_attempt(uuid,text) from public, anon, authenticated;
revoke all on function public.list_incoming_receipt_recovery(text) from public, anon, authenticated;
revoke all on function public.next_incoming_manual_line(text,text) from public, anon, authenticated;

grant execute on function public.register_incoming_receipt_review(text,text,text,integer,text,integer,text,text) to service_role;
grant execute on function public.execute_incoming_receipt_attempt(uuid,text,bigint) to service_role;
grant execute on function public.mark_incoming_receipt_attempt_unknown(uuid,text) to service_role;
grant execute on function public.acknowledge_incoming_receipt_attempt(uuid,text) to service_role;
grant execute on function public.list_incoming_receipt_recovery(text) to service_role;
grant execute on function public.next_incoming_manual_line(text,text) to service_role;

commit;
