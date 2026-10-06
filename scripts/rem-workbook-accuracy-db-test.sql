-- Synthetic fixtures only. Run inside BEGIN / ROLLBACK after production migrations.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare rows jsonb; tracker jsonb; plan jsonb; staff jsonb; targets jsonb; notes jsonb;
 legacy_note_id uuid:=gen_random_uuid();
 receipt jsonb; row_data public.rem_analyzers; old_id uuid:=gen_random_uuid();
 engineer uuid:=gen_random_uuid(); progress jsonb; updated jsonb; before_count int;
 rejected boolean:=false; manual_id uuid;
begin
 insert into public.convex_employees(id,name,initials,active) values(engineer,'Workbook test engineer','WT',true);
 insert into public.rem_analyzers(id,serial_number,analyzer_type,start_date,overall_pct) values(old_id,'56009999','5600','2020-01-01',80);
 rows:='[{"serialNumber":"56009901","analyzerType":"5600","cleaningPct":null,"servicePct":50,"finalLinePct":null,"releaseTestingPct":null,"packagingPct":null},
 {"serialNumber":"56009902","analyzerType":"5600","cleaningPct":null,"servicePct":null,"finalLinePct":null,"releaseTestingPct":null,"packagingPct":null},
 {"serialNumber":"56009903","analyzerType":"5600","cleaningPct":100,"servicePct":100,"finalLinePct":100,"releaseTestingPct":100,"packagingPct":100},
 {"serialNumber":"56009904","analyzerType":"5600","cleaningPct":0,"servicePct":null,"finalLinePct":null,"releaseTestingPct":null,"packagingPct":null},
 {"serialNumber":"56009905","analyzerType":"5600","cleaningPct":20,"servicePct":0,"finalLinePct":null,"releaseTestingPct":null,"packagingPct":null}]';
 select jsonb_agg(jsonb_build_object('sourceKey','2026:tracker:VITROS:'||n,'year',2026,'product','VITROS','quarter','Q1','weekNumber',n,'plan',1)) into tracker from generate_series(1,40) n;
 select jsonb_agg(jsonb_build_object('sourceKey','2026:build-plan:'||n,'year',2026,'quarter','Q1','weekNumber',n,'data','{}'::jsonb)) into plan from generate_series(1,20) n;
 select jsonb_agg(jsonb_build_object('sourceKey','2026:staff:'||n,'year',2026,'wwid',100000+n,'name','Test '||n,'skills','{}'::jsonb,'certifications','{}'::jsonb)) into staff from generate_series(1,5) n;
 targets:='[{"sourceKey":"2026:target:VITROS","year":2026,"targetType":"VITROS","targetValue":1,"actualValue":0,"data":{}}]';
 notes:='[{"sourceKey":"2026:notes:1","year":2026,"weekNumber":1,"quarter":"Q1","notes":{"vitros":"Current year source"}}]';
 insert into public.rem_weekly_notes(id,plan_year,week_start,week_number,quarter,notes) values(legacy_note_id,2025,'2025-01-01',1,'Q1','[{"product":"VITROS","content":"Prior year"}]');
 begin
  insert into public.rem_authoritative_import_runs(file_hash,schema_version,file_name,plan_year,source_sheet,actor,section_counts,result)
  values(repeat('f',64),4,'invalid.xlsx',2026,'WIP test','test','{}','{}');
  raise exception 'Unsupported receipt version accepted';
 exception when check_violation then null;
 end;
 execute 'set local role service_role';
 manual_id:=(public.create_rem_analyzer_record('VITROS','56009998','5600',null,engineer,'New registration','test','manual-during-import-test')->'record'->>'id')::uuid;
 receipt:=public.apply_rem_authoritative_workbook_import(repeat('c',64),'synthetic.xlsx',2026,'WIP test',41,'test',rows,tracker,plan,staff,notes,targets);
 if not exists(select 1 from public.rem_analyzers where id=manual_id and workbook_current and registration_origin='manual') then raise exception 'Workbook hid manual registration';end if;
 if (receipt->>'schema_version')::int<>3 then raise exception 'Wrong import schema';end if;
 select * into row_data from public.rem_analyzers where serial_number='56009901';
 if row_data.current_stage<>'Service' or row_data.cleaning_pct<>100 or row_data.procurement_pct<>100 or row_data.service_pct<>50
 or row_data.final_line_pct is not null or row_data.qa_release_pct is not null or row_data.sap_release_pct is not null
 or row_data.start_date is not null or row_data.days_in_stage is not null or row_data.sla_days is not null or row_data.overall_pct is not null or row_data.production_order is not null then raise exception 'Service precedence / null preservation failed';end if;
 select * into row_data from public.rem_analyzers where serial_number='56009902';
 if row_data.current_stage<>'Unassigned' or row_data.procurement_pct is not null or row_data.current_pct is not null then raise exception 'Unknown source was invented';end if;
 select * into row_data from public.rem_analyzers where serial_number='56009903';
 if not row_data.is_complete or row_data.qa_release_pct is not null or row_data.sap_release_pct is not null then raise exception 'Source completion fabricated QA/SAP';end if;
 if (select cleaning_pct from public.rem_analyzers where serial_number='56009904')<>0 then raise exception 'Explicit zero lost';end if;
 if (select workbook_current from public.rem_analyzers where id=old_id) or not exists(select 1 from public.audit_log where entity_id=old_id::text and action='REM_WORKBOOK_ABSENT') then raise exception 'Absent source was not archived with audit';end if;
 if (select current_stage from public.rem_analyzers where serial_number='56009905')<>'Cleaning' then raise exception 'Later zero incorrectly inferred activity';end if;
 if (select count(*) from public.audit_log where action='REM_WORKBOOK_PLANNING' and old_value is not null and new_value is not null)<>5 then raise exception 'Planning audit lacks before/after';end if;
 if not exists(select 1 from public.rem_weekly_notes n where id=legacy_note_id and plan_year=2025 and source_key is null and n.notes->0->>'content'='Prior year') then raise exception 'Cross-year legacy note changed';end if;
 select count(*) into before_count from public.audit_log;
 receipt:=public.apply_rem_authoritative_workbook_import(repeat('c',64),'synthetic.xlsx',2026,'WIP test',41,'test',rows,tracker,plan,staff,notes,targets);
 if not (receipt->>'already_applied')::boolean or (select count(*) from public.audit_log)<>before_count then raise exception 'Replay duplicated writes';end if;
 begin
  perform public.apply_rem_authoritative_workbook_import(repeat('d',64),'invalid.xlsx',2026,'WIP',41,'test',null,tracker,plan,staff,notes,targets);
 exception when others then
  if sqlerrm<>'invalid_analyzer_rows' then raise;end if; rejected:=true;
 end;
 if not rejected then raise exception 'Null array passed validation';end if;
 rejected:=false;
 begin
  perform public.apply_rem_authoritative_workbook_import(repeat('c',64),'synthetic.xlsx',2026,'WIP test',41,'test',jsonb_set(rows,'{0,servicePct}','51'),tracker,plan,staff,notes,targets);
 exception when others then
  if sqlerrm<>'core_import_retry_conflict' then raise;end if; rejected:=true;
 end;
 if not rejected then raise exception 'Changed payload reused import fingerprint';end if;
 rejected:=false;
 begin
  perform public.apply_rem_authoritative_workbook_import(repeat('e',64),'duplicate.xlsx',2026,'WIP test',41,'test',rows,tracker||jsonb_build_array(tracker->0),plan,staff,notes,targets);
 exception when others then
  if sqlerrm<>'duplicate_section_key:tracker' then raise;end if; rejected:=true;
 end;
 if not rejected or (select count(*) from public.audit_log)<>before_count then raise exception 'Duplicate planning key accepted or wrote data';end if;
 select * into row_data from public.rem_analyzers where serial_number='56009902';
 progress:='{"procurementPct":null,"cleaningPct":0,"servicePct":45,"finalLinePct":null,"releaseTestingPct":null,"packagingPct":null,"qaReleasePct":null,"sapReleasePct":null}';
 updated:=public.apply_rem_progress_update('analyzer',row_data.id,row_data.progress_revision,engineer,'Service',progress,'test','test','workbook-test-progress');
 if updated->'record'->'progress'->>'cleaningPct'<>'100' or updated->'record'->'progress'->>'procurementPct'<>'100' then raise exception 'Server did not complete prior stages';end if;
 if (select overall_pct from public.rem_analyzers where id=row_data.id) is not null then raise exception 'Missing tasks counted as zero';end if;
 updated:=public.apply_rem_progress_update('analyzer',row_data.id,row_data.progress_revision,engineer,'Service',progress,'test','test','workbook-test-progress');
 if not (updated->>'duplicate')::boolean then raise exception 'Normalization broke idempotency';end if;
 rows:=jsonb_set(rows,'{0,serialNumber}','"56009998"');
 receipt:=public.apply_rem_authoritative_workbook_import(repeat('9',64),'adopt.xlsx',2026,'WIP test',42,'test',rows,tracker,plan,staff,notes,targets);
 if not exists(select 1 from public.rem_analyzers where id=manual_id and workbook_current and registration_origin='workbook' and service_pct=50) then raise exception 'Workbook failed to adopt the registered identity';end if;
end $$;
