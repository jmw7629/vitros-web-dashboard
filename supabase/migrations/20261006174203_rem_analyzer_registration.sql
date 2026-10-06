-- Registered units remain current until the production workbook adopts them.
alter table public.rem_analyzers add column registration_origin text not null default 'workbook'
 check (registration_origin in ('workbook','manual'));
alter table public.rem_progress_events drop constraint rem_progress_events_kind_check;
alter table public.rem_progress_events add constraint rem_progress_events_kind_check check (kind in ('analyzer','vision','lvcc'));

create or replace function public.rem_progress_snapshot(p_kind text,p_row jsonb) returns jsonb
language sql immutable set search_path = pg_catalog,public as $$
select jsonb_build_object('startDate',p_row->'start_date','endDate',p_row->'end_date','id',p_row->>'id','serialNumber',p_row->>'serial_number',
 'itemType',coalesce(p_row->>'analyzer_type',p_row->>'item_type',''),
 'currentStage',coalesce(p_row->>'current_stage',''),'revision',p_row->'progress_revision',
 'notes',coalesce(p_row->>'operator_notes',''),'updatedAt',p_row->'progress_updated_at',
 'engineerName',p_row->'progress_engineer_name','progress',case when p_kind='analyzer' then
jsonb_build_object('procurementPct',p_row->'procurement_pct','cleaningPct',p_row->'cleaning_pct','servicePct',p_row->'service_pct','finalLinePct',p_row->'final_line_pct','packagingPct',p_row->'packaging_pct','releaseTestingPct',p_row->'release_testing_pct','qaReleasePct',p_row->'qa_release_pct','sapReleasePct',p_row->'sap_release_pct') when p_kind='vision' then
jsonb_build_object('servicePct',p_row->'service_pct','finalLinePct',p_row->'final_line_pct','packagingPct',p_row->'packaging_pct','releaseTestingPct',p_row->'release_testing_pct','qaReleasePct',p_row->'qa_release_pct','sapReleasePct',p_row->'sap_release_pct') else
jsonb_build_object('buildPct',p_row->'build_pct','testPct',p_row->'test_pct','packagingPct',p_row->'packaging_pct','qaReleasePct',p_row->'qa_release_pct','sapReleasePct',p_row->'sap_release_pct') end);
$$;
revoke all on function public.rem_progress_snapshot(text,jsonb) from public,anon,authenticated;
grant execute on function public.rem_progress_snapshot(text,jsonb) to service_role;


create function public.create_rem_analyzer_record(p_family text,p_serial text,p_type text,p_production_order numeric,
 p_engineer_id uuid,p_notes text,p_actor text,p_correlation_id text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare emp public.convex_employees%rowtype; ev public.rem_progress_events%rowtype;
 req jsonb; saved jsonb; serial text:=upper(btrim(p_serial)); record_kind text;
begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'service_role required'; end if;
 if p_family is null or p_family not in ('VITROS','VISION') or p_type is null
 or (p_family='VITROS' and (p_type not in ('3600','5600','7600') or serial !~ '^\d{8}$' or left(serial,4)<>p_type))
 or (p_family='VISION' and p_type<>'VISION') or coalesce(serial,'') !~ '^[A-Z0-9][A-Z0-9._-]{0,119}$'
 or (p_production_order is not null and (p_production_order<0 or p_production_order>1000000 or p_production_order<>trunc(p_production_order) or p_production_order::text in ('NaN','Infinity','-Infinity')))
 or p_notes is null or length(p_notes)>4000 or coalesce(btrim(p_actor),'')='' or length(p_actor)>200
 or coalesce(p_correlation_id,'')!~'^[A-Za-z0-9:._-]{1,180}$' then raise exception 'Invalid analyzer registration'; end if;
 record_kind:=case when p_family='VISION' then 'vision' else 'analyzer' end;
 req:=jsonb_build_object('family',p_family,'serial',serial,'type',p_type,'productionOrder',p_production_order,'engineerId',p_engineer_id,'notes',btrim(p_notes),'actor',p_actor);
 -- Use the same lock order and serial namespace as authoritative imports.
 perform pg_advisory_xact_lock(hashtextextended('rem-full-workbook-finalize',0));
 perform pg_advisory_xact_lock(hashtextextended(p_correlation_id,0));
 select * into ev from public.rem_progress_events where correlation_id=p_correlation_id;
 if found then
  if ev.request<>req then raise exception 'REM idempotency conflict'; end if;
  return jsonb_build_object('duplicate',true,'record',ev.after_value,'eventId',ev.id,'createdAt',ev.created_at);
 end if;
 select * into emp from public.rem_lock_active_engineer(p_engineer_id);
 if not found then raise exception 'Choose an active engineer'; end if;
 perform pg_advisory_xact_lock(hashtextextended('rem-analyzer|'||serial,0));
 if exists(select 1 from public.rem_analyzers where upper(btrim(serial_number))=serial) then raise exception 'Analyzer serial already exists'; end if;
 insert into public.rem_analyzers(serial_number,analyzer_type,production_order,current_stage,
 procurement_pct,cleaning_pct,service_pct,final_line_pct,packaging_pct,release_testing_pct,qa_release_pct,sap_release_pct,
 overall_pct,current_pct,days_in_stage,sla_days,start_date,is_complete,operator_notes,progress_updated_at,progress_engineer_name,
 workbook_current,registration_origin)
 values(serial,p_type,p_production_order,'Unassigned',null,null,null,null,null,null,null,null,
 null,null,null,null,null,false,btrim(p_notes),clock_timestamp(),emp.name,true,'manual')
 returning public.rem_progress_snapshot(record_kind,to_jsonb(rem_analyzers.*)) into saved;
 insert into public.rem_progress_events(kind,record_id,revision,engineer_id,engineer_name,actor,correlation_id,request,after_value)
 values(record_kind,(saved->>'id')::uuid,0,emp.id,emp.name,p_actor,p_correlation_id,req,saved) returning * into ev;
 insert into public.audit_log(action,entity_type,entity_id,user_name,details,new_value,correlation_id)
 values('REM_ANALYZER_CREATE',record_kind,saved->>'id',p_actor,jsonb_build_object('family',p_family,'engineerId',emp.id,'engineerName',emp.name),saved,p_correlation_id);
 return jsonb_build_object('duplicate',false,'record',saved,'eventId',ev.id,'createdAt',ev.created_at);
end $$;
revoke all on function public.create_rem_analyzer_record(text,text,text,numeric,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_rem_analyzer_record(text,text,text,numeric,uuid,text,text,text) to service_role;

CREATE OR REPLACE FUNCTION public.apply_rem_progress_update(p_kind text, p_record_id uuid, p_expected_revision bigint, p_engineer_id uuid, p_stage text, p_progress jsonb, p_notes text, p_actor text, p_correlation_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 t text; r jsonb; saved jsonb; ev public.rem_progress_events%rowtype;
 emp public.convex_employees%rowtype; req jsonb; k text; n numeric;
 keys text[]; stages text[]; stage_index integer; stage_pos integer; total numeric:=0; reported integer:=0; all_done boolean:=true;
begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then
  raise exception 'service_role required'; end if;
 if p_kind not in ('analyzer','vision','lvcc') or p_kind is null then raise exception 'Invalid REM record kind'; end if;
 if p_record_id is null or p_engineer_id is null or p_expected_revision is null or p_expected_revision<0
  then raise exception 'Record, revision and engineer are required'; end if;
 if coalesce(btrim(p_actor),'')='' or length(p_actor)>200 or coalesce(p_correlation_id,'')!~'^[A-Za-z0-9:._-]{1,180}$'
  then raise exception 'Invalid REM actor or correlation'; end if;
 if p_notes is null or length(p_notes)>4000 then raise exception 'Notes exceed 4000 characters'; end if;
 if p_kind='analyzer' then
 t='rem_analyzers'; keys=array['procurementPct','cleaningPct','servicePct','finalLinePct','releaseTestingPct','packagingPct','qaReleasePct','sapReleasePct']; stages=array['Procurement','Cleaning','Service','Final Line','Release Testing','Packaging','QA Release','SAP Release','Complete'];
 elsif p_kind='vision' then
 t='rem_analyzers'; keys=array['servicePct','finalLinePct','packagingPct','releaseTestingPct','qaReleasePct','sapReleasePct']; stages=array['Service','Final Line','Packaging','Release Testing','QA Release','SAP Release','Complete'];
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
 if r is null or (p_kind='vision' and r->>'analyzer_type'<>'VISION') or (p_kind='analyzer' and r->>'analyzer_type'='VISION') then raise exception 'REM record not found'; end if;
 if (r->>'progress_revision')::bigint<>p_expected_revision then raise exception 'REM revision conflict; reload latest record'; end if;
 -- Imported legacy stage labels may be preserved, but cannot be introduced on another record.
 if p_stage is null or not(p_stage=any(stages)) and p_stage<>coalesce(r->>'current_stage','') then raise exception 'Invalid REM stage'; end if;
 -- The chosen stage establishes completion of earlier work, independently of the client.
 stage_index:=array_position(stages,p_stage);
 if stage_index is not null and p_stage<>'Complete' then
  for stage_pos in 1..stage_index-1 loop
   p_progress:=jsonb_set(p_progress,array[keys[stage_pos]],'100'::jsonb);
  end loop;
 end if;
 total:=0; reported:=0;
 foreach k in array keys loop
  if p_progress->k <> 'null'::jsonb then total:=total+(p_progress->>k)::numeric; reported:=reported+1; end if;
 end loop;
 if p_kind in ('analyzer','vision') then
 update public.rem_analyzers set
 procurement_pct=(p_progress->>'procurementPct')::numeric,
 cleaning_pct=(p_progress->>'cleaningPct')::numeric,
 service_pct=(p_progress->>'servicePct')::numeric,
 final_line_pct=(p_progress->>'finalLinePct')::numeric,
 packaging_pct=(p_progress->>'packagingPct')::numeric,
 release_testing_pct=(p_progress->>'releaseTestingPct')::numeric,
 qa_release_pct=(p_progress->>'qaReleasePct')::numeric,
 sap_release_pct=(p_progress->>'sapReleasePct')::numeric,
 overall_pct=case when reported=cardinality(keys) then round(total/cardinality(keys),2) else null end, current_pct=case p_stage when 'Procurement' then (p_progress->>'procurementPct')::numeric when 'Cleaning' then (p_progress->>'cleaningPct')::numeric when 'Service' then (p_progress->>'servicePct')::numeric when 'Final Line' then (p_progress->>'finalLinePct')::numeric when 'Packaging' then (p_progress->>'packagingPct')::numeric when 'Release Testing' then (p_progress->>'releaseTestingPct')::numeric when 'QA Release' then (p_progress->>'qaReleasePct')::numeric when 'SAP Release' then (p_progress->>'sapReleasePct')::numeric when 'Complete' then 100 else null end,
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
end $function$

;

CREATE OR REPLACE FUNCTION public.apply_rem_authoritative_workbook_import(p_file_hash text, p_file_name text, p_plan_year integer, p_source_sheet text, p_source_week integer, p_actor text, p_analyzers jsonb, p_tracker_weekly jsonb, p_build_plan jsonb, p_staff jsonb, p_weekly_notes jsonb, p_targets jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r jsonb;
  v_existing_result jsonb;
  v_fingerprint text;
  v_key text;
  v_serial text;
  v_type text;
  v_po numeric;
  v_clean numeric;
  v_service numeric;
  v_final numeric;
  v_release numeric;
  v_pack numeric;
  v_complete boolean;
  v_stage text;
  v_matches integer;
  v_week integer;
  v_quarter text;
  v_product text;
  v_week_start text;
  v_name text;
  v_wwid text;
  v_role text;
  v_fte numeric;
  v_note_array jsonb;
  v_text text;
  v_target_type text;
  v_target_value numeric;
  v_actual_value numeric;
  v_analyzer_inserted integer := 0;
  v_analyzer_updated integer := 0;
  v_tracker_inserted integer := 0;
  v_tracker_updated integer := 0;
  v_build_inserted integer := 0;
  v_build_updated integer := 0;
  v_staff_inserted integer := 0;
  v_staff_updated integer := 0;
  v_note_inserted integer := 0;
  v_note_updated integer := 0;
  v_target_inserted integer := 0;
  v_target_updated integer := 0;
  v_result jsonb;
  v_values numeric[]; v_labels text[] := array['Cleaning','Service','Final Line','Release Testing','Packaging'];
  v_latest integer; v_idx integer; v_proc numeric; v_current numeric;
  v_old jsonb; v_new jsonb; v_retired integer := 0;
  v_section record; v_snapshots jsonb := '{}'::jsonb;
begin
  if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'service_role required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rem-full-workbook-finalize',0));
  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_file_hash'; end if;
  if p_file_name is null or length(btrim(p_file_name)) = 0 or length(p_file_name) > 255 then raise exception 'invalid_file_name'; end if;
  if p_plan_year is null or p_plan_year < 2020 or p_plan_year > 2100 then raise exception 'invalid_plan_year'; end if;
  if p_source_sheet is null or length(btrim(p_source_sheet)) = 0 or length(p_source_sheet) > 160 then raise exception 'invalid_source_sheet'; end if;
  if p_source_week is not null and (p_source_week < 1 or p_source_week > 53) then raise exception 'invalid_source_week'; end if;
  if p_actor is null or length(btrim(p_actor)) = 0 or length(p_actor) > 200 then raise exception 'invalid_actor'; end if;

  if jsonb_typeof(p_analyzers) is distinct from 'array' or jsonb_array_length(p_analyzers) < 5 or jsonb_array_length(p_analyzers) > 250 then raise exception 'invalid_analyzer_rows'; end if;
  if jsonb_typeof(p_tracker_weekly) is distinct from 'array' or jsonb_array_length(p_tracker_weekly) < 40 or jsonb_array_length(p_tracker_weekly) > 260 then raise exception 'invalid_tracker_rows'; end if;
  if jsonb_typeof(p_build_plan) is distinct from 'array' or jsonb_array_length(p_build_plan) < 20 or jsonb_array_length(p_build_plan) > 53 then raise exception 'invalid_build_plan_rows'; end if;
  if jsonb_typeof(p_staff) is distinct from 'array' or jsonb_array_length(p_staff) < 5 or jsonb_array_length(p_staff) > 250 then raise exception 'invalid_staff_rows'; end if;
  if jsonb_typeof(p_weekly_notes) is distinct from 'array' or jsonb_array_length(p_weekly_notes) > 53 then raise exception 'invalid_note_rows'; end if;
  if jsonb_typeof(p_targets) is distinct from 'array' or jsonb_array_length(p_targets) < 1 or jsonb_array_length(p_targets) > 32 then raise exception 'invalid_target_rows'; end if;

  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('planYear',p_plan_year,'sourceSheet',p_source_sheet,'sourceWeek',p_source_week,'analyzers',p_analyzers,'tracker',p_tracker_weekly,'buildPlan',p_build_plan,'staff',p_staff,'notes',p_weekly_notes,'targets',p_targets)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('rem-authoritative-import|' || p_file_hash || '|3', 0));
  select result into v_existing_result
  from public.rem_authoritative_import_runs
  where file_hash = p_file_hash and schema_version = 3;
  if found then
    if v_existing_result->>'payload_fingerprint' is distinct from v_fingerprint then raise exception 'core_import_retry_conflict'; end if;
    return coalesce(v_existing_result, '{}'::jsonb) || jsonb_build_object('already_applied', true);
  end if;

  if exists (
    select 1 from (
      select upper(btrim(value->>'serialNumber')) as serial, count(*)
      from jsonb_array_elements(p_analyzers)
      group by upper(btrim(value->>'serialNumber'))
      having count(*) > 1
    ) d
  ) then raise exception 'duplicate_serial_in_import'; end if;

  -- Reject duplicate identities before any write, including direct service calls.
  for v_section in select * from (values
    ('tracker',p_tracker_weekly),('build_plan',p_build_plan),('staff',p_staff),
    ('weekly_notes',p_weekly_notes),('targets',p_targets)
  ) sections(name,rows) loop
    if exists(select 1 from jsonb_array_elements(v_section.rows) j
      group by btrim(j->>'sourceKey') having count(*) > 1) then
      raise exception 'duplicate_section_key:%',v_section.name;
    end if;
  end loop;

  -- Capture all source-year planning state so replacements and legacy adoption are auditable.
  for v_section in select * from (values
    ('rem_tracker_weekly','plan_year'),('rem_build_plan','plan_year'),('rem_staff','plan_year'),
    ('rem_weekly_notes','plan_year'),('rem_targets','year')
  ) sections(name,year_column) loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by t.id), ''[]''::jsonb) from public.%I t where %I=$1',v_section.name,v_section.year_column)
      into v_old using p_plan_year;
    v_snapshots := jsonb_set(v_snapshots,array[v_section.name],v_old);
  end loop;

  for r in select value from jsonb_array_elements(p_analyzers) order by upper(btrim(value->>'serialNumber')) loop
    v_serial := upper(btrim(coalesce(r->>'serialNumber', '')));
    v_type := btrim(coalesce(r->>'analyzerType', ''));
    if v_serial !~ '^\d{8}$' then raise exception 'invalid_serial_number'; end if;
    if v_type not in ('3600','5600','7600') then raise exception 'invalid_analyzer_type'; end if;
    begin v_po := nullif(r->>'productionOrder', '')::numeric; exception when others then raise exception 'invalid_production_order'; end;
    if v_po is not null and (v_po < 0 or v_po > 1000000) then raise exception 'invalid_production_order'; end if;
    begin
      v_values := array[(r->>'cleaningPct')::numeric,(r->>'servicePct')::numeric,(r->>'finalLinePct')::numeric,(r->>'releaseTestingPct')::numeric,(r->>'packagingPct')::numeric];
    exception when others then raise exception 'invalid_progress_value'; end;
    if exists(select 1 from unnest(v_values) n where n < 0 or n > 100 or n::text in ('NaN','Infinity','-Infinity')) then raise exception 'progress_out_of_range'; end if;
    -- The latest stage with recorded activity confirms completion of prior tasks.
    -- A zero reports no activity and cannot override an earlier active stage.
    -- When every known value is zero, use the first reported stage; NULL remains unknown.
    v_latest := null;
    for v_idx in 1..5 loop
      if v_values[v_idx] > 0 then v_latest := v_idx; end if;
    end loop;
    if v_latest is null then
      for v_idx in 1..5 loop
        if v_values[v_idx] is not null then v_latest := v_idx; exit; end if;
      end loop;
    end if;
    if v_latest is not null then
      for v_idx in 1..v_latest-1 loop v_values[v_idx] := 100; end loop;
    end if;
    v_proc := case when v_latest is not null then 100 else null end;
    v_clean := v_values[1]; v_service := v_values[2]; v_final := v_values[3]; v_release := v_values[4]; v_pack := v_values[5];
    v_complete := coalesce(100 = all(v_values),false);
    v_stage := case when v_complete then 'Complete' when v_latest is null then 'Unassigned' else v_labels[v_latest] end;
    v_current := case when v_complete then 100 else v_values[v_latest] end;
    perform pg_advisory_xact_lock(hashtextextended('rem-analyzer|' || v_serial, 0));
    select count(*) into v_matches from public.rem_analyzers where upper(btrim(serial_number)) = v_serial;
    if v_matches > 1 then raise exception 'ambiguous_existing_serial:%', v_serial; end if;
    select to_jsonb(a) into v_old from public.rem_analyzers a where upper(btrim(serial_number))=v_serial for update;
    if v_matches = 1 then
      update public.rem_analyzers
      set serial_number=v_serial, analyzer_type=v_type, production_order=v_po,
          procurement_pct=v_proc, cleaning_pct=v_clean, service_pct=v_service,
          final_line_pct=v_final, release_testing_pct=v_release, packaging_pct=v_pack,
          qa_release_pct=null, sap_release_pct=null, overall_pct=null,
          current_pct=v_current, current_stage=v_stage, is_complete=v_complete,
          start_date=null, days_in_stage=null, sla_days=null,
          progress_engineer_name=null, workbook_current=true, registration_origin='workbook',
          workbook_source=jsonb_build_object('fileHash',p_file_hash,'planYear',p_plan_year,'sheet',p_source_sheet,'week',p_source_week,'importedAt',now(),'raw',r,'completionScope','workbook stages','precedingStagesInferred',true)
      where upper(btrim(serial_number))=v_serial returning to_jsonb(rem_analyzers.*) into v_new;
      v_analyzer_updated := v_analyzer_updated + 1;
    else
      insert into public.rem_analyzers(serial_number,analyzer_type,production_order,procurement_pct,cleaning_pct,service_pct,final_line_pct,release_testing_pct,packaging_pct,current_stage,current_pct,is_complete,qa_release_pct,sap_release_pct,overall_pct,days_in_stage,sla_days,workbook_current,workbook_source)
      values(v_serial,v_type,v_po,v_proc,v_clean,v_service,v_final,v_release,v_pack,v_stage,v_current,v_complete,null,null,null,null,null,true,
        jsonb_build_object('fileHash',p_file_hash,'planYear',p_plan_year,'sheet',p_source_sheet,'week',p_source_week,'importedAt',now(),'raw',r,'completionScope','workbook stages','precedingStagesInferred',true))
      returning to_jsonb(rem_analyzers.*) into v_new;
      v_analyzer_inserted := v_analyzer_inserted + 1;
    end if;
    insert into public.audit_log(action,entity_type,entity_id,user_name,details,old_value,new_value,correlation_id)
    values('REM_WORKBOOK_ANALYZER','rem_analyzer',v_new->>'id',p_actor,jsonb_build_object('file_hash',p_file_hash,'source_sheet',p_source_sheet),v_old,v_new,'rem-workbook-v3:'||p_file_hash||':'||v_serial);
  end loop;

  -- Keep historical records and their audit links, but remove absent units from current boards.
  for v_old in select to_jsonb(a) from public.rem_analyzers a
    where a.workbook_current and a.registration_origin='workbook' and a.analyzer_type in ('3600','5600','7600')
      and not exists(select 1 from jsonb_array_elements(p_analyzers) j where upper(btrim(j->>'serialNumber'))=upper(btrim(a.serial_number)))
    order by a.serial_number for update loop
    update public.rem_analyzers set workbook_current=false where id=(v_old->>'id')::uuid returning to_jsonb(rem_analyzers.*) into v_new;
    insert into public.audit_log(action,entity_type,entity_id,user_name,details,old_value,new_value,correlation_id)
    values('REM_WORKBOOK_ABSENT','rem_analyzer',v_old->>'id',p_actor,jsonb_build_object('file_hash',p_file_hash,'reason','absent from current WIP'),v_old,v_new,'rem-workbook-v3:'||p_file_hash||':absent:'||(v_old->>'id'));
    v_retired := v_retired+1;
  end loop;

  for r in select value from jsonb_array_elements(p_tracker_weekly) order by value->>'sourceKey' loop
    v_key := btrim(coalesce(r->>'sourceKey',''));
    if v_key = '' or v_key not like p_plan_year::text || ':tracker:%' then raise exception 'invalid_tracker_source_key'; end if;
    begin v_week := (r->>'weekNumber')::integer; exception when others then raise exception 'invalid_tracker_week'; end;
    if v_week < 1 or v_week > 53 then raise exception 'invalid_tracker_week'; end if;
    v_product := btrim(coalesce(r->>'product',''));
    if v_product not in ('VITROS','VISION','LVCC_ELECTROMETER','LVCC_IR_WASH') then raise exception 'invalid_tracker_product'; end if;
    v_quarter := upper(btrim(coalesce(r->>'quarter','')));
    if v_quarter !~ '^Q[1-4]$' then raise exception 'invalid_tracker_quarter'; end if;
    v_week_start := nullif(btrim(coalesce(r->>'weekStart','')), '');
    perform pg_advisory_xact_lock(hashtextextended('rem-tracker|' || v_key, 0));
    select count(*) into v_matches from public.rem_tracker_weekly where source_key = v_key;
    if v_matches > 1 then raise exception 'ambiguous_tracker_key:%', v_key;
    elsif v_matches = 1 then
      update public.rem_tracker_weekly
      set plan_year=p_plan_year, product=v_product, week_number=v_week, quarter=v_quarter, week_start=v_week_start,
          data=r
      where source_key=v_key;
      v_tracker_updated := v_tracker_updated + 1;
    else
      insert into public.rem_tracker_weekly(source_key,plan_year,product,week_number,quarter,week_start,data)
      values(v_key,p_plan_year,v_product,v_week,v_quarter,v_week_start,r);
      v_tracker_inserted := v_tracker_inserted + 1;
    end if;
  end loop;

  for r in select value from jsonb_array_elements(p_build_plan) order by value->>'sourceKey' loop
    v_key := btrim(coalesce(r->>'sourceKey',''));
    if v_key = '' or v_key not like p_plan_year::text || ':build-plan:%' then raise exception 'invalid_build_plan_source_key'; end if;
    begin v_week := (r->>'weekNumber')::integer; exception when others then raise exception 'invalid_build_plan_week'; end;
    if v_week < 1 or v_week > 53 then raise exception 'invalid_build_plan_week'; end if;
    v_quarter := upper(btrim(coalesce(r->>'quarter','')));
    if v_quarter !~ '^Q[1-4]$' then raise exception 'invalid_build_plan_quarter'; end if;
    v_week_start := nullif(btrim(coalesce(r->>'weekStart','')), '');
    perform pg_advisory_xact_lock(hashtextextended('rem-build-plan|' || v_key, 0));
    select count(*) into v_matches from public.rem_build_plan where source_key=v_key;
    if v_matches > 1 then raise exception 'ambiguous_build_plan_key:%', v_key;
    elsif v_matches = 1 then
      update public.rem_build_plan
      set plan_year=p_plan_year, week_number=v_week, quarter=v_quarter, week_start=v_week_start,
          data=coalesce(r->'data','{}'::jsonb)
      where source_key=v_key;
      v_build_updated := v_build_updated + 1;
    else
      insert into public.rem_build_plan(source_key,plan_year,week_number,quarter,week_start,data)
      values(v_key,p_plan_year,v_week,v_quarter,v_week_start,coalesce(r->'data','{}'::jsonb));
      v_build_inserted := v_build_inserted + 1;
    end if;
  end loop;

  for r in select value from jsonb_array_elements(p_staff) order by value->>'sourceKey' loop
    v_key := btrim(coalesce(r->>'sourceKey',''));
    if v_key = '' or v_key not like p_plan_year::text || ':staff:%' then raise exception 'invalid_staff_source_key'; end if;
    v_wwid := btrim(coalesce(r->>'wwid',''));
    v_name := btrim(coalesce(r->>'name',''));
    v_role := nullif(btrim(coalesce(r->>'role','')), '');
    if v_wwid !~ '^\d{6,12}$' then raise exception 'invalid_staff_wwid'; end if;
    if v_name = '' or length(v_name) > 160 then raise exception 'invalid_staff_name'; end if;
    begin v_fte := nullif(r->>'fte','')::numeric; exception when others then raise exception 'invalid_staff_fte'; end;
    if v_fte is not null and (v_fte < 0 or v_fte > 5) then raise exception 'invalid_staff_fte'; end if;
    perform pg_advisory_xact_lock(hashtextextended('rem-staff|' || v_key, 0));
    select count(*) into v_matches from public.rem_staff where source_key=v_key;
    if v_matches > 1 then raise exception 'ambiguous_staff_key:%', v_key;
    elsif v_matches = 1 then
      update public.rem_staff
      set name=v_name, role=v_role, plan_year=p_plan_year, wwid=v_wwid, fte=v_fte,
          started=nullif(btrim(coalesce(r->>'started','')), ''),
          complete_after=nullif(btrim(coalesce(r->>'completeAfter','')), ''),
          training_until=nullif(btrim(coalesce(r->>'trainingUntil','')), ''),
          comment=nullif(btrim(coalesce(r->>'comment','')), ''),
          skills=coalesce(r->'skills','{}'::jsonb),
          certifications=coalesce(r->'certifications','{}'::jsonb)
      where source_key=v_key;
      v_staff_updated := v_staff_updated + 1;
    else
      insert into public.rem_staff(source_key,plan_year,wwid,name,role,fte,started,complete_after,training_until,comment,skills,certifications)
      values(v_key,p_plan_year,v_wwid,v_name,v_role,v_fte,
        nullif(btrim(coalesce(r->>'started','')), ''),
        nullif(btrim(coalesce(r->>'completeAfter','')), ''),
        nullif(btrim(coalesce(r->>'trainingUntil','')), ''),
        nullif(btrim(coalesce(r->>'comment','')), ''),
        coalesce(r->'skills','{}'::jsonb), coalesce(r->'certifications','{}'::jsonb));
      v_staff_inserted := v_staff_inserted + 1;
    end if;
  end loop;

  for r in select value from jsonb_array_elements(p_weekly_notes) order by (value->>'weekNumber')::integer loop
    v_key := btrim(coalesce(r->>'sourceKey',''));
    if v_key = '' or v_key not like p_plan_year::text || ':notes:%' then raise exception 'invalid_note_source_key'; end if;
    begin v_week := (r->>'weekNumber')::integer; exception when others then raise exception 'invalid_note_week'; end;
    if v_week < 1 or v_week > 53 then raise exception 'invalid_note_week'; end if;
    v_quarter := upper(btrim(coalesce(r->>'quarter','')));
    if v_quarter !~ '^Q[1-4]$' then raise exception 'invalid_note_quarter'; end if;
    v_week_start := coalesce(nullif(btrim(coalesce(r->>'weekStart','')), ''), '');
    v_note_array := '[]'::jsonb;
    v_text := nullif(btrim(coalesce(r->'notes'->>'vitros','')), '');
    if v_text is not null then v_note_array := v_note_array || jsonb_build_array(jsonb_build_object('product','VITROS','content',v_text)); end if;
    v_text := nullif(btrim(coalesce(r->'notes'->>'vision','')), '');
    if v_text is not null then v_note_array := v_note_array || jsonb_build_array(jsonb_build_object('product','VISION','content',v_text)); end if;
    v_text := nullif(btrim(coalesce(r->'notes'->>'lvccElectrometer','')), '');
    if v_text is not null then v_note_array := v_note_array || jsonb_build_array(jsonb_build_object('product','LVCC Electrometer','content',v_text)); end if;
    v_text := nullif(btrim(coalesce(r->'notes'->>'lvccIrWash','')), '');
    if v_text is not null then v_note_array := v_note_array || jsonb_build_array(jsonb_build_object('product','LVCC IR Wash','content',v_text)); end if;
    if jsonb_array_length(v_note_array) = 0 then continue; end if;
    perform pg_advisory_xact_lock(hashtextextended('rem-notes|' || v_key, 0));
    select count(*) into v_matches from public.rem_weekly_notes where source_key=v_key;
    if v_matches = 0 then
      select count(*) into v_matches from public.rem_weekly_notes
      where source_key is null and plan_year=p_plan_year and week_number=v_week and quarter=v_quarter;
      if v_matches = 1 then
        update public.rem_weekly_notes
        set source_key=v_key, plan_year=p_plan_year, week_start=v_week_start, notes=v_note_array
        where source_key is null and plan_year=p_plan_year and week_number=v_week and quarter=v_quarter;
        v_note_updated := v_note_updated + 1;
        continue;
      elsif v_matches > 1 then
        raise exception 'ambiguous_legacy_note_week:%', v_week;
      end if;
    elsif v_matches > 1 then
      raise exception 'ambiguous_note_key:%', v_key;
    else
      update public.rem_weekly_notes
      set plan_year=p_plan_year, week_start=v_week_start, week_number=v_week, quarter=v_quarter, notes=v_note_array
      where source_key=v_key;
      v_note_updated := v_note_updated + 1;
      continue;
    end if;
    insert into public.rem_weekly_notes(source_key,plan_year,week_start,week_number,quarter,notes)
    values(v_key,p_plan_year,v_week_start,v_week,v_quarter,v_note_array);
    v_note_inserted := v_note_inserted + 1;
  end loop;

  for r in select value from jsonb_array_elements(p_targets) order by value->>'sourceKey' loop
    v_key := btrim(coalesce(r->>'sourceKey',''));
    if v_key = '' or v_key not like p_plan_year::text || ':target:%' then raise exception 'invalid_target_source_key'; end if;
    v_target_type := upper(btrim(coalesce(r->>'targetType','')));
    if v_target_type !~ '^[A-Z0-9_]{3,80}$' then raise exception 'invalid_target_type'; end if;
    begin
      v_target_value := (r->>'targetValue')::numeric;
      v_actual_value := (r->>'actualValue')::numeric;
    exception when others then raise exception 'invalid_target_value'; end;
    if v_target_value < 0 or v_target_value > 10000000 or v_actual_value < 0 or v_actual_value > 10000000 then raise exception 'invalid_target_value'; end if;
    perform pg_advisory_xact_lock(hashtextextended('rem-target|' || v_key, 0));
    select count(*) into v_matches from public.rem_targets where source_key=v_key;
    if v_matches = 0 then
      select count(*) into v_matches from public.rem_targets where source_key is null and year=p_plan_year and target_type=v_target_type;
      if v_matches = 1 then
        update public.rem_targets
        set source_key=v_key,target_value=v_target_value,actual_value=v_actual_value,data=coalesce(r->'data','{}'::jsonb)
        where source_key is null and year=p_plan_year and target_type=v_target_type;
        v_target_updated := v_target_updated + 1;
        continue;
      elsif v_matches > 1 then raise exception 'ambiguous_legacy_target:%', v_target_type; end if;
    elsif v_matches > 1 then raise exception 'ambiguous_target_key:%', v_key;
    else
      update public.rem_targets
      set year=p_plan_year,target_type=v_target_type,target_value=v_target_value,actual_value=v_actual_value,data=coalesce(r->'data','{}'::jsonb)
      where source_key=v_key;
      v_target_updated := v_target_updated + 1;
      continue;
    end if;
    insert into public.rem_targets(source_key,year,target_type,target_value,actual_value,data)
    values(v_key,p_plan_year,v_target_type,v_target_value,v_actual_value,coalesce(r->'data','{}'::jsonb));
    v_target_inserted := v_target_inserted + 1;
  end loop;

  for v_section in select * from (values
    ('rem_tracker_weekly','plan_year'),('rem_build_plan','plan_year'),('rem_staff','plan_year'),
    ('rem_weekly_notes','plan_year'),('rem_targets','year')
  ) sections(name,year_column) loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by t.id), ''[]''::jsonb) from public.%I t where %I=$1',v_section.name,v_section.year_column)
      into v_new using p_plan_year;
    insert into public.audit_log(action,entity_type,entity_id,user_name,details,old_value,new_value,correlation_id)
    values('REM_WORKBOOK_PLANNING',v_section.name,p_plan_year::text,p_actor,
      jsonb_build_object('file_hash',p_file_hash,'payload_fingerprint',v_fingerprint),
      v_snapshots->v_section.name,v_new,'rem-workbook-v3:'||p_file_hash||':'||v_section.name);
  end loop;

  v_result := jsonb_build_object(
    'schema_version',3,
    'payload_fingerprint',v_fingerprint,
    'file_hash',p_file_hash,
    'plan_year',p_plan_year,
    'source_sheet',p_source_sheet,
    'source_week',p_source_week,
    'already_applied',false,
    'analyzers',jsonb_build_object('rows',jsonb_array_length(p_analyzers),'inserted',v_analyzer_inserted,'updated',v_analyzer_updated,'absent',v_retired),
    'tracker',jsonb_build_object('rows',jsonb_array_length(p_tracker_weekly),'inserted',v_tracker_inserted,'updated',v_tracker_updated),
    'build_plan',jsonb_build_object('rows',jsonb_array_length(p_build_plan),'inserted',v_build_inserted,'updated',v_build_updated),
    'staff',jsonb_build_object('rows',jsonb_array_length(p_staff),'inserted',v_staff_inserted,'updated',v_staff_updated),
    'weekly_notes',jsonb_build_object('rows',jsonb_array_length(p_weekly_notes),'inserted',v_note_inserted,'updated',v_note_updated),
    'targets',jsonb_build_object('rows',jsonb_array_length(p_targets),'inserted',v_target_inserted,'updated',v_target_updated)
  );

  insert into public.rem_authoritative_import_runs(file_hash,schema_version,file_name,plan_year,source_sheet,source_week,actor,section_counts,result)
  values(p_file_hash,3,p_file_name,p_plan_year,p_source_sheet,p_source_week,p_actor,
    jsonb_build_object('analyzers',jsonb_array_length(p_analyzers),'tracker',jsonb_array_length(p_tracker_weekly),'build_plan',jsonb_array_length(p_build_plan),'staff',jsonb_array_length(p_staff),'weekly_notes',jsonb_array_length(p_weekly_notes),'targets',jsonb_array_length(p_targets)),
    v_result);

  insert into public.audit_log(action,entity_type,entity_id,user_name,details,new_value,correlation_id)
  values('REM_AUTHORITATIVE_WORKBOOK_IMPORT','rem_authoritative_import',p_file_hash,p_actor,
    jsonb_build_object('file_name',p_file_name,'plan_year',p_plan_year,'source_sheet',p_source_sheet,'source_week',p_source_week),
    v_result,'rem-authoritative-import:' || p_file_hash);

  return v_result;
end;
$function$

;
