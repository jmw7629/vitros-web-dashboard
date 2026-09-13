-- Synthetic fixture helpers exist only in the disposable test database.
create function public.test_rem_core(p_hash text,p_import_id uuid,p_name text default 'Synthetic.xlsx',p_change integer default 0,p_year integer default 2026) returns jsonb
language sql as $$
  select public.apply_rem_full_workbook_import(p_hash,p_name,p_year,'Synthetic WIP',18,'synthetic-actor',
    (select jsonb_agg(jsonb_build_object('serialNumber',(10000000+n)::text,'analyzerType','5600','cleaningPct',p_change,'servicePct',0,'finalLinePct',0,'releaseTestingPct',0,'packagingPct',0)) from generate_series(1,5)n),
    (select jsonb_agg(jsonb_build_object('sourceKey',p_year||':tracker:VITROS:'||n,'year',p_year,'product','VITROS','quarter','Q1','weekNumber',n,'plan',2)) from generate_series(1,40)n),
    (select jsonb_agg(jsonb_build_object('sourceKey',p_year||':build-plan:'||n,'year',p_year,'quarter','Q1','weekNumber',n,'data',jsonb_build_object('plan',5))) from generate_series(1,20)n),
    (select jsonb_agg(jsonb_build_object('sourceKey',p_year||':staff:'||n,'year',p_year,'wwid',(100000+n)::text,'name','Synthetic Staff '||n,'skills','{}'::jsonb,'certifications','{}'::jsonb)) from generate_series(1,5)n),
    '[]'::jsonb,jsonb_build_array(jsonb_build_object('sourceKey',p_year||':target:VITROS_ANNUAL_PLAN','year',p_year,'targetType','VITROS_ANNUAL_PLAN','targetValue',10,'actualValue',0,'data','{}'::jsonb)),
    p_import_id
  );
$$;

do $$
declare p jsonb; receipt jsonb; records jsonb; r jsonb; i uuid; j uuid; empty_id uuid; before_events integer; before_audit integer; rejected boolean; bad jsonb;
begin
  if not exists(select 1 from pg_proc where oid='public.apply_rem_full_workbook_import(text,text,integer,text,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid)'::regprocedure and proconfig @> array['statement_timeout=55s']) then raise exception 'full finalize RPC timeout not scoped'; end if;
  if not exists(select 1 from pg_proc where oid='public.list_rem_operational_records(text,integer,integer,text,text,integer)'::regprocedure and provolatile='s') then raise exception 'operational count/page snapshot not stable'; end if;
  r := '{"dataset":"field_status","sourceKey":"2026:field_status:VITROS:BATCH-1","sourceSheet":"Field Status VITROS","sourceRow":2,"data":{"product":"VITROS","batch":"BATCH-1","status":"RELEASED","country":"Ireland"}}'::jsonb;
  p := public.begin_rem_operational_import(repeat('a',64),2026,2,'synthetic-actor'); i := (p->>'importId')::uuid;
  if public.begin_rem_operational_import(repeat('a',64),2026,2,'synthetic-actor')->>'importId' <> i::text then raise exception 'begin retry duplicated'; end if;
  rejected:=false; begin perform public.begin_rem_operational_import(repeat('a',64),2026,3,'synthetic-actor'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'changed begin metadata accepted'; end if;
  rejected:=false; begin perform public.get_rem_operational_import_progress(i,'different-actor'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'other actor can inspect staging'; end if;
  rejected:=false; begin perform public.test_rem_core(repeat('a',64),i); exception when others then rejected:=true; end;
  if not rejected or exists(select 1 from public.rem_authoritative_import_runs) then raise exception 'incomplete upload partially committed'; end if;
  records := jsonb_build_array(r,'{"dataset":"summary_targets","sourceKey":"2026:summary_targets:VITROS:Q1","sourceSheet":"2026 Summary","sourceRow":3,"data":{"product":"VITROS","quarter":"Q1","targetValue":0,"annualTargetValue":100}}'::jsonb);
  rejected:=false; begin perform public.stage_rem_operational_import(i,0,jsonb_build_array(r,r),'synthetic-actor'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'duplicate natural keys accepted'; end if;
  bad:=jsonb_set(records,'{0,sourceKey}','"2026:field_status:VITROS:FAKE"');
  rejected:=false; begin perform public.stage_rem_operational_import(i,0,bad,'synthetic-actor'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'forged source key accepted'; end if;
  bad:=jsonb_set(records,'{0,data,arbitrarySql}','"should not pass"');
  rejected:=false; begin perform public.stage_rem_operational_import(i,0,bad,'synthetic-actor'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'unallowlisted field accepted'; end if;
  receipt:=public.stage_rem_operational_import(i,0,records,'synthetic-actor');
  if (receipt->>'receivedRows')::int <> 2 or (receipt->>'duplicate')::boolean then raise exception 'stage receipt invalid'; end if;
  if (public.list_rem_operational_records('field_status',0,50)->>'total')::int <> 0 then raise exception 'staged data leaked'; end if;
  if not (public.stage_rem_operational_import(i,0,records,'synthetic-actor')->>'duplicate')::boolean then raise exception 'batch retry not idempotent'; end if;
  rejected:=false; begin perform public.stage_rem_operational_import(i,0,jsonb_set(records,'{0,data,status}','"DIFFERENT"'),'synthetic-actor'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'changed batch retry accepted'; end if;
  receipt:=public.test_rem_core(repeat('a',64),i);
  if (receipt->'operational'->>'inserted')::int <> 2 or (receipt->>'already_applied')::boolean then raise exception 'first full receipt invalid'; end if;
  if (select count(*) from public.rem_analyzers) <> 6 or not exists(select 1 from public.rem_analyzers where serial_number='99999999' and operator_notes='Synthetic REM-only note must survive omitted row') then raise exception 'unrelated analyzer changed'; end if;
  if (select count(*) from public.rem_tracker_weekly) <> 40 or (select count(*) from public.rem_build_plan) <> 20 then raise exception 'core RPC not applied'; end if;
  select count(*) into before_events from public.rem_operational_record_events;
  select count(*) into before_audit from public.audit_log;
  if not (public.test_rem_core(repeat('a',64),i,'Renamed.xlsx')->>'already_applied')::boolean then raise exception 'renamed exact retry failed'; end if;
  if (select count(*) from public.rem_operational_record_events)<>before_events or (select count(*) from public.audit_log)<>before_audit then raise exception 'retry duplicated history'; end if;
  rejected:=false; begin perform public.test_rem_core(repeat('a',64),i,'Renamed.xlsx',1); exception when others then rejected:=true; end;
  if not rejected then raise exception 'changed core retry accepted'; end if;
  if (public.list_rem_operational_records('field_status',0,50,'Ireland','VITROS',2026)->>'total')::int <> 1 or (public.list_rem_operational_records('field_status',0,50,'','',2025)->>'total')::int <> 0 then raise exception 'read filters incorrect'; end if;

  -- New workbook changes one field, while omitted/blank workbook fields and
  -- unrelated rows survive. Zero is authoritative, never treated as blank.
  j := (public.begin_rem_operational_import(repeat('b',64),2026,1,'synthetic-actor')->>'importId')::uuid;
  r := jsonb_set(r,'{data}','{"product":"VITROS","batch":"BATCH-1","status":"REVIEWED","country":"   ","partsAtInstallUsd":0}'::jsonb);
  perform public.stage_rem_operational_import(j,0,jsonb_build_array(r),'synthetic-actor');
  receipt:=public.test_rem_core(repeat('b',64),j);
  if (receipt->'operational'->>'updated')::int<>1 then raise exception 'update receipt missing'; end if;
  if not exists(select 1 from public.rem_operational_records where source_key=r->>'sourceKey' and data->>'country'='Ireland' and data->>'status'='REVIEWED' and data->>'partsAtInstallUsd'='0' and version=2) then raise exception 'blank/omission/zero merge failed'; end if;
  if (select count(*) from public.rem_operational_records)<>2 then raise exception 'omitted operational row deleted'; end if;
  if not exists(select 1 from public.rem_operational_record_events where import_id=j and old_value->>'status'='RELEASED' and new_value->>'status'='REVIEWED') then raise exception 'before/after evidence missing'; end if;
  rejected:=false; begin update public.rem_operational_record_events set actor='tampered'; exception when others then rejected:=true; end;
  if not rejected then raise exception 'event history mutable'; end if;
  rejected:=false; begin delete from public.rem_operational_import_batches where import_id=i; exception when others then rejected:=true; end;
  if not rejected then raise exception 'staged batch evidence mutable'; end if;

  -- Service-only boundary independent of row policies.
  if has_function_privilege('anon','public.begin_rem_operational_import(text,integer,integer,text)','EXECUTE') or has_function_privilege('authenticated','public.apply_rem_full_workbook_import(text,text,integer,text,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid)','EXECUTE') or has_table_privilege('authenticated','public.rem_operational_records','SELECT') or has_table_privilege('service_role','public.rem_operational_records','UPDATE') then raise exception 'privileged boundary exposed'; end if;
  if not has_function_privilege('service_role','public.stage_rem_operational_import(uuid,integer,jsonb,text)','EXECUTE') then raise exception 'service cannot stage'; end if;
  if exists(select 1 from pg_class where relname like 'rem_operational_%' and relkind='r' and not relrowsecurity) then raise exception 'RLS missing'; end if;
end;
$$;

-- Force a late failure after core has executed to prove BOTH sides roll back.
create function public.test_rem_reject_event() returns trigger language plpgsql as $$ begin raise exception 'synthetic late failure'; end $$;
create trigger synthetic_late_failure before insert on public.rem_operational_record_events for each row execute function public.test_rem_reject_event();
do $$
declare i uuid; rejected boolean:=false; prior integer;
begin
  i:=(public.begin_rem_operational_import(repeat('c',64),2026,1,'synthetic-actor')->>'importId')::uuid;
  perform public.stage_rem_operational_import(i,0,'[{"dataset":"field_status","sourceKey":"2026:field_status:VISION:FAILURE-PROBE","sourceSheet":"Field Status VISION","sourceRow":2,"data":{"product":"VISION","batch":"FAILURE-PROBE"}}]'::jsonb,'synthetic-actor');
  select count(*) into prior from public.audit_log;
  begin perform public.test_rem_core(repeat('c',64),i,'Failure.xlsx',90); exception when others then rejected:=true; end;
  if not rejected or exists(select 1 from public.rem_authoritative_import_runs where file_hash=repeat('c',64)) or exists(select 1 from public.rem_operational_records where source_key like '%FAILURE-PROBE') or exists(select 1 from public.rem_analyzers where cleaning_pct=90) or (select count(*) from public.audit_log)<>prior then raise exception 'full transaction did not roll back'; end if;
  if (public.get_rem_operational_import_progress(i,'synthetic-actor')->>'status')<>'staging' then raise exception 'failed finalize marked complete'; end if;
end;
$$;
drop trigger synthetic_late_failure on public.rem_operational_record_events;

do $$
declare first_id uuid; next_id uuid; r1 jsonb; r2 jsonb; next1 jsonb; next2 jsonb;
begin
  first_id:=(public.begin_rem_operational_import(repeat('1',64),2026,2,'synthetic-actor')->>'importId')::uuid;
  r1:='{"dataset":"field_status","sourceKey":"2026:field_status:VITROS:DATE-PROBE","sourceSheet":"Field Status VITROS","sourceRow":4,"data":{"product":"VITROS","batch":"DATE-PROBE","postingDate":"2026-01-01","sourcePostingDate":"2026-01-01","partsAtInstallUsd":1,"sourceNumericText":{"partsAtInstallUsd":"1"}}}'::jsonb;
  r2:='{"dataset":"summary_targets","sourceKey":"2026:summary_targets:VISION:Q1","sourceSheet":"2026 Summary","sourceRow":3,"data":{"product":"VISION","quarter":"Q1","targetValue":10,"annualTargetValue":40,"trackerPlanValue":11,"planVariance":1}}'::jsonb;
  perform public.stage_rem_operational_import(first_id,0,jsonb_build_array(r1,r2),'synthetic-actor');
  perform public.test_rem_core(repeat('1',64),first_id);
  next_id:=(public.begin_rem_operational_import(repeat('2',64),2026,2,'synthetic-actor')->>'importId')::uuid;
  next1:=jsonb_set(r1,'{data}','{"product":"VITROS","batch":"DATE-PROBE","sourcePostingDate":"TBD","partsAtInstallUsd":2}');
  next2:=jsonb_set(r2,'{data}','{"product":"VISION","quarter":"Q1","targetValue":12,"annualTargetValue":40}');
  perform public.stage_rem_operational_import(next_id,0,jsonb_build_array(next1,next2),'synthetic-actor');
  perform public.test_rem_core(repeat('2',64),next_id);
  if not exists(select 1 from public.rem_operational_records where source_key=r1->>'sourceKey' and data->>'sourcePostingDate'='TBD' and not data ? 'postingDate' and not data ? 'sourceNumericText' and data->>'partsAtInstallUsd'='2') then raise exception 'TBD date or obsolete numeric provenance retained'; end if;
  if not exists(select 1 from public.rem_operational_records where source_key=r2->>'sourceKey' and data->>'trackerPlanValue'='11' and data->>'planVariance'='-1') then raise exception 'recurring summary variance stale'; end if;
  if not exists(select 1 from public.rem_operational_staged_records where import_id=first_id and source_key=r1->>'sourceKey' and record->'data'->>'postingDate'='2026-01-01') then raise exception 'raw prior staged provenance changed'; end if;
end;
$$;

do $$
declare i uuid; rows jsonb; last_row jsonb; rejected boolean; p jsonb; page jsonb;
begin
  i:=(public.begin_rem_operational_import(repeat('d',64),2026,251,'synthetic-actor')->>'importId')::uuid;
  select jsonb_agg(jsonb_build_object('dataset','certified_parts','sourceKey','history:certified_parts:SO-BATCH:'||n||':0:J123:PART','sourceSheet','Certified Parts','sourceRow',n+1,'data',jsonb_build_object('serviceOrder','SO-BATCH','partLineNumber',n::text,'laborLineNumber','0','partNumber','J123','lineType','PART','equipmentNumber','EQ-SHARED','equipmentPartKey','EQ-SHARED-J123','quantity',1,'partCostUsd',3.5,'allCostUsd',4.5)) order by n) into rows from generate_series(1,251)n;
  last_row:=rows->250;
  rejected:=false; begin perform public.stage_rem_operational_import(i,0,rows,'synthetic-actor'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'oversized batch accepted'; end if;
  rejected:=false; begin perform public.stage_rem_operational_import(i,1,jsonb_build_array(last_row),'synthetic-actor'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'out of order batch accepted'; end if;
  perform public.stage_rem_operational_import(i,0,rows-250,'synthetic-actor');
  rejected:=false; begin perform public.stage_rem_operational_import(i,1,jsonb_build_array(rows->0),'synthetic-actor'); exception when others then rejected:=true; end;
  if not rejected or (public.get_rem_operational_import_progress(i,'synthetic-actor')->>'receivedRows')::integer<>250 then raise exception 'cross-batch collision changed staging'; end if;
  perform public.stage_rem_operational_import(i,1,jsonb_build_array(last_row),'synthetic-actor');
  p:=public.test_rem_core(repeat('d',64),i);
  if (p->'operational'->>'inserted')::integer<>251 then raise exception 'line identities collapsed to equipment-part key'; end if;
  page:=public.list_rem_operational_records('certified_parts',200,100,'EQ-SHARED','',2026);
  if (page->>'total')::integer<>251 or jsonb_array_length(page->'records')<>51 or (page->>'hasMore')::boolean then raise exception 'bounded pagination is incorrect'; end if;
  rejected:=false; begin update public.rem_operational_imports set result='{}'::jsonb where id=i; exception when others then rejected:=true; end;
  if not rejected then raise exception 'accepted full import receipt mutable'; end if;
end;
$$;

do $$
declare i uuid; j uuid; r jsonb; rejected boolean; bad jsonb;
begin
  r:='{"dataset":"lvcc_reviews","sourceKey":"2026:lvcc_reviews:J-LVCC:2","sourceSheet":"LVCC DHR Reviews","sourceRow":2,"data":{"partNumber":"J-LVCC","weekNumber":2,"weekStart":"2026-01-05","sourceWeekStart":"2025-01-05","reviewIds":[{"slot":1,"value":"SYNTHETIC-1","sourceCell":"F2"}],"listedCount":1,"recordedTotal":2,"totalDifference":-1,"sourceNumericText":{"recordedTotal":"2"}}}'::jsonb;
  i:=(public.begin_rem_operational_import(repeat('e',64),2026,1,'synthetic-actor')->>'importId')::uuid;
  for bad in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_set(r,'{data,totalDifference}','0'),
    jsonb_set(r,'{data,reviewIds,0,sourceCell}','"F3"'),
    jsonb_set(r,'{data,weekStart}','"2025-01-05"')
  )) loop
    rejected:=false; begin perform public.stage_rem_operational_import(i,0,jsonb_build_array(bad),'synthetic-actor'); exception when others then rejected:=true; end;
    if not rejected then raise exception 'LVCC contradictory provenance accepted'; end if;
  end loop;
  perform public.stage_rem_operational_import(i,0,jsonb_build_array(r),'synthetic-actor');
  perform public.test_rem_core(repeat('e',64),i);
  j:=(public.begin_rem_operational_import(repeat('f',64),2026,1,'synthetic-actor')->>'importId')::uuid;
  r:=jsonb_set(r,'{data,reviewIds}','[{"slot":2,"value":"SYNTHETIC-REVISED","sourceCell":"G2"}]');
  r:=jsonb_set(r,'{data}',(r->'data')-'recordedTotal'-'totalDifference');
  r:=jsonb_set(r,'{data,sourceNumericText}','{"listedCount":"1"}');
  perform public.stage_rem_operational_import(j,0,jsonb_build_array(r),'synthetic-actor');
  perform public.test_rem_core(repeat('f',64),j);
  if not exists(select 1 from public.rem_operational_records where source_key=r->>'sourceKey' and data->'reviewIds'->0->>'value'='SYNTHETIC-REVISED' and jsonb_array_length(data->'reviewIds')=1 and data->'sourceNumericText'->>'recordedTotal'='2' and data->>'totalDifference'='-1' and not (data->'sourceNumericText') ? 'listedCount') then raise exception 'nested provenance preservation/review array replacement failed'; end if;
  if public.rem_uri_component('Á :/%')<>'%C3%81%20%3A%2F%25' then raise exception 'URI identity differs from browser contract'; end if;
end;
$$;

do $$
declare i uuid; moved uuid; r jsonb; receipt jsonb; rejected boolean:=false; history_id uuid; before_count integer;
begin
  select jsonb_build_object('dataset',dataset,'sourceKey',source_key,'sourceSheet',source_sheet,'sourceRow',source_row,'data',data-'recordedTotal'-'totalDifference'-'sourceNumericText') into r from public.rem_operational_records where source_key='2026:lvcc_reviews:J-LVCC:2';
  r:=jsonb_set(jsonb_set(r,'{data,reviewIds}','[]'),'{data,listedCount}','0');
  i:=(public.begin_rem_operational_import(repeat('3',64),2026,1,'synthetic-actor')->>'importId')::uuid;
  perform public.stage_rem_operational_import(i,0,jsonb_build_array(r),'synthetic-actor');
  receipt:=public.test_rem_core(repeat('3',64),i);
  if (receipt->'operational'->>'unchanged')::integer<>1 or not exists(select 1 from public.rem_operational_records where source_key=r->>'sourceKey' and data->>'listedCount'='1' and data->>'recordedTotal'='2' and data->>'totalDifference'='-1') then raise exception 'blank review list did not preserve linked counts'; end if;
  moved:=(public.begin_rem_operational_import(repeat('4',64),2026,1,'synthetic-actor')->>'importId')::uuid;
  r:=jsonb_set(r,'{sourceRow}','3');
  perform public.stage_rem_operational_import(moved,0,jsonb_build_array(r),'synthetic-actor');
  begin perform public.test_rem_core(repeat('4',64),moved); exception when others then rejected:=true; end;
  if not rejected or exists(select 1 from public.rem_authoritative_import_runs where file_hash=repeat('4',64)) then raise exception 'ambiguous moved blank review source not rejected atomically'; end if;

  -- Service history natural keys survive annual plan rollover. Same accepted
  -- line is updated, rather than inserted again under a new workbook year.
  select count(*) into before_count from public.rem_operational_records where dataset='certified_parts';
  select jsonb_build_object('dataset',dataset,'sourceKey',source_key,'sourceSheet',source_sheet,'sourceRow',source_row,'data',jsonb_set(data,'{quantity}','4')) into r from public.rem_operational_records where source_key='history:certified_parts:SO-BATCH:1:0:J123:PART';
  history_id:=(public.begin_rem_operational_import(repeat('5',64),2027,1,'synthetic-actor')->>'importId')::uuid;
  perform public.stage_rem_operational_import(history_id,0,jsonb_build_array(r),'synthetic-actor');
  receipt:=public.test_rem_core(repeat('5',64),history_id,'2027.xlsx',0,2027);
  if (receipt->'operational'->>'updated')::integer<>1 or (select count(*) from public.rem_operational_records where dataset='certified_parts')<>before_count then raise exception 'annual workbook duplicated service history'; end if;
end;
$$;
