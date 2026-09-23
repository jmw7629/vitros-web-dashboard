-- Run inside a transaction and ROLLBACK; never persist verification records.
-- Keep missing-rejection assertions outside the handlers: their own messages
-- may contain the expected error text and must never be swallowed as success.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare e uuid:=gen_random_uuid(); dead uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
 corr text:='rem-test-'||gen_random_uuid(); created jsonb; result jsonb; p jsonb; rejected boolean;
begin
 insert into public.convex_employees(id,name,initials,active) values(e,'REM test engineer','TST',true),(dead,'REM inactive test','INACT',false);
 execute 'set local role service_role';
 if has_table_privilege('service_role','public.convex_employees','UPDATE')
 or has_table_privilege('service_role','public.rem_progress_events','UPDATE')
 or has_table_privilege('service_role','public.rem_progress_events','DELETE') then raise exception 'Progress grants broaden canonical writes';end if;
 if has_function_privilege('anon','public.apply_rem_progress_update(text,uuid,bigint,uuid,text,jsonb,text,text,text)','EXECUTE')
 or has_function_privilege('authenticated','public.create_rem_lvcc_record(text,text,text,uuid,text,text,text)','EXECUTE')
 or has_table_privilege('authenticated','public.rem_progress_events','SELECT') then raise exception 'Untrusted role has progress access'; end if;
 created:=public.create_rem_lvcc_record('TEST-'||a,'IR Wash — Pump','',e,'test only','test-actor',corr);
 result:=public.create_rem_lvcc_record('TEST-'||a,'IR Wash — Pump','',e,'test only','test-actor',corr);
 if not (result->>'duplicate')::boolean or result->'record' <> created->'record' then raise exception 'Create replay failed';end if;
 rejected:=false;
 begin
  perform public.create_rem_lvcc_record('TEST-'||a,'Electrometer','',e,'test only','test-actor',corr);
 exception when others then
  if sqlerrm not like '%idempotency conflict%' then raise;end if;
  rejected:=true;
 end;
 if not rejected then raise exception 'TEST missing idempotency conflict';end if;
 a:=(created->'record'->>'id')::uuid;
 p:='{"buildPct":25,"testPct":0,"packagingPct":0,"qaReleasePct":null,"sapReleasePct":0}';
 result:=public.apply_rem_progress_update('lvcc',a,0,e,'Build',p,'working','test-actor',corr||'-update');
 if (result->'record'->>'revision')::int<>1 or result->'record'->'progress'->>'buildPct'<>'25'
 or result->'record'->>'engineerName'<>'REM test engineer' or result->'record'->>'updatedAt' is null then raise exception 'Update evidence failed';end if;
 result:=public.apply_rem_progress_update('lvcc',a,0,e,'Build',p,'working','test-actor',corr||'-update');
 if not(result->>'duplicate')::boolean then raise exception 'Update replay failed';end if;
 rejected:=false;
 begin
  perform public.apply_rem_progress_update('lvcc',a,0,e,'Test',p,'working','test-actor',corr||'-stale');
 exception when others then
  if sqlerrm not like '%revision conflict%' then raise;end if;
  rejected:=true;
 end;
 if not rejected then raise exception 'TEST missing revision conflict';end if;
 rejected:=false;
 begin
  perform public.apply_rem_progress_update('lvcc',a,1,dead,'Build',p,'working','test-actor',corr||'-inactive');
 exception when others then
  if sqlerrm not like '%active engineer%' then raise;end if;
  rejected:=true;
 end;
 if not rejected then raise exception 'TEST missing inactive engineer';end if;
 rejected:=false;
 begin
  perform public.apply_rem_progress_update('lvcc',a,1,e,'Build',p||'{"buildPct":101}','working','test-actor',corr||'-range');
 exception when others then
  if sqlerrm not like '%Percentage must%' then raise;end if;
  rejected:=true;
 end;
 if not rejected then raise exception 'TEST missing percentage validation';end if;
 rejected:=false;
 begin
  perform public.apply_rem_progress_update('lvcc',a,1,e,'Complete',p,'working','test-actor',corr||'-complete');
 exception when others then
  if sqlerrm not like '%Complete requires%' then raise;end if;
  rejected:=true;
 end;
 if not rejected then raise exception 'TEST incomplete marked complete';end if;
 p:='{"buildPct":100,"testPct":100,"packagingPct":100,"qaReleasePct":100,"sapReleasePct":100}';
 perform public.apply_rem_progress_update('lvcc',a,1,e,'Complete',p,'done','test-actor',corr||'-done');
 if not(select is_complete and end_date=current_date::text from public.rem_lvcc where id=a) then raise exception 'Completion not stored';end if;
 if (select count(*) from public.rem_progress_events where record_id=a)<>3 then raise exception 'Duplicate audit events';end if;
 a:=gen_random_uuid();
 insert into public.rem_analyzers(id,serial_number,analyzer_type,current_stage,is_complete) values(a,'TEST-'||a,'5600','Service',false);
 p:='{"procurementPct":100,"cleaningPct":100,"servicePct":50,"finalLinePct":0,"packagingPct":0,"releaseTestingPct":0,"qaReleasePct":0,"sapReleasePct":0}';
 perform public.apply_rem_progress_update('analyzer',a,0,e,'Service',p,'test','test-actor',corr||'-analyzer');
 if (select overall_pct from public.rem_analyzers where id=a)<>31.25 or (select current_pct from public.rem_analyzers where id=a)<>50 then raise exception 'Analyzer projection mismatch';end if;
 update public.rem_analyzers set operator_notes='Import changed' where id=a;
 rejected:=false;
 begin
  perform public.apply_rem_progress_update('analyzer',a,1,e,'Service',p,'test','test-actor',corr||'-import-race');
 exception when others then
  if sqlerrm not like '%revision conflict%' then raise;end if;
  rejected:=true;
 end;
 if not rejected then raise exception 'TEST external write bypassed revision';end if;
end $$;
