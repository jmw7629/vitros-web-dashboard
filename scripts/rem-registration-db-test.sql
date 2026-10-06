-- Synthetic registration fixtures; run inside BEGIN/ROLLBACK on a disposable schema.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare e uuid:=gen_random_uuid(); dead uuid:=gen_random_uuid(); serial text:=upper('VISION-'||gen_random_uuid());
 corr text:='registration-test-'||gen_random_uuid(); a jsonb; b jsonb; r public.rem_analyzers; p jsonb; rejected boolean;
begin
 insert into public.convex_employees(id,name,initials,active) values(e,'Registration engineer','REG',true),(dead,'Inactive registration engineer','OFF',false);
 execute 'set local role service_role';
 if has_function_privilege('anon','public.create_rem_analyzer_record(text,text,text,numeric,uuid,text,text,text)','EXECUTE')
 or has_function_privilege('authenticated','public.create_rem_analyzer_record(text,text,text,numeric,uuid,text,text,text)','EXECUTE') then raise exception 'Untrusted registration access'; end if;
 a:=public.create_rem_analyzer_record('VISION',lower(serial),'VISION',null,e,'Initial record','operator',corr);
 select * into r from public.rem_analyzers where id=(a->'record'->>'id')::uuid;
 if r.serial_number<>serial or r.registration_origin<>'manual' or not r.workbook_current or r.current_stage<>'Unassigned'
 or r.start_date is not null or r.production_order is not null or r.overall_pct is not null or r.service_pct is not null
 or r.cleaning_pct is not null or r.progress_engineer_name<>'Registration engineer' or r.progress_updated_at is null then raise exception 'Registration fabricated or omitted initial state'; end if;
 if (select count(*) from jsonb_object_keys(a->'record'->'progress'))<>6 then raise exception 'VISION has incorrect stages';end if;
 b:=public.create_rem_analyzer_record('VISION',serial,'VISION',null,e,'Initial record','operator',corr);
 if not (b->>'duplicate')::boolean or b->'record'<>a->'record' then raise exception 'Registration retry duplicated unit'; end if;
 rejected:=false;
 begin perform public.create_rem_analyzer_record('VISION',serial,'VISION',3,e,'Initial record','operator',corr);
 exception when others then if sqlerrm not like '%idempotency conflict%' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'Changed payload accepted with old correlation';end if;
 rejected:=false;
 begin perform public.create_rem_analyzer_record('VISION',serial,'VISION',null,e,'','operator',corr||'-duplicate');
 exception when others then if sqlerrm not like '%already exists%' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'Duplicate normalized identity allowed';end if;
 rejected:=false;
 begin perform public.create_rem_analyzer_record('VITROS','56009998','5600',null,dead,'','operator',corr||'-inactive');
 exception when others then if sqlerrm not like '%active engineer%' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'Inactive engineer accepted';end if;
 rejected:=false;
 begin perform public.create_rem_analyzer_record('VITROS','36009998','5600',null,e,'','operator',corr||'-model');
 exception when others then if sqlerrm<>'Invalid analyzer registration' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'Wrong VITROS model accepted';end if;
 p:='{"servicePct":null,"finalLinePct":null,"packagingPct":25,"releaseTestingPct":null,"qaReleasePct":null,"sapReleasePct":null}';
 b:=public.apply_rem_progress_update('vision',r.id,0,e,'Packaging',p,'working','operator',corr||'-progress');
 if b->'record'->'progress'->>'servicePct'<>'100' or b->'record'->'progress'->>'finalLinePct'<>'100'
 or b->'record'->'progress'->>'packagingPct'<>'25' or b->'record'->'progress'->'releaseTestingPct'<>'null'::jsonb then raise exception 'VISION stage precedence failed';end if;
 rejected:=false;
 begin perform public.apply_rem_progress_update('analyzer',r.id,1,e,'Service','{"procurementPct":null,"cleaningPct":null,"servicePct":10,"finalLinePct":null,"releaseTestingPct":null,"packagingPct":null,"qaReleasePct":null,"sapReleasePct":null}','wrong product','operator',corr||'-wrong-kind');
 exception when others then if sqlerrm<>'REM record not found' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'Cross-product workflow update allowed';end if;
 if (select count(*) from public.rem_progress_events where record_id=r.id)<>2
 or not exists(select 1 from public.audit_log where entity_id=r.id::text and action='REM_ANALYZER_CREATE' and new_value is not null) then raise exception 'Registration audit missing or retry duplicated events';end if;
end $$;
