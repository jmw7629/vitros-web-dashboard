-- Task notes are append-only; an acknowledgment preserves content and attribution.
create table public.rem_task_notes (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('analyzer','vision','lvcc')),
 record_id uuid not null, stage text not null check(length(stage) between 1 and 120),
 content text not null check(length(btrim(content)) between 1 and 4000),
 engineer_id uuid not null, engineer_name text not null, actor text not null,
 correlation_id text not null unique,
 source_event_id uuid unique,
 created_at timestamptz not null default clock_timestamp(),
 acknowledged_at timestamptz, acknowledged_engineer_id uuid, acknowledged_by text,
 acknowledged_actor text, acknowledgment_correlation_id text unique,
 check ((acknowledged_at is null and acknowledged_engineer_id is null and acknowledged_by is null and acknowledged_actor is null and acknowledgment_correlation_id is null)
 or (acknowledged_at is not null and acknowledged_engineer_id is not null and acknowledged_by is not null and acknowledged_actor is not null and acknowledgment_correlation_id is not null))
);
create index rem_task_notes_record on public.rem_task_notes(kind,record_id,created_at desc);
create index rem_task_notes_pending on public.rem_task_notes(kind,record_id,stage) where acknowledged_at is null;
alter table public.rem_task_notes enable row level security;
revoke all on public.rem_task_notes from public,anon,authenticated,service_role;
grant select,insert on public.rem_task_notes to service_role;
grant update(acknowledged_at,acknowledged_engineer_id,acknowledged_by,acknowledged_actor,acknowledgment_correlation_id) on public.rem_task_notes to service_role;

create function public.rem_task_note_snapshot(r jsonb) returns jsonb language sql immutable set search_path=pg_catalog,public as $$
select jsonb_build_object('id',r->'id','stage',r->'stage','content',r->'content','engineerName',r->'engineer_name','createdAt',r->'created_at','acknowledgedAt',r->'acknowledged_at','acknowledgedBy',r->'acknowledged_by');
$$;
revoke all on function public.rem_task_note_snapshot(jsonb) from public,anon,authenticated;
grant execute on function public.rem_task_note_snapshot(jsonb) to service_role;

create function public.protect_rem_task_note() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if old.acknowledged_at is not null or (to_jsonb(new)-array['acknowledged_at','acknowledged_engineer_id','acknowledged_by','acknowledged_actor','acknowledgment_correlation_id']) is distinct from (to_jsonb(old)-array['acknowledged_at','acknowledged_engineer_id','acknowledged_by','acknowledged_actor','acknowledgment_correlation_id']) then
 raise exception 'Task note history is immutable'; end if;
 return new;
end $$;
create trigger protect_rem_task_note before update on public.rem_task_notes for each row execute function public.protect_rem_task_note();
revoke all on function public.protect_rem_task_note() from public,anon,authenticated;

-- Older clients still save operator notes with progress; capture changed notes in that transaction.
create function public.capture_rem_progress_note() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare n public.rem_task_notes;
begin
 if coalesce(btrim(new.after_value->>'notes'),'')<>'' and btrim(new.after_value->>'notes') is distinct from coalesce(btrim(new.before_value->>'notes'),'') then
  insert into public.rem_task_notes(kind,record_id,stage,content,engineer_id,engineer_name,actor,correlation_id,source_event_id,created_at)
  values(new.kind,new.record_id,coalesce(nullif(new.after_value->>'currentStage',''),'Unassigned'),btrim(new.after_value->>'notes'),new.engineer_id,new.engineer_name,new.actor,'progress-note:'||new.id,new.id,new.created_at) returning * into n;
  insert into public.audit_log(action,entity_type,entity_id,user_name,details,new_value,correlation_id)
  values('REM_TASK_NOTE_ADD',new.kind,new.record_id::text,new.actor,jsonb_build_object('noteId',n.id,'sourceEventId',new.id),public.rem_task_note_snapshot(to_jsonb(n)),n.correlation_id);
 end if;
 return new;
end $$;
create trigger capture_rem_progress_note after insert on public.rem_progress_events for each row execute function public.capture_rem_progress_note();
revoke all on function public.capture_rem_progress_note() from public,anon,authenticated;

-- Preserve the author and original time of any existing attributed notes.
insert into public.rem_task_notes(kind,record_id,stage,content,engineer_id,engineer_name,actor,correlation_id,source_event_id,created_at)
select kind,record_id,coalesce(nullif(after_value->>'currentStage',''),'Unassigned'),btrim(after_value->>'notes'),engineer_id,engineer_name,actor,'progress-note:'||id,id,created_at
from public.rem_progress_events where coalesce(btrim(after_value->>'notes'),'')<>'' and btrim(after_value->>'notes') is distinct from coalesce(btrim(before_value->>'notes'),'');

create function public.add_rem_task_note(p_kind text,p_record_id uuid,p_stage text,p_content text,p_engineer_id uuid,p_actor text,p_correlation_id text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare emp public.convex_employees%rowtype; n public.rem_task_notes; r jsonb; stages text[];
begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'service_role required';end if;
 if p_kind is null or p_kind not in ('analyzer','vision','lvcc') or p_record_id is null or p_engineer_id is null or length(btrim(coalesce(p_content,''))) not between 1 and 4000
 or coalesce(btrim(p_actor),'')='' or length(p_actor)>200 or coalesce(p_correlation_id,'')!~'^[A-Za-z0-9:._-]{1,180}$' then raise exception 'Invalid task note';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_correlation_id,0));
 select * into n from public.rem_task_notes where correlation_id=p_correlation_id;
 if found then
  if n.kind<>p_kind or n.record_id<>p_record_id or n.stage is distinct from p_stage or n.content<>btrim(p_content) or n.engineer_id<>p_engineer_id or n.actor<>p_actor then raise exception 'REM idempotency conflict';end if;
  return jsonb_build_object('duplicate',true,'note',public.rem_task_note_snapshot(to_jsonb(n)));
 end if;
 select * into emp from public.rem_lock_active_engineer(p_engineer_id);if not found then raise exception 'Choose an active engineer';end if;
 if p_kind='lvcc' then select to_jsonb(x) into r from public.rem_lvcc x where id=p_record_id for share;
 else select to_jsonb(x) into r from public.rem_analyzers x where id=p_record_id for share;end if;
 if r is null or (p_kind='vision' and r->>'analyzer_type'<>'VISION') or (p_kind='analyzer' and r->>'analyzer_type'='VISION') then raise exception 'REM record not found';end if;
 stages:=case p_kind when 'analyzer' then array['Procurement','Cleaning','Service','Final Line','Release Testing','Packaging','QA Release','SAP Release','Complete','Unassigned'] when 'vision' then array['Service','Final Line','Packaging','Release Testing','QA Release','SAP Release','Complete','Unassigned'] else array['Build','Test','Packaging','QA Release','SAP Release','Complete','Unassigned'] end;
 if p_stage is null or (not(p_stage=any(stages)) and p_stage<>coalesce(r->>'current_stage','')) or length(p_stage) not between 1 and 120 then raise exception 'Invalid REM stage';end if;
 insert into public.rem_task_notes(kind,record_id,stage,content,engineer_id,engineer_name,actor,correlation_id)
 values(p_kind,p_record_id,p_stage,btrim(p_content),emp.id,emp.name,p_actor,p_correlation_id) returning * into n;
 insert into public.audit_log(action,entity_type,entity_id,user_name,details,new_value,correlation_id)
 values('REM_TASK_NOTE_ADD',p_kind,p_record_id::text,p_actor,jsonb_build_object('noteId',n.id,'engineerId',emp.id,'engineerName',emp.name),public.rem_task_note_snapshot(to_jsonb(n)),p_correlation_id);
 return jsonb_build_object('duplicate',false,'note',public.rem_task_note_snapshot(to_jsonb(n)));
end $$;
revoke all on function public.add_rem_task_note(text,uuid,text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.add_rem_task_note(text,uuid,text,text,uuid,text,text) to service_role;

create function public.acknowledge_rem_task_note(p_kind text,p_record_id uuid,p_note_id uuid,p_engineer_id uuid,p_actor text,p_correlation_id text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare emp public.convex_employees%rowtype; n public.rem_task_notes; prior jsonb;
begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'service_role required';end if;
 if p_kind is null or p_kind not in ('analyzer','vision','lvcc') or p_record_id is null or p_note_id is null or p_engineer_id is null
 or coalesce(btrim(p_actor),'')='' or length(p_actor)>200 or coalesce(p_correlation_id,'')!~'^[A-Za-z0-9:._-]{1,180}$' then raise exception 'Invalid task note';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_correlation_id,0));
 select * into n from public.rem_task_notes where acknowledgment_correlation_id=p_correlation_id;
 if found then
  if n.kind<>p_kind or n.record_id<>p_record_id or n.id<>p_note_id or n.acknowledged_engineer_id<>p_engineer_id or n.acknowledged_actor<>p_actor then raise exception 'REM idempotency conflict';end if;
  return jsonb_build_object('duplicate',true,'note',public.rem_task_note_snapshot(to_jsonb(n)));
 end if;
 select * into emp from public.rem_lock_active_engineer(p_engineer_id);if not found then raise exception 'Choose an active engineer';end if;
 select * into n from public.rem_task_notes where id=p_note_id and kind=p_kind and record_id=p_record_id for update;
 if not found then raise exception 'Task note not found';end if;
 if n.acknowledged_at is not null then raise exception 'Note already acknowledged';end if;
 prior:=public.rem_task_note_snapshot(to_jsonb(n));
 update public.rem_task_notes set acknowledged_at=clock_timestamp(),acknowledged_engineer_id=emp.id,acknowledged_by=emp.name,acknowledged_actor=p_actor,acknowledgment_correlation_id=p_correlation_id where id=p_note_id returning * into n;
 insert into public.audit_log(action,entity_type,entity_id,user_name,details,old_value,new_value,correlation_id)
 values('REM_TASK_NOTE_ACKNOWLEDGE',p_kind,p_record_id::text,p_actor,jsonb_build_object('noteId',n.id,'engineerId',emp.id,'engineerName',emp.name),prior,public.rem_task_note_snapshot(to_jsonb(n)),p_correlation_id);
 return jsonb_build_object('duplicate',false,'note',public.rem_task_note_snapshot(to_jsonb(n)));
end $$;
revoke all on function public.acknowledge_rem_task_note(text,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.acknowledge_rem_task_note(text,uuid,uuid,uuid,text,text) to service_role;

-- A scalar JSON result avoids silently truncating stage counts at the REST row cap.
create function public.rem_task_note_summaries(p_analyzer_ids uuid[],p_lvcc_ids uuid[]) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'service_role required';end if;
 if coalesce(cardinality(p_analyzer_ids),0)>500 or coalesce(cardinality(p_lvcc_ids),0)>500 then raise exception 'Too many REM records';end if;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into result from (
  select kind,record_id as "recordId",jsonb_agg(jsonb_build_object('stage',stage,'count',n) order by stage) as "pendingNotes" from (
   select kind,record_id,stage,count(*) n from public.rem_task_notes where acknowledged_at is null and ((kind in ('analyzer','vision') and record_id=any(p_analyzer_ids)) or (kind='lvcc' and record_id=any(p_lvcc_ids))) group by kind,record_id,stage
  ) grouped group by kind,record_id
 ) x;
 return result;
end $$;
revoke all on function public.rem_task_note_summaries(uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.rem_task_note_summaries(uuid[],uuid[]) to service_role;
