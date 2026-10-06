-- Synthetic fixtures, execute only inside BEGIN/ROLLBACK on a disposable database.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare e uuid:=gen_random_uuid(); other_e uuid:=gen_random_uuid(); dead uuid:=gen_random_uuid(); rid uuid; corr text:='task-notes:'||gen_random_uuid(); a jsonb; b jsonb; c jsonb; result jsonb; n public.rem_task_notes; revision_before bigint; rejected boolean; before_count integer; p jsonb; vid uuid; lid uuid;
begin
 insert into public.convex_employees(id,name,initials,active) values(e,'Note Author','NA',true),(other_e,'Acknowledging Engineer','AE',true),(dead,'Inactive Engineer','IE',false);
 execute 'set local role service_role';
 if has_function_privilege('anon','public.add_rem_task_note(text,uuid,text,text,uuid,text,text)','EXECUTE') or has_function_privilege('authenticated','public.acknowledge_rem_task_note(text,uuid,uuid,uuid,text,text)','EXECUTE') or has_table_privilege('authenticated','public.rem_task_notes','SELECT') or has_table_privilege('service_role','public.rem_task_notes','DELETE') then raise exception 'Task note privilege boundary failed';end if;
 result:=public.create_rem_analyzer_record('VISION','NOTE-'||gen_random_uuid(),'VISION',null,e,'','operator',corr||'-unit');rid:=(result->'record'->>'id')::uuid;
 select progress_revision into revision_before from public.rem_analyzers where id=rid;
 a:=public.add_rem_task_note('vision',rid,'Service','First service note',e,'operator',corr||'-a');
 b:=public.add_rem_task_note('vision',rid,'Service','Second service note',e,'operator',corr||'-b');
 c:=public.add_rem_task_note('vision',rid,'Final Line','Final-line note',e,'operator',corr||'-c');
 result:=public.add_rem_task_note('vision',rid,'Service','First service note',e,'operator',corr||'-a');
 if not(result->>'duplicate')::boolean or result->'note'<>a->'note' then raise exception 'Task note retry identity failed';end if;
 rejected:=false;begin perform public.add_rem_task_note('vision',rid,'Service','Changed note',e,'operator',corr||'-a');exception when others then if sqlerrm not like '%idempotency conflict%' then raise;end if;rejected:=true;end;if not rejected then raise exception 'Changed retry accepted';end if;
 rejected:=false;begin perform public.add_rem_task_note('vision',rid,'Cleaning','Wrong family task',e,'operator',corr||'-wrong-stage');exception when others then if sqlerrm<>'Invalid REM stage' then raise;end if;rejected:=true;end;if not rejected then raise exception 'VISION accepted VITROS-only task';end if;
 rejected:=false;begin perform public.add_rem_task_note('analyzer',rid,'Service','Wrong family',e,'operator',corr||'-wrong-family');exception when others then if sqlerrm<>'REM record not found' then raise;end if;rejected:=true;end;if not rejected then raise exception 'Cross-family note accepted';end if;
 rejected:=false;begin perform public.add_rem_task_note('vision',rid,'Service','Inactive',dead,'operator',corr||'-inactive');exception when others then if sqlerrm not like '%active engineer%' then raise;end if;rejected:=true;end;if not rejected then raise exception 'Inactive note author accepted';end if;
 rejected:=false;begin perform public.acknowledge_rem_task_note('vision',gen_random_uuid(),(a->'note'->>'id')::uuid,other_e,'operator',corr||'-wrong-unit');exception when others then if sqlerrm<>'Task note not found' then raise;end if;rejected:=true;end;if not rejected then raise exception 'Cross-unit acknowledgment accepted';end if;
 rejected:=false;begin perform public.acknowledge_rem_task_note('vision',rid,(a->'note'->>'id')::uuid,dead,'operator',corr||'-dead-ack');exception when others then if sqlerrm not like '%active engineer%' then raise;end if;rejected:=true;end;if not rejected then raise exception 'Inactive acknowledger accepted';end if;
 result:=public.acknowledge_rem_task_note('vision',rid,(a->'note'->>'id')::uuid,other_e,'operator',corr||'-ack');
 if result->'note'->>'content'<>'First service note' or result->'note'->>'engineerName'<>'Note Author' or result->'note'->>'acknowledgedBy'<>'Acknowledging Engineer' or result->'note'->>'acknowledgedAt' is null then raise exception 'Acknowledgment lost history';end if;
 result:=public.acknowledge_rem_task_note('vision',rid,(a->'note'->>'id')::uuid,other_e,'operator',corr||'-ack');if not(result->>'duplicate')::boolean then raise exception 'Acknowledgment retry not idempotent';end if;
 rejected:=false;begin perform public.acknowledge_rem_task_note('vision',rid,(a->'note'->>'id')::uuid,e,'operator',corr||'-concurrent');exception when others then if sqlerrm<>'Note already acknowledged' then raise;end if;rejected:=true;end;if not rejected then raise exception 'Concurrent acknowledgment overwrote identity';end if;
 perform public.add_rem_task_note('vision',rid,'Service','New concurrent service note',e,'operator',corr||'-new');
 result:=public.rem_task_note_summaries(array[rid],array[]::uuid[]);
 if (select (t->>'count')::integer from jsonb_array_elements(result->0->'pendingNotes')t where t->>'stage'='Service')<>2 or (select (t->>'count')::integer from jsonb_array_elements(result->0->'pendingNotes')t where t->>'stage'='Final Line')<>1 then raise exception 'Acknowledgment cleared other task/new notes';end if;
 if public.rem_task_note_summaries(array[gen_random_uuid()],array[]::uuid[])<>'[]'::jsonb then raise exception 'Summary returned unrelated records';end if;
 if (select progress_revision from public.rem_analyzers where id=rid)<>revision_before or (select service_pct from public.rem_analyzers where id=rid) is not null then raise exception 'Task notes modified progress';end if;
 rejected:=false;begin update public.rem_task_notes set acknowledged_by='Overwritten' where id=(a->'note'->>'id')::uuid;exception when others then if sqlerrm<>'Task note history is immutable' then raise;end if;rejected:=true;end;if not rejected then raise exception 'Acknowledgment history mutable';end if;
 if (select count(*) from public.audit_log where action='REM_TASK_NOTE_ACKNOWLEDGE' and entity_id=rid::text)<>1 then raise exception 'Acknowledgment audit missing or duplicated';end if;
 p:='{"servicePct":20,"finalLinePct":null,"packagingPct":null,"releaseTestingPct":null,"qaReleasePct":null,"sapReleasePct":null}';
 perform public.apply_rem_progress_update('vision',rid,0,e,'Service',p,'Legacy kiosk note','operator',corr||'-progress');
 select count(*) into before_count from public.rem_task_notes where record_id=rid;
 if before_count<>5 or not exists(select 1 from public.rem_task_notes where record_id=rid and content='Legacy kiosk note' and stage='Service' and engineer_id=e and source_event_id is not null) then raise exception 'Legacy progress note not captured atomically';end if;
 perform public.apply_rem_progress_update('vision',rid,1,e,'Service',p,'Legacy kiosk note','operator',corr||'-progress-repeat');
 if (select count(*) from public.rem_task_notes where record_id=rid)<>before_count then raise exception 'Unchanged legacy note duplicated';end if;
 result:=public.create_rem_analyzer_record('VITROS','56008888','5600',null,e,'','operator',corr||'-vitros');vid:=(result->'record'->>'id')::uuid;
 perform public.add_rem_task_note('analyzer',vid,'Cleaning','Cleaning note',e,'operator',corr||'-vitros-note');
 result:=public.create_rem_lvcc_record('NOTE-LVCC-'||gen_random_uuid(),'Electrometer','',e,'','operator',corr||'-lvcc');lid:=(result->'record'->>'id')::uuid;
 perform public.add_rem_task_note('lvcc',lid,'Test','LVCC test note',e,'operator',corr||'-lvcc-note');
 result:=public.rem_task_note_summaries(array[vid],array[lid]);
 if jsonb_array_length(result)<>2 or not exists(select 1 from jsonb_array_elements(result)x where x->>'kind'='lvcc' and x->'pendingNotes'->0->>'stage'='Test') then raise exception 'VITROS/LVCC task summary missing';end if;

end $$;
