-- Durable, authenticated Cycle Count sessions on the inventory database.
create table if not exists public.cycle_schedules (
 id uuid primary key default gen_random_uuid(), name text not null, frequency text not null,
 assigned_to text not null, next_due bigint not null, status text not null default 'active',
 parts jsonb not null default '[]', count_type text default 'standard', created_at timestamptz default now()
);
create table if not exists public.cycle_results (
 id uuid primary key default gen_random_uuid(), schedule_id text not null, timestamp bigint not null,
 counted_by text not null, results jsonb not null default '[]', status text not null,
 sort_mode text, wip_serials jsonb, created_at timestamptz default now()
);
alter table public.cycle_results add column if not exists archived boolean not null default false;
create table public.cycle_count_sessions (
 id uuid primary key default gen_random_uuid(), schedule_id uuid not null references public.cycle_schedules(id),
 status text not null check(status in ('active','paused','completed')),
 revision integer not null default 0, scope_mode text not null check(scope_mode in ('standard','w2w')),
 scope_parts jsonb not null, lines jsonb not null default '[]', sort_mode text not null default 'alpha',
 started_by text not null, updated_by text not null, saved_at timestamptz not null default now(),
 started_at timestamptz not null default now(), completed_at timestamptz, result_id uuid references public.cycle_results(id)
);
create unique index cycle_count_one_open_session on public.cycle_count_sessions(schedule_id) where status in ('active','paused');
create table public.cycle_count_events (
 correlation_id uuid primary key, session_id uuid references public.cycle_count_sessions(id),
 schedule_id uuid references public.cycle_schedules(id), operation text not null, actor text not null,
 request jsonb not null, previous_value jsonb, new_value jsonb, result jsonb not null, created_at timestamptz not null default now()
);
create index cycle_count_events_session on public.cycle_count_events(session_id,created_at);
alter table public.cycle_schedules enable row level security;
alter table public.cycle_results enable row level security;
alter table public.cycle_count_sessions enable row level security;
alter table public.cycle_count_events enable row level security;
revoke all on public.cycle_schedules,public.cycle_results,public.cycle_count_sessions,public.cycle_count_events from public,anon,authenticated;
grant select,insert,update,delete on public.cycle_schedules,public.cycle_results,public.cycle_count_sessions to service_role;
grant select,insert on public.cycle_count_events to service_role;

create function public.block_cycle_count_event_mutation() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Cycle count event history is immutable'; end;
$$;
create trigger cycle_count_events_immutable before update or delete on public.cycle_count_events
 for each row execute function public.block_cycle_count_event_mutation();

-- Resolve quantities by the DHR's stock identity. Part-number matching is only a
-- fallback for legacy rows which have no stock_id. No BOM estimate replaces scans.
create function public.read_cycle_count_wip() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 with active as (
  select id,instrument_sn from public.dhr_scan_sessions where status='in_progress'
 ), quantities as (
  select coalesce(st.part_number, fallback.part_number) as part_number,a.instrument_sn,
   sum(greatest(coalesce(r.scanned_qty,0),0))::integer as qty
  from active a join public.dhr_scan_results r on r.session_id=a.id
  left join public.stock st on st.id=r.stock_id
  left join public.stock fallback on r.stock_id is null and upper(btrim(fallback.part_number))=upper(btrim(r.part_number))
  group by coalesce(st.part_number,fallback.part_number),a.instrument_sn
 ), per_part as (
  select part_number,jsonb_object_agg(instrument_sn,qty order by instrument_sn) as quantities
  from quantities where part_number is not null group by part_number
 )
 select jsonb_build_object(
  'serials',coalesce((select jsonb_agg(instrument_sn order by instrument_sn) from (select distinct instrument_sn from active) x),'[]'::jsonb),
  'parts',coalesce((select jsonb_agg(jsonb_build_object(
   'partNumber',s.part_number,'description',s.description,'type',s.type,'systemQty',s.qty_on_hand,
   'stockToken',coalesce(s.updated_at::text,'initial:'||s.id::text),'minQty',s.min_qty,'maxQty',s.max_qty,'onPlan',s.on_plan,
   'wipEntries',coalesce(p.quantities,'{}'::jsonb)
  ) order by s.part_number) from public.stock s left join per_part p on p.part_number=s.part_number),'[]'::jsonb),
  'fingerprint',md5(coalesce((select jsonb_agg(jsonb_build_array(id,instrument_sn) order by id)::text from active),'[]')
   || coalesce((select jsonb_agg(jsonb_build_array(part_number,instrument_sn,qty) order by part_number,instrument_sn)::text from quantities),'[]')),
  'unmatchedParts',coalesce((select count(*) from quantities where part_number is null),0),
  'loadedAt',extract(epoch from now())*1000
 );
$$;
revoke all on function public.read_cycle_count_wip() from public,anon,authenticated;
grant execute on function public.read_cycle_count_wip() to service_role;

create function public.apply_cycle_count_operation(p_operation text,p_payload jsonb,p_actor text,p_correlation_id uuid)
 returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 v_schedule public.cycle_schedules%rowtype; v_session public.cycle_count_sessions%rowtype;
 v_event public.cycle_count_events%rowtype; v_request jsonb; v_before jsonb; v_after jsonb;
 v_response jsonb; v_scope jsonb; v_lines jsonb; v_line jsonb; v_part text; v_id uuid; v_number numeric;
 v_snapshot jsonb; v_result_lines jsonb := '[]'; v_stock public.stock%rowtype;
 v_qty integer; v_wip integer; v_incoming integer; v_transition jsonb; v_result_id uuid;
begin
 if p_actor is null or length(btrim(p_actor)) not between 1 and 200 then raise exception 'Cycle count actor is required'; end if;
 if p_correlation_id is null then raise exception 'Cycle count operation ID is required'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid cycle count request'; end if;
 v_request:=jsonb_build_object('operation',p_operation,'payload',p_payload);
 perform pg_advisory_xact_lock(hashtextextended('cycle-operation|'||p_correlation_id::text,0));
 select * into v_event from public.cycle_count_events where correlation_id=p_correlation_id;
 if found then
  if v_event.actor<>p_actor or v_event.request<>v_request then raise exception 'Cycle count operation ID was reused for different data'; end if;
  return v_event.result||jsonb_build_object('duplicate',true);
 end if;
 if p_operation='createSchedule' then
  if length(btrim(p_payload->>'name')) not between 1 and 120 then raise exception 'Schedule name is required'; end if;
  if p_payload->>'frequency' not in ('Single','Daily','Weekly','Bi-Weekly','Monthly','Quarterly','Annual') then raise exception 'Invalid cycle count frequency'; end if;
  if jsonb_typeof(p_payload->'parts')<>'array' or jsonb_array_length(p_payload->'parts') not between 1 and 5000 then raise exception 'Select 1–5000 parts'; end if;
  insert into public.cycle_schedules(name,frequency,assigned_to,next_due,parts,count_type)
   values(btrim(p_payload->>'name'),p_payload->>'frequency',coalesce(nullif(btrim(p_payload->>'assignedTo'),''),'Unassigned'),
    (p_payload->>'startDate')::bigint,p_payload->'parts',coalesce(p_payload->>'countType','standard')) returning * into v_schedule;
  v_response:=jsonb_build_object('id',v_schedule.id);
 elsif p_operation='deleteResult' then
  select * into v_schedule from public.cycle_schedules where id=(select schedule_id::uuid from public.cycle_results where id=(p_payload->>'id')::uuid) for update;
  if not found then raise exception 'Cycle count result not found'; end if;
  update public.cycle_results set archived=true where id=(p_payload->>'id')::uuid;
  v_response:=jsonb_build_object('id',p_payload->>'id','archived',true);
 else
  if p_operation in ('save','pause','confirm') then
   select schedule_id into v_id from public.cycle_count_sessions where id=(p_payload->>'sessionId')::uuid;
  else v_id:=(p_payload->>'id')::uuid; end if;
  select * into v_schedule from public.cycle_schedules where id=v_id for update;
  if not found or v_schedule.status='deleted' then raise exception 'Cycle count schedule not found'; end if;
  if p_operation in ('updateSchedule','deleteSchedule') then
   v_before:=to_jsonb(v_schedule);
   if p_operation='deleteSchedule' then
    if exists(select 1 from public.cycle_count_sessions where schedule_id=v_schedule.id and status in ('active','paused')) then raise exception 'Save and finish the open count before deleting its schedule'; end if;
    update public.cycle_schedules set status='deleted' where id=v_schedule.id;
   else
    if p_payload ? 'frequency' and p_payload->>'frequency' not in ('Single','Daily','Weekly','Bi-Weekly','Monthly','Quarterly','Annual') then raise exception 'Invalid cycle count frequency'; end if;
    if p_payload ? 'status' and p_payload->>'status' <> 'active' then raise exception 'Close a schedule through Confirm and Close'; end if;
    update public.cycle_schedules set
     name=coalesce(p_payload->>'name',name),frequency=coalesce(p_payload->>'frequency',frequency),
     assigned_to=coalesce(p_payload->>'assignedTo',assigned_to),next_due=coalesce((p_payload->>'nextDue')::bigint,next_due),
     status=coalesce(p_payload->>'status',status) where id=v_schedule.id;
   end if;
   v_response:=jsonb_build_object('id',v_schedule.id);
  elsif p_operation='start' then
   if v_schedule.status<>'active' then raise exception 'Reopen this schedule before starting a count'; end if;
   select * into v_session from public.cycle_count_sessions where schedule_id=v_schedule.id and status in ('active','paused') for update;
   if not found then
    if p_payload->>'scopeMode'='w2w' then
     select jsonb_agg(part_number order by part_number) into v_scope from public.stock;
    else v_scope:=v_schedule.parts; end if;
    if jsonb_array_length(v_scope) not between 1 and 5000 then raise exception 'Count scope must contain 1–5000 parts'; end if;
    insert into public.cycle_count_sessions(schedule_id,status,scope_mode,scope_parts,sort_mode,started_by,updated_by)
     values(v_schedule.id,'active',coalesce(p_payload->>'scopeMode','standard'),v_scope,
      case when p_payload->>'scopeMode'='w2w' then 'w2w' else 'alpha' end,p_actor,p_actor) returning * into v_session;
   else
    v_before:=to_jsonb(v_session);
    update public.cycle_count_sessions set status='active',revision=revision+1,updated_by=p_actor,saved_at=now()
     where id=v_session.id returning * into v_session;
   end if;
   v_response:=jsonb_build_object('sessionId',v_session.id,'revision',v_session.revision,'status',v_session.status,'savedAt',v_session.saved_at);
  elsif p_operation in ('save','pause','confirm') then
   select * into v_session from public.cycle_count_sessions where id=(p_payload->>'sessionId')::uuid for update;
   if not found or v_session.status<>'active' then raise exception 'Cycle count session is not active'; end if;
   if p_payload->>'expectedRevision' is null or v_session.revision<>(p_payload->>'expectedRevision')::integer then raise exception 'Cycle count conflict: this session changed in another window. Reload saved progress before continuing'; end if;
   v_before:=to_jsonb(v_session);
   v_lines:=p_payload->'lines';
   if jsonb_typeof(v_lines)<>'array' or jsonb_array_length(v_lines)>5000 then raise exception 'Invalid cycle count lines'; end if;
   if p_payload->>'sortMode' not in ('alpha','w2w') then raise exception 'Invalid count order'; end if;
   if p_payload->>'sortMode'='w2w' or v_session.scope_mode='w2w' then
    select jsonb_agg(part_number order by part_number) into v_scope from public.stock;
   else v_scope:=v_session.scope_parts; end if;
   if exists(select 1 from jsonb_array_elements(v_lines) l group by upper(btrim(l->>'partNumber')) having count(*)>1) then raise exception 'Duplicate cycle count part'; end if;
   for v_line in select value from jsonb_array_elements(v_lines) loop
    v_part:=v_line->>'partNumber';
    if v_part is null or not (v_scope ? v_part) then raise exception 'Cycle count part is outside the session scope'; end if;
    if (select count(*) from public.stock where part_number=v_part)<>1 then raise exception 'Cycle count part is missing or ambiguous'; end if;
    if exists(select 1 from jsonb_object_keys(v_line) k where k not in ('partNumber','countedQty','incomingQty','stockToken')) then raise exception 'Unknown cycle count field'; end if;
    if not(v_line ? 'countedQty') or not(v_line ? 'incomingQty') then raise exception 'Count fields must be present, using null for uncounted'; end if;
    for v_number in select (v_line->>k)::numeric from (values('countedQty'),('incomingQty')) x(k) where v_line->k <> 'null'::jsonb loop
     if v_number<0 or v_number>2147483647 or trunc(v_number)<>v_number then raise exception 'Counts must be non-negative whole numbers'; end if;
    end loop;
    if v_line->'countedQty'<>'null'::jsonb and coalesce(v_line->>'stockToken','')='' then raise exception 'Counted parts require a stock snapshot'; end if;
   end loop;
   if p_operation='confirm' then
    if p_payload->>'adjustmentBasis' not in ('counted','counted_wip_incoming') or p_payload->>'adjustmentBasis' is null then raise exception 'Choose a cycle count adjustment basis'; end if;
    if not exists(select 1 from jsonb_array_elements(v_lines) l where l->'countedQty'<>'null'::jsonb) then raise exception 'At least one part must be counted before confirming'; end if;
    -- Freeze the active DHR set and rows while computing the reviewed WIP totals.
    -- This uses the same DHR-before-stock lock order as DHR scan transitions.
    lock table public.dhr_scan_sessions in share mode;
    perform id from public.dhr_scan_sessions where status='in_progress' order by id for share;
    v_snapshot:=public.read_cycle_count_wip();
    if (p_payload->>'wipFingerprint') is distinct from (v_snapshot->>'fingerprint') then raise exception 'DHR WIP changed. Refresh and review the count again'; end if;
    for v_line in select value from jsonb_array_elements(v_lines) where value->'countedQty'<>'null'::jsonb order by value->>'partNumber' loop
     select * into v_stock from public.stock where part_number=v_line->>'partNumber' for update;
     if (v_line->>'stockToken') is distinct from coalesce(v_stock.updated_at::text,'initial:'||v_stock.id::text) then raise exception 'Stock changed during count for %. Re-enter the physical quantity before confirming',v_stock.part_number; end if;
     v_wip:=coalesce((select sum(qty::integer) from jsonb_array_elements(v_snapshot->'parts') p cross join lateral jsonb_each_text(p->'wipEntries') w(sn,qty) where p->>'partNumber'=v_stock.part_number),0);
     v_incoming:=coalesce((v_line->>'incomingQty')::integer,0);
     v_qty:=(v_line->>'countedQty')::integer;
     if p_payload->>'adjustmentBasis'='counted_wip_incoming' then
      if v_line->>'incomingQty' is null then raise exception 'Counts must include Incoming (zero if none) for combined adjustment'; end if;
      if v_qty::bigint+v_wip::bigint+v_incoming::bigint>2147483647 then raise exception 'Counts must total no more than 2147483647'; end if;
      v_qty:=v_qty+v_wip+v_incoming;
     end if;
     if v_qty<>v_stock.qty_on_hand then
      v_transition:=public.apply_inventory_transition(v_stock.part_number,'ADJUST',v_qty,p_actor,
       'cycle-count:'||v_session.id::text||':'||v_stock.id::text,null,'cycle-count:'||v_session.id::text);
     end if;
     v_result_lines:=v_result_lines||jsonb_build_array(jsonb_build_object(
      'partNumber',v_stock.part_number,'systemQty',v_stock.qty_on_hand,'countedQty',(v_line->>'countedQty')::integer,
      'incomingQty',coalesce((v_line->>'incomingQty')::integer,-1),'wipQty',v_wip,
      'wipEntries',coalesce((select jsonb_agg(jsonb_build_object('sn',sn,'qty',qty::integer) order by sn) from jsonb_array_elements(v_snapshot->'parts') p cross join lateral jsonb_each_text(p->'wipEntries') w(sn,qty) where p->>'partNumber'=v_stock.part_number),'[]'),
      'adjustedQty',v_qty,'variance',v_qty-v_stock.qty_on_hand,'adjustmentBasis',p_payload->>'adjustmentBasis'
     ));
    end loop;
    insert into public.cycle_results(schedule_id,timestamp,counted_by,results,status,sort_mode,wip_serials)
     values(v_schedule.id::text,(extract(epoch from now())*1000)::bigint,p_actor,v_result_lines,'completed',p_payload->>'sortMode',v_snapshot->'serials') returning id into v_result_id;
    update public.cycle_count_sessions set lines=v_lines,scope_parts=v_scope,status='completed',revision=revision+1,
     sort_mode=p_payload->>'sortMode',updated_by=p_actor,saved_at=now(),completed_at=now(),result_id=v_result_id
     where id=v_session.id returning * into v_session;
    update public.cycle_schedules set status='completed' where id=v_schedule.id;
    v_response:=jsonb_build_object('sessionId',v_session.id,'revision',v_session.revision,'status',v_session.status,
     'savedAt',v_session.saved_at,'resultId',v_result_id,'countedParts',jsonb_array_length(v_result_lines));
   else
    update public.cycle_count_sessions set lines=v_lines,scope_parts=v_scope,
     scope_mode=case when p_payload->>'sortMode'='w2w' then 'w2w' else scope_mode end,
     sort_mode=p_payload->>'sortMode',status=case when p_operation='pause' then 'paused' else 'active' end,
     revision=revision+1,updated_by=p_actor,saved_at=now() where id=v_session.id returning * into v_session;
    v_response:=jsonb_build_object('sessionId',v_session.id,'revision',v_session.revision,'status',v_session.status,'savedAt',v_session.saved_at);
   end if;
  else raise exception 'Unsupported cycle count operation'; end if;
 end if;
 if v_session.id is not null then v_after:=to_jsonb(v_session); else select to_jsonb(s) into v_after from public.cycle_schedules s where id=v_schedule.id; end if;
 insert into public.cycle_count_events(correlation_id,session_id,schedule_id,operation,actor,request,previous_value,new_value,result)
 values(p_correlation_id,v_session.id,v_schedule.id,p_operation,p_actor,v_request,v_before,v_after,v_response);
 return v_response;
end;
$$;
revoke all on function public.apply_cycle_count_operation(text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.apply_cycle_count_operation(text,jsonb,text,uuid) to service_role;
