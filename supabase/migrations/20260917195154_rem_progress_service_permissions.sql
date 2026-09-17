-- Preserve the canonical employee write boundary while locking attribution rows.
-- A row lock requires UPDATE privilege; the service role intentionally has only SELECT.
create function public.rem_lock_active_engineer(p_engineer_id uuid)
returns setof public.convex_employees language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then
  raise exception 'service_role required';
 end if;
 return query select * from public.convex_employees where id=p_engineer_id and active=true for share;
end $$;
revoke all on function public.rem_lock_active_engineer(uuid) from public,anon,authenticated;
grant execute on function public.rem_lock_active_engineer(uuid) to service_role;

-- Supabase default grants include UPDATE/DELETE: explicitly narrow the new event log.
revoke all on public.rem_progress_events from service_role;
grant select,insert on public.rem_progress_events to service_role;

create or replace function public.apply_rem_progress_update(p_kind text,p_record_id uuid,p_expected_revision bigint,
 p_engineer_id uuid,p_stage text,p_progress jsonb,p_notes text,p_actor text,p_correlation_id text)
returns jsonb language plpgsql security invoker set search_path = pg_catalog,public as $$
declare
 t text; r jsonb; saved jsonb; ev public.rem_progress_events%rowtype;
 emp public.convex_employees%rowtype; req jsonb; k text; n numeric;
 keys text[]; stages text[]; total numeric:=0; reported integer:=0; all_done boolean:=true;
begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then
  raise exception 'service_role required'; end if;
 if p_kind not in ('analyzer','lvcc') or p_kind is null then raise exception 'Invalid REM record kind'; end if;
 if p_record_id is null or p_engineer_id is null or p_expected_revision is null or p_expected_revision<0
  then raise exception 'Record, revision and engineer are required'; end if;
 if coalesce(btrim(p_actor),'')='' or length(p_actor)>200 or coalesce(p_correlation_id,'')!~'^[A-Za-z0-9:._-]{1,180}$'
  then raise exception 'Invalid REM actor or correlation'; end if;
 if p_notes is null or length(p_notes)>4000 then raise exception 'Notes exceed 4000 characters'; end if;
 if p_kind='analyzer' then
 t='rem_analyzers'; keys=array['procurementPct','cleaningPct','servicePct','finalLinePct','packagingPct','releaseTestingPct','qaReleasePct','sapReleasePct']; stages=array['Procurement','Cleaning','Service','Final Line','Packaging','Release Testing','QA Release','SAP Release','Complete'];
 else
 t='rem_lvcc'; keys=array['buildPct','testPct','packagingPct','qaReleasePct','sapReleasePct']; stages=array['Build','Test','Packaging','QA Release','SAP Release','Complete'];
 end if;
 if jsonb_typeof(p_progress) is distinct from 'object' or p_progress - keys <> '{}'::jsonb
  or (select count(*) from jsonb_object_keys(p_progress)) <> cardinality(keys) then
  raise exception 'Every stage percentage must be included'; end if;
 foreach k in array keys loop
  if p_progress->k = 'null'::jsonb then all_done:=false;
  else
   if jsonb_typeof(p_progress->k) <> 'number' then raise exception 'Invalid percentage'; end if;
   n:=(p_progress->>k)::numeric;
   if n<0 or n>100 or n<>trunc(n) then raise exception 'Percentage must be a whole number from 0 to 100'; end if;
   total:=total+n; reported:=reported+1; if n<>100 then all_done:=false; end if;
  end if;
 end loop;
 if p_stage='Complete' and not all_done then raise exception 'Complete requires every stage at 100 percent'; end if;
 req:=jsonb_build_object('kind',p_kind,'recordId',p_record_id,'expectedRevision',p_expected_revision,
  'engineerId',p_engineer_id,'stage',p_stage,'progress',p_progress,'notes',btrim(p_notes),'actor',p_actor);
 perform pg_advisory_xact_lock(hashtextextended(p_correlation_id,0));
 select * into ev from public.rem_progress_events where correlation_id=p_correlation_id;
 if found then
  if ev.request<>req then raise exception 'REM idempotency conflict'; end if;
  return jsonb_build_object('duplicate',true,'record',ev.after_value,'eventId',ev.id,'createdAt',ev.created_at);
 end if;
 select * into emp from public.rem_lock_active_engineer(p_engineer_id);
 if not found then raise exception 'Choose an active engineer'; end if;
 execute format('select to_jsonb(x) from public.%I x where id=$1 for update',t) into r using p_record_id;
 if r is null then raise exception 'REM record not found'; end if;
 if (r->>'progress_revision')::bigint<>p_expected_revision then raise exception 'REM revision conflict; reload latest record'; end if;
 -- Imported legacy stage labels may be preserved, but cannot be introduced on another record.
 if p_stage is null or not(p_stage=any(stages)) and p_stage<>coalesce(r->>'current_stage','') then raise exception 'Invalid REM stage'; end if;
 if p_kind='analyzer' then
 update public.rem_analyzers set
 procurement_pct=(p_progress->>'procurementPct')::numeric,
 cleaning_pct=(p_progress->>'cleaningPct')::numeric,
 service_pct=(p_progress->>'servicePct')::numeric,
 final_line_pct=(p_progress->>'finalLinePct')::numeric,
 packaging_pct=(p_progress->>'packagingPct')::numeric,
 release_testing_pct=(p_progress->>'releaseTestingPct')::numeric,
 qa_release_pct=(p_progress->>'qaReleasePct')::numeric,
 sap_release_pct=(p_progress->>'sapReleasePct')::numeric,
 overall_pct=round(total/cardinality(keys),2), current_pct=case p_stage when 'Procurement' then (p_progress->>'procurementPct')::numeric when 'Cleaning' then (p_progress->>'cleaningPct')::numeric when 'Service' then (p_progress->>'servicePct')::numeric when 'Final Line' then (p_progress->>'finalLinePct')::numeric when 'Packaging' then (p_progress->>'packagingPct')::numeric when 'Release Testing' then (p_progress->>'releaseTestingPct')::numeric when 'QA Release' then (p_progress->>'qaReleasePct')::numeric when 'SAP Release' then (p_progress->>'sapReleasePct')::numeric when 'Complete' then 100 else null end,
 days_in_stage=case when current_stage is distinct from p_stage then 0 else days_in_stage end ,
 current_stage=p_stage,operator_notes=btrim(p_notes),is_complete=(p_stage='Complete'),progress_engineer_name=emp.name
 where id=p_record_id returning public.rem_progress_snapshot(p_kind,to_jsonb(rem_analyzers.*)) into saved;
 else
 update public.rem_lvcc set
 build_pct=(p_progress->>'buildPct')::numeric,
 test_pct=(p_progress->>'testPct')::numeric,
 packaging_pct=(p_progress->>'packagingPct')::numeric,
 qa_release_pct=(p_progress->>'qaReleasePct')::numeric,
 sap_release_pct=(p_progress->>'sapReleasePct')::numeric ,
 end_date=case when p_stage='Complete' then coalesce(end_date,current_date::text) else null end,
 current_stage=p_stage,operator_notes=btrim(p_notes),is_complete=(p_stage='Complete'),progress_engineer_name=emp.name
 where id=p_record_id returning public.rem_progress_snapshot(p_kind,to_jsonb(rem_lvcc.*)) into saved;
 end if;
 insert into public.rem_progress_events(kind,record_id,revision,engineer_id,engineer_name,actor,correlation_id,request,before_value,after_value)
 values(p_kind,p_record_id,(saved->>'revision')::bigint,emp.id,emp.name,p_actor,p_correlation_id,req,public.rem_progress_snapshot(p_kind,r),saved) returning * into ev;
 insert into public.audit_log(action,entity_type,entity_id,user_name,details,old_value,new_value,correlation_id)
 values('REM_PROGRESS_UPDATE',p_kind,p_record_id::text,p_actor,jsonb_build_object('engineerId',emp.id,'engineerName',emp.name,'eventId',ev.id),ev.before_value,saved,p_correlation_id);
 return jsonb_build_object('duplicate',false,'record',saved,'eventId',ev.id,'createdAt',ev.created_at);
end $$;
revoke all on function public.apply_rem_progress_update(text,uuid,bigint,uuid,text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_rem_progress_update(text,uuid,bigint,uuid,text,jsonb,text,text,text) to service_role;

-- Retire unattributed legacy write access; reads and imported records are preserved.
revoke execute on function public.apply_rem_analyzer_operational_update(uuid,text,text,text,text,text,text) from service_role;

create or replace function public.create_rem_lvcc_record(p_serial text,p_type text,p_batch text,p_engineer_id uuid,p_notes text,p_actor text,p_correlation_id text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare emp public.convex_employees%rowtype; ev public.rem_progress_events%rowtype;
 req jsonb; saved jsonb;
begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'service_role required'; end if;
 if coalesce(btrim(p_serial),'')='' or length(p_serial)>120 or p_type is null or p_type not in ('Electrometer','IR Wash — Pump','IR Wash — Module','IR Wash')
 or p_batch is null or length(p_batch)>120 or p_notes is null or length(p_notes)>4000 or coalesce(btrim(p_actor),'')='' or length(p_actor)>200
 or coalesce(p_correlation_id,'')!~'^[A-Za-z0-9:._-]{1,180}$' then raise exception 'Invalid LVCC record'; end if;
 req:=jsonb_build_object('serial',btrim(p_serial),'type',p_type,'batch',btrim(p_batch),'engineerId',p_engineer_id,'notes',btrim(p_notes),'actor',p_actor);
 perform pg_advisory_xact_lock(hashtextextended(p_correlation_id,0));
 select * into ev from public.rem_progress_events where correlation_id=p_correlation_id;
 if found then
  if ev.request<>req then raise exception 'REM idempotency conflict'; end if;
  return jsonb_build_object('duplicate',true,'record',ev.after_value,'eventId',ev.id,'createdAt',ev.created_at);
 end if;
 select * into emp from public.rem_lock_active_engineer(p_engineer_id);
 if not found then raise exception 'Choose an active engineer'; end if;
 perform pg_advisory_xact_lock(hashtextextended('lvcc:'||upper(btrim(p_serial)),0));
 if exists(select 1 from public.rem_lvcc where upper(btrim(serial_number))=upper(btrim(p_serial))) then raise exception 'LVCC serial already exists'; end if;
 insert into public.rem_lvcc(serial_number,item_type,batch_number,start_date,current_stage,build_pct,test_pct,packaging_pct,qa_release_pct,sap_release_pct,is_complete,operator_notes,progress_updated_at,progress_engineer_name)
 values(btrim(p_serial),p_type,btrim(p_batch),current_date::text,'Build',0,0,0,0,0,false,btrim(p_notes),clock_timestamp(),emp.name)
 returning public.rem_progress_snapshot('lvcc',to_jsonb(rem_lvcc.*)) into saved;
 insert into public.rem_progress_events(kind,record_id,revision,engineer_id,engineer_name,actor,correlation_id,request,after_value)
 values('lvcc',(saved->>'id')::uuid,0,emp.id,emp.name,p_actor,p_correlation_id,req,saved) returning * into ev;
 insert into public.audit_log(action,entity_type,entity_id,user_name,details,new_value,correlation_id)
 values('REM_LVCC_CREATE','lvcc',saved->>'id',p_actor,jsonb_build_object('engineerId',emp.id,'engineerName',emp.name),saved,p_correlation_id);
 return jsonb_build_object('duplicate',false,'record',saved,'eventId',ev.id,'createdAt',ev.created_at);
end $$;
revoke all on function public.create_rem_lvcc_record(text,text,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_rem_lvcc_record(text,text,text,uuid,text,text,text) to service_role;
