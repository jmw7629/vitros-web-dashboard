-- #442 durable Incoming Stock receipt recovery foundation.
-- Additive, service-role-only, and safe for PostgreSQL 17.
-- No Production SAP post is performed here.
begin;

create table public.incoming_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  document_ref text not null,
  document_ref_normalized text not null,
  source_page text,
  source_page_normalized text not null,
  source_line_no integer not null check (source_line_no between 1 and 500),
  line_kind text not null check (line_kind in ('source','manual')),
  created_by text not null,
  next_generation integer not null default 1 check (next_generation >= 1),
  created_at timestamptz not null default now(),
  unique (document_ref_normalized, source_page_normalized, source_line_no)
);

create table public.incoming_receipt_manual_counters (
  document_ref_normalized text not null,
  source_page_normalized text not null default 'MANUAL',
  next_line_no integer not null default 1 check (next_line_no between 1 and 501),
  updated_at timestamptz not null default now(),
  primary key (document_ref_normalized, source_page_normalized)
);

create table public.incoming_receipt_attempts (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.incoming_receipt_lines(id) on delete restrict,
  generation integer not null check (generation >= 1),
  actor text not null,
  part_number_canonical text not null,
  qty integer not null check (qty > 0),
  material_fingerprint text not null,
  correlation_id text not null unique,
  batch_id text not null,
  state text not null check (state in ('reviewed','attempted','unknown','accepted','conflict','abandoned')),
  revision bigint not null default 1 check (revision >= 1),
  receipt jsonb,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (line_id, generation)
);
create unique index incoming_receipt_one_active_generation_uq
  on public.incoming_receipt_attempts(line_id)
  where state <> 'abandoned';

create table public.incoming_receipt_attempt_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.incoming_receipt_attempts(id) on delete restrict,
  revision bigint not null,
  event_type text not null,
  actor text not null,
  from_state text,
  to_state text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (attempt_id, revision)
);
create index incoming_receipt_attempt_actor_state_idx
  on public.incoming_receipt_attempts(actor, state, acknowledged_at, created_at);
create index incoming_receipt_attempt_event_idx
  on public.incoming_receipt_attempt_events(attempt_id, created_at, id);

create or replace function public.incoming_receipt_events_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception using errcode='55000', message='Incoming receipt event history is immutable';
end;
$$;
create trigger incoming_receipt_events_immutable_trg
before update or delete on public.incoming_receipt_attempt_events
for each row execute function public.incoming_receipt_events_immutable();

create or replace function public.incoming_receipt_attempt_identity_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if (new.line_id,new.generation,new.actor,new.part_number_canonical,new.qty,new.material_fingerprint,new.correlation_id,new.batch_id)
     is distinct from
     (old.line_id,old.generation,old.actor,old.part_number_canonical,old.qty,old.material_fingerprint,old.correlation_id,old.batch_id) then
    raise exception using errcode='55000', message='Incoming receipt attempt identity is immutable';
  end if;
  return new;
end;
$$;
create trigger incoming_receipt_attempt_identity_immutable_trg
before update on public.incoming_receipt_attempts
for each row execute function public.incoming_receipt_attempt_identity_immutable();

create or replace function public.incoming_receipt_attempt_delete_blocked()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception using errcode='55000', message='Incoming receipt attempts are immutable history';
end;
$$;
create trigger incoming_receipt_attempt_delete_blocked_trg
before delete on public.incoming_receipt_attempts
for each row execute function public.incoming_receipt_attempt_delete_blocked();

alter table public.incoming_receipt_lines enable row level security;
alter table public.incoming_receipt_manual_counters enable row level security;
alter table public.incoming_receipt_attempts enable row level security;
alter table public.incoming_receipt_attempt_events enable row level security;
revoke all on table public.incoming_receipt_lines from public, anon, authenticated;
revoke all on table public.incoming_receipt_manual_counters from public, anon, authenticated;
revoke all on table public.incoming_receipt_attempts from public, anon, authenticated;
revoke all on table public.incoming_receipt_attempt_events from public, anon, authenticated;

create or replace function public.incoming_receipt_attempt_payload(
  p_attempt public.incoming_receipt_attempts
) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'attemptId',p_attempt.id,'lineId',p_attempt.line_id,'generation',p_attempt.generation,
    'documentRef',(select l.document_ref from public.incoming_receipt_lines l where l.id=p_attempt.line_id),
    'sourcePage',(select l.source_page from public.incoming_receipt_lines l where l.id=p_attempt.line_id),
    'sourceLineNo',(select l.source_line_no from public.incoming_receipt_lines l where l.id=p_attempt.line_id),
    'lineKind',(select l.line_kind from public.incoming_receipt_lines l where l.id=p_attempt.line_id),
    'state',p_attempt.state,'revision',p_attempt.revision,'partNumber',p_attempt.part_number_canonical,
    'qty',p_attempt.qty,'materialFingerprint',p_attempt.material_fingerprint,
    'correlationId',p_attempt.correlation_id,'batchId',p_attempt.batch_id,
    'receipt',p_attempt.receipt,'acknowledgedAt',p_attempt.acknowledged_at,
    'createdAt',p_attempt.created_at,'updatedAt',p_attempt.updated_at
  );
$$;
revoke all on function public.incoming_receipt_attempt_payload(public.incoming_receipt_attempts)
  from public, anon, authenticated;
revoke all on function public.incoming_receipt_events_immutable() from public,anon,authenticated;
revoke all on function public.incoming_receipt_attempt_identity_immutable() from public,anon,authenticated;
revoke all on function public.incoming_receipt_attempt_delete_blocked() from public,anon,authenticated;

create or replace function public.reserve_incoming_manual_line(
  p_actor text,
  p_document_ref text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(btrim(p_actor),'');
  v_doc text := upper(regexp_replace(btrim(coalesce(p_document_ref,'')), '[[:space:]]+', ' ', 'g'));
  v_line integer;
  v_id uuid;
begin
  if v_actor is null then raise exception using errcode='22023', message='Receipt actor is required'; end if;
  if v_doc = '' or length(v_doc)>200 then raise exception using errcode='22023', message='Receipt document reference is invalid'; end if;
  insert into public.incoming_receipt_manual_counters(document_ref_normalized,source_page_normalized,next_line_no)
  values(v_doc,'MANUAL',2)
  on conflict(document_ref_normalized,source_page_normalized) do update
    set next_line_no=public.incoming_receipt_manual_counters.next_line_no+1, updated_at=now()
    where public.incoming_receipt_manual_counters.next_line_no <= 500
  returning next_line_no-1 into v_line;
  if v_line is null or v_line > 500 then
    raise exception using errcode='22023', message='Receipt manual line limit reached';
  end if;
  insert into public.incoming_receipt_lines(
    document_ref,document_ref_normalized,source_page,source_page_normalized,
    source_line_no,line_kind,created_by
  ) values (btrim(p_document_ref),v_doc,'MANUAL','MANUAL',v_line,'manual',v_actor)
  returning id into v_id;
  return jsonb_build_object(
    'lineId',v_id,'documentRef',btrim(p_document_ref),'sourcePage','MANUAL',
    'sourceLineNo',v_line,'lineKind','manual'
  );
end;
$$;

create or replace function public.register_incoming_receipt_review(
  p_actor text,
  p_document_ref text,
  p_source_page text,
  p_source_line_no integer,
  p_part_number text,
  p_qty integer,
  p_reserved_line_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(btrim(p_actor),'');
  v_doc text := upper(regexp_replace(btrim(coalesce(p_document_ref,'')), '[[:space:]]+', ' ', 'g'));
  v_page text := case when nullif(btrim(coalesce(p_source_page,'')),'') is null then 'PAGE_UNKNOWN'
    else upper(regexp_replace(btrim(p_source_page), '[[:space:]]+', ' ', 'g')) end;
  v_part text := upper(btrim(coalesce(p_part_number,'')));
  v_fingerprint text;
  v_line public.incoming_receipt_lines%rowtype;
  v_attempt public.incoming_receipt_attempts%rowtype;
  v_generation integer;
  v_correlation text;
  v_from_state text;
begin
  if v_actor is null then raise exception using errcode='22023', message='Receipt actor is required'; end if;
  if v_doc='' or length(v_doc)>200 then raise exception using errcode='22023', message='Receipt document reference is invalid'; end if;
  if v_part='' then raise exception using errcode='22023', message='Receipt part number is required'; end if;
  if p_qty is null or p_qty<=0 then raise exception using errcode='22023', message='Receipt quantity is invalid'; end if;
  v_fingerprint := v_part || '|QTY=' || p_qty::text;

  if p_reserved_line_id is not null then
    select * into v_line from public.incoming_receipt_lines where id=p_reserved_line_id for update;
    if not found or v_line.line_kind<>'manual' or v_line.created_by<>v_actor
       or v_line.document_ref_normalized<>v_doc then
      raise exception using errcode='42501', message='Receipt manual line reservation is not available';
    end if;
    if v_page<>'MANUAL' or p_source_line_no is distinct from v_line.source_line_no then
      raise exception using errcode='22023', message='Receipt manual line identity is invalid';
    end if;
  else
    if v_page='MANUAL' then raise exception using errcode='22023', message='Manual receipt line requires server reservation'; end if;
    if p_source_line_no is null or p_source_line_no not between 1 and 500 then
      raise exception using errcode='22023', message='Receipt source line is invalid';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('incoming-line:'||v_doc||'|'||v_page||'|'||p_source_line_no::text,0));
    insert into public.incoming_receipt_lines(
      document_ref,document_ref_normalized,source_page,source_page_normalized,
      source_line_no,line_kind,created_by
    ) values (btrim(p_document_ref),v_doc,nullif(btrim(coalesce(p_source_page,'')),''),v_page,
      p_source_line_no,'source',v_actor)
    on conflict(document_ref_normalized,source_page_normalized,source_line_no) do nothing;
    select * into v_line from public.incoming_receipt_lines
      where document_ref_normalized=v_doc and source_page_normalized=v_page
        and source_line_no=p_source_line_no for update;
  end if;

  if v_line.created_by<>v_actor then
    raise exception using errcode='42501', message='Receipt line is already reserved by another operator';
  end if;

  select * into v_attempt from public.incoming_receipt_attempts
    where line_id=v_line.id and state<>'abandoned' for update;
  if found then
    if v_attempt.actor<>v_actor then
      raise exception using errcode='42501', message='Receipt line is already reserved by another operator';
    end if;
    if v_attempt.material_fingerprint=v_fingerprint then
      return public.incoming_receipt_attempt_payload(v_attempt);
    end if;
    if v_attempt.state='accepted' then
      raise exception using errcode='23505', message='Receipt identity conflicts with an accepted receipt';
    end if;
    v_from_state := v_attempt.state;
    update public.incoming_receipt_attempts
      set state='conflict',revision=revision+1,updated_at=now()
      where id=v_attempt.id returning * into v_attempt;
    insert into public.incoming_receipt_attempt_events(attempt_id,revision,event_type,actor,from_state,to_state,details)
      values(v_attempt.id,v_attempt.revision,'material_conflict',v_actor,
        v_from_state,'conflict',
        jsonb_build_object('requestedPartNumber',v_part,'requestedQty',p_qty));
    return public.incoming_receipt_attempt_payload(v_attempt);
  end if;

  if exists(
    select 1 from public.incoming_receipt_attempts a
    where a.actor=v_actor and a.acknowledged_at is null
      and a.state in ('attempted','unknown','accepted','conflict')
      and a.batch_id<>v_doc
  ) then
    raise exception using errcode='55000', message='A prior receipt requires reconciliation before another document can start';
  end if;

  update public.incoming_receipt_lines set next_generation=next_generation+1
    where id=v_line.id returning next_generation-1 into v_generation;
  v_correlation := 'incoming:'||v_line.id::text||':g'||v_generation::text;
  insert into public.incoming_receipt_attempts(
    line_id,generation,actor,part_number_canonical,qty,material_fingerprint,
    correlation_id,batch_id,state
  ) values (
    v_line.id,v_generation,v_actor,v_part,p_qty,v_fingerprint,
    v_correlation,v_doc,'reviewed'
  ) returning * into v_attempt;
  insert into public.incoming_receipt_attempt_events(
    attempt_id,revision,event_type,actor,from_state,to_state,details
  ) values(v_attempt.id,1,'reviewed',v_actor,null,'reviewed',
    jsonb_build_object('lineId',v_line.id,'generation',v_generation));
  return public.incoming_receipt_attempt_payload(v_attempt);
end;
$$;

create or replace function public.begin_incoming_receipt_attempt(
  p_attempt_id uuid,p_actor text,p_expected_revision bigint
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(btrim(p_actor),'');
  v_before public.incoming_receipt_attempts%rowtype;
  v_after public.incoming_receipt_attempts%rowtype;
begin
  if v_actor is null then raise exception using errcode='22023', message='Receipt actor is required'; end if;
  select * into v_before from public.incoming_receipt_attempts where id=p_attempt_id for update;
  if not found or v_before.actor<>v_actor then raise exception using errcode='42501', message='Receipt attempt is not available'; end if;
  if v_before.state='accepted' then return public.incoming_receipt_attempt_payload(v_before); end if;
  if v_before.state<>'reviewed' then raise exception using errcode='55000', message='Receipt attempt cannot begin from current state'; end if;
  if v_before.revision is distinct from p_expected_revision then raise exception using errcode='40001', message='Receipt attempt revision is stale'; end if;
  update public.incoming_receipt_attempts set state='attempted',revision=revision+1,updated_at=now()
    where id=v_before.id returning * into v_after;
  insert into public.incoming_receipt_attempt_events(attempt_id,revision,event_type,actor,from_state,to_state,details)
    values(v_after.id,v_after.revision,'attempted',v_actor,'reviewed','attempted','{}'::jsonb);
  return public.incoming_receipt_attempt_payload(v_after);
end;
$$;

create or replace function public.mark_incoming_receipt_attempt_unknown(
  p_attempt_id uuid,p_actor text,p_expected_revision bigint
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(btrim(p_actor),'');
  v_before public.incoming_receipt_attempts%rowtype;
  v_after public.incoming_receipt_attempts%rowtype;
begin
  if v_actor is null then raise exception using errcode='22023', message='Receipt actor is required'; end if;
  select * into v_before from public.incoming_receipt_attempts where id=p_attempt_id for update;
  if not found or v_before.actor<>v_actor then raise exception using errcode='42501', message='Receipt attempt is not available'; end if;
  if v_before.state='accepted' then return public.incoming_receipt_attempt_payload(v_before); end if;
  if v_before.state='unknown' then return public.incoming_receipt_attempt_payload(v_before); end if;
  if v_before.state not in ('reviewed','attempted') then raise exception using errcode='55000', message='Receipt attempt cannot be marked unknown from current state'; end if;
  if v_before.revision is distinct from p_expected_revision then raise exception using errcode='40001', message='Receipt attempt revision is stale'; end if;
  update public.incoming_receipt_attempts set state='unknown',revision=revision+1,updated_at=now()
    where id=v_before.id returning * into v_after;
  insert into public.incoming_receipt_attempt_events(attempt_id,revision,event_type,actor,from_state,to_state,details)
    values(v_after.id,v_after.revision,'outcome_unknown',v_actor,v_before.state,'unknown','{}'::jsonb);
  return public.incoming_receipt_attempt_payload(v_after);
end;
$$;

create or replace function public.execute_incoming_receipt_attempt(
  p_attempt_id uuid,p_actor text,p_expected_revision bigint
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(btrim(p_actor),'');
  v_before public.incoming_receipt_attempts%rowtype;
  v_work public.incoming_receipt_attempts%rowtype;
  v_after public.incoming_receipt_attempts%rowtype;
  v_receipt jsonb;
begin
  if v_actor is null then raise exception using errcode='22023', message='Receipt actor is required'; end if;
  select * into v_before from public.incoming_receipt_attempts where id=p_attempt_id for update;
  if not found or v_before.actor<>v_actor then raise exception using errcode='42501', message='Receipt attempt is not available'; end if;
  if v_before.state='accepted' then return public.incoming_receipt_attempt_payload(v_before); end if;
  if v_before.state in ('conflict','abandoned') then raise exception using errcode='55000', message='Receipt attempt requires review'; end if;
  if v_before.state not in ('reviewed','attempted','unknown') then raise exception using errcode='55000', message='Receipt attempt cannot execute from current state'; end if;
  if v_before.revision is distinct from p_expected_revision then raise exception using errcode='40001', message='Receipt attempt revision is stale'; end if;
  update public.incoming_receipt_attempts set state='attempted',revision=revision+1,updated_at=now()
    where id=v_before.id returning * into v_work;
  insert into public.incoming_receipt_attempt_events(attempt_id,revision,event_type,actor,from_state,to_state,details)
    values(v_work.id,v_work.revision,'execute_started',v_actor,v_before.state,'attempted','{}'::jsonb);

  v_receipt := public.apply_inventory_transition(
    v_work.part_number_canonical,'RECEIVE',v_work.qty,v_actor,
    v_work.correlation_id,null,v_work.batch_id
  );
  update public.incoming_receipt_attempts
    set state='accepted',receipt=v_receipt,revision=revision+1,updated_at=now()
    where id=v_work.id returning * into v_after;
  insert into public.incoming_receipt_attempt_events(attempt_id,revision,event_type,actor,from_state,to_state,details)
    values(v_after.id,v_after.revision,'accepted',v_actor,'attempted','accepted',
      jsonb_build_object('correlationId',v_after.correlation_id));
  return public.incoming_receipt_attempt_payload(v_after);
end;
$$;

create or replace function public.abandon_incoming_receipt_attempt(
  p_attempt_id uuid,p_actor text,p_expected_revision bigint,p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(btrim(p_actor),'');
  v_before public.incoming_receipt_attempts%rowtype;
  v_after public.incoming_receipt_attempts%rowtype;
begin
  if v_actor is null then raise exception using errcode='22023', message='Receipt actor is required'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception using errcode='22023', message='Receipt abandon reason is required'; end if;
  select * into v_before from public.incoming_receipt_attempts where id=p_attempt_id for update;
  if not found or v_before.actor<>v_actor then raise exception using errcode='42501', message='Receipt attempt is not available'; end if;
  if v_before.state='accepted' then raise exception using errcode='55000', message='Accepted receipt cannot be abandoned'; end if;
  if v_before.state='abandoned' then return public.incoming_receipt_attempt_payload(v_before); end if;
  if v_before.state not in ('reviewed','attempted','unknown','conflict') then raise exception using errcode='55000', message='Receipt attempt cannot be abandoned from current state'; end if;
  if v_before.revision is distinct from p_expected_revision then raise exception using errcode='40001', message='Receipt attempt revision is stale'; end if;
  if exists(select 1 from public.inventory_operations where correlation_id=v_before.correlation_id)
     or exists(select 1 from public.audit_log where correlation_id=v_before.correlation_id)
     or exists(select 1 from public.sap_staging where correlation_id=v_before.correlation_id) then
    raise exception using errcode='55000', message='Receipt attempt has movement evidence and cannot be abandoned';
  end if;
  update public.incoming_receipt_attempts set state='abandoned',revision=revision+1,updated_at=now()
    where id=v_before.id returning * into v_after;
  insert into public.incoming_receipt_attempt_events(attempt_id,revision,event_type,actor,from_state,to_state,details)
    values(v_after.id,v_after.revision,'abandoned',v_actor,v_before.state,'abandoned',jsonb_build_object('reason',btrim(p_reason)));
  return public.incoming_receipt_attempt_payload(v_after);
end;
$$;

create or replace function public.rereview_incoming_receipt_attempt(
  p_attempt_id uuid,p_actor text,p_expected_revision bigint,p_new_part_number text,p_new_qty integer
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(btrim(p_actor),'');
  v_old public.incoming_receipt_attempts%rowtype;
  v_line public.incoming_receipt_lines%rowtype;
  v_new public.incoming_receipt_attempts%rowtype;
  v_generation integer;
  v_part text;
  v_qty integer;
  v_fingerprint text;
  v_correlation text;
begin
  if v_actor is null then raise exception using errcode='22023', message='Receipt actor is required'; end if;
  select * into v_old from public.incoming_receipt_attempts where id=p_attempt_id for update;
  if not found or v_old.actor<>v_actor then raise exception using errcode='42501', message='Receipt attempt is not available'; end if;
  if v_old.state<>'abandoned' then raise exception using errcode='55000', message='Receipt attempt must be abandoned before re-review'; end if;
  if v_old.revision is distinct from p_expected_revision then raise exception using errcode='40001', message='Receipt attempt revision is stale'; end if;
  if exists(select 1 from public.inventory_operations where correlation_id=v_old.correlation_id)
     or exists(select 1 from public.audit_log where correlation_id=v_old.correlation_id)
     or exists(select 1 from public.sap_staging where correlation_id=v_old.correlation_id) then
    raise exception using errcode='55000', message='Receipt attempt has movement evidence and cannot be re-reviewed';
  end if;
  select * into v_line from public.incoming_receipt_lines where id=v_old.line_id for update;
  if exists(select 1 from public.incoming_receipt_attempts where line_id=v_old.line_id and state<>'abandoned') then
    raise exception using errcode='55000', message='Receipt line already has an active generation';
  end if;
  v_part := upper(btrim(coalesce(nullif(p_new_part_number,''),v_old.part_number_canonical)));
  v_qty := coalesce(p_new_qty,v_old.qty);
  if v_part='' or v_qty<=0 then raise exception using errcode='22023', message='Receipt re-review material is invalid'; end if;
  v_fingerprint := v_part||'|QTY='||v_qty::text;
  update public.incoming_receipt_lines set next_generation=next_generation+1
    where id=v_line.id returning next_generation-1 into v_generation;
  update public.incoming_receipt_attempts set revision=revision+1,updated_at=now()
    where id=v_old.id returning * into v_old;
  insert into public.incoming_receipt_attempt_events(attempt_id,revision,event_type,actor,from_state,to_state,details)
    values(v_old.id,v_old.revision,'rereview_spawned',v_actor,'abandoned','abandoned',
      jsonb_build_object('newGeneration',v_generation,'newPartNumber',v_part,'newQty',v_qty));

  v_correlation := 'incoming:'||v_line.id::text||':g'||v_generation::text;
  insert into public.incoming_receipt_attempts(
    line_id,generation,actor,part_number_canonical,qty,material_fingerprint,
    correlation_id,batch_id,state
  ) values(v_line.id,v_generation,v_actor,v_part,v_qty,v_fingerprint,
    v_correlation,v_line.document_ref_normalized,'reviewed')
  returning * into v_new;
  insert into public.incoming_receipt_attempt_events(attempt_id,revision,event_type,actor,from_state,to_state,details)
    values(v_new.id,1,'rereviewed',v_actor,null,'reviewed',
      jsonb_build_object('priorAttemptId',v_old.id,'priorGeneration',v_old.generation));
  return public.incoming_receipt_attempt_payload(v_new);
end;
$$;

create or replace function public.acknowledge_incoming_receipt_attempt(
  p_attempt_id uuid,p_actor text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(btrim(p_actor),'');
  v_before public.incoming_receipt_attempts%rowtype;
  v_after public.incoming_receipt_attempts%rowtype;
begin
  if v_actor is null then raise exception using errcode='22023', message='Receipt actor is required'; end if;
  select * into v_before from public.incoming_receipt_attempts where id=p_attempt_id for update;
  if not found or v_before.actor<>v_actor then raise exception using errcode='42501', message='Receipt attempt is not available'; end if;
  if v_before.state<>'accepted' then raise exception using errcode='55000', message='Only an accepted receipt can be acknowledged'; end if;
  if v_before.acknowledged_at is not null then return public.incoming_receipt_attempt_payload(v_before); end if;
  update public.incoming_receipt_attempts
    set acknowledged_at=now(),revision=revision+1,updated_at=now()
    where id=v_before.id returning * into v_after;
  insert into public.incoming_receipt_attempt_events(attempt_id,revision,event_type,actor,from_state,to_state,details)
    values(v_after.id,v_after.revision,'acknowledged',v_actor,'accepted','accepted','{}'::jsonb);
  return public.incoming_receipt_attempt_payload(v_after);
end;
$$;

create or replace function public.list_incoming_receipt_recovery(p_actor text)
returns jsonb
language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(public.incoming_receipt_attempt_payload(a) order by a.created_at,a.id),'[]'::jsonb)
  from public.incoming_receipt_attempts a
  where a.actor=nullif(btrim(p_actor),'')
    and a.acknowledged_at is null
    and a.state in ('reviewed','attempted','unknown','accepted','conflict');
$$;

revoke all on function public.reserve_incoming_manual_line(text,text) from public,anon,authenticated;
revoke all on function public.register_incoming_receipt_review(text,text,text,integer,text,integer,uuid) from public,anon,authenticated;
revoke all on function public.begin_incoming_receipt_attempt(uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.mark_incoming_receipt_attempt_unknown(uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.execute_incoming_receipt_attempt(uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.abandon_incoming_receipt_attempt(uuid,text,bigint,text) from public,anon,authenticated;
revoke all on function public.rereview_incoming_receipt_attempt(uuid,text,bigint,text,integer) from public,anon,authenticated;
revoke all on function public.acknowledge_incoming_receipt_attempt(uuid,text) from public,anon,authenticated;
revoke all on function public.list_incoming_receipt_recovery(text) from public,anon,authenticated;

grant execute on function public.reserve_incoming_manual_line(text,text) to service_role;
grant execute on function public.register_incoming_receipt_review(text,text,text,integer,text,integer,uuid) to service_role;
grant execute on function public.begin_incoming_receipt_attempt(uuid,text,bigint) to service_role;
grant execute on function public.mark_incoming_receipt_attempt_unknown(uuid,text,bigint) to service_role;
grant execute on function public.execute_incoming_receipt_attempt(uuid,text,bigint) to service_role;
grant execute on function public.abandon_incoming_receipt_attempt(uuid,text,bigint,text) to service_role;
grant execute on function public.rereview_incoming_receipt_attempt(uuid,text,bigint,text,integer) to service_role;
grant execute on function public.acknowledge_incoming_receipt_attempt(uuid,text) to service_role;
grant execute on function public.list_incoming_receipt_recovery(text) to service_role;


commit;
