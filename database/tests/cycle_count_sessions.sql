-- DISPOSABLE DATABASE ONLY. Uses the production RPCs; all fixtures roll back.
begin;
alter table public.stock add column if not exists type text default 'Required';
alter table public.stock add column if not exists min_qty integer default 1;
alter table public.stock add column if not exists max_qty integer default 10;
alter table public.stock add column if not exists on_plan boolean default false;
grant select on public.stock,public.dhr_scan_sessions,public.dhr_scan_results to service_role;
create function pg_temp.assert_cycle(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Cycle test failed: %',msg; end if; end;
$$;
do $$
declare
 schedule uuid; session uuid; cid uuid; response jsonb; snapshot jsonb; line jsonb; request jsonb;
 before_stock integer; before_audit integer; before_sap integer; before_results integer;
 stock_id uuid; dhr_id uuid:=gen_random_uuid(); second_schedule uuid; second_session uuid;
 retry_request jsonb; failed boolean; rev integer; token text; before_token text;
begin
 insert into public.stock(part_number,description,qty_on_hand,type) values
 ('CY-R10','Cycle fixture required',9,'Required'),('CY-R2','Cycle fixture required two',10,'Required'),
 ('CY-A1','Cycle fixture optional',2,'Optional'),('CY-C1','Cycle fixture consumable',3,'Consumable'),
 ('CY-U1','Cycle fixture unclassified',0,'Unclassified'),('CY-N1','Cycle fixture not on BOM',0,'Not on BOM');
 select id into stock_id from public.stock where part_number='CY-R10';
 insert into public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category) values('5600','C1','CY-R10','Cycle fixture required',4,'required');
 insert into public.dhr_scan_sessions(id,instrument_sn,wo_number,analyzer_model,status)
 values(dhr_id,'CYCLE-ACTIVE','CYCLE-FIXTURE','5600','in_progress');
 perform public.apply_dhr_scan_transition(dhr_id,'C1','CY-R10',4,2,'required','Cycle fixture required','fixture-admin','cycle-fixture-initial',0,'CYCLE-ACTIVE');
 insert into public.dhr_scan_results(session_id,section_id,part_number,scanned_qty,stock_id)
 values(dhr_id,'C2','DISPLAY-ALIAS',1,stock_id);
 snapshot:=public.read_cycle_count_wip();
 perform pg_temp.assert_cycle((snapshot->'serials')?'CYCLE-ACTIVE','active DHR serial is automatic');
 perform pg_temp.assert_cycle((select (p->'wipEntries'->>'CYCLE-ACTIVE')::integer=3 from jsonb_array_elements(snapshot->'parts') p where p->>'partNumber'='CY-R10'),'WIP aggregates sections by canonical stock_id');
 update public.dhr_scan_sessions set status='completed' where id=dhr_id;
 perform pg_temp.assert_cycle(not(public.read_cycle_count_wip()->'serials'?'CYCLE-ACTIVE'),'completed DHR excluded');
 update public.dhr_scan_sessions set status='deleted' where id=dhr_id;
 perform pg_temp.assert_cycle(not(public.read_cycle_count_wip()->'serials'?'CYCLE-ACTIVE'),'deleted DHR excluded');
 update public.dhr_scan_sessions set status='in_progress' where id=dhr_id;
 response:=public.apply_cycle_count_operation('createSchedule',jsonb_build_object('name','Cycle fixture W2W','frequency','Single','assignedTo','Fixture','startDate',1,'parts',jsonb_build_array('CY-R10')),'fixture-admin',gen_random_uuid());
 schedule:=(response->>'id')::uuid;
 response:=public.apply_cycle_count_operation('start',jsonb_build_object('id',schedule,'scopeMode','w2w'),'fixture-admin',gen_random_uuid());
 session:=(response->>'sessionId')::uuid;
 perform pg_temp.assert_cycle((select scope_parts?'CY-C1' and scope_parts?'CY-U1' and scope_parts?'CY-N1' and jsonb_array_length(scope_parts)=(select count(*) from public.stock) from public.cycle_count_sessions where id=session),'W2W includes every stock type beyond scheduled parts');
 snapshot:=public.read_cycle_count_wip();
 select p->>'stockToken' into token from jsonb_array_elements(snapshot->'parts') p where p->>'partNumber'='CY-R10';
 line:=jsonb_build_object('partNumber','CY-R10','countedQty',4,'incomingQty',null,'stockToken',token);
 request:=jsonb_build_object('sessionId',session,'expectedRevision',0,'sortMode','w2w','lines',jsonb_build_array(line));
 select count(*) into before_audit from public.audit_log;select count(*) into before_sap from public.sap_staging;
 cid:=gen_random_uuid();response:=public.apply_cycle_count_operation('save',request,'fixture-admin',cid);
 perform pg_temp.assert_cycle((response->>'revision')::integer=1,'autosave revision');
 perform pg_temp.assert_cycle((select lines->0->>'countedQty'='4' and lines->0->'incomingQty'='null'::jsonb from public.cycle_count_sessions where id=session),'partial nullable fields are durable');
 response:=public.apply_cycle_count_operation('save',request,'fixture-admin',cid);
 perform pg_temp.assert_cycle((response->>'duplicate')::boolean,'autosave lost-response replay');
 failed:=false;begin perform public.apply_cycle_count_operation('save',request||jsonb_build_object('sortMode','alpha'),'fixture-admin',cid);exception when others then failed:=true;end;
 perform pg_temp.assert_cycle(failed,'same operation cannot change payload');
 request:=request||jsonb_build_object('expectedRevision',1);
 response:=public.apply_cycle_count_operation('pause',request,'fixture-admin',gen_random_uuid());
 perform pg_temp.assert_cycle(response->>'status'='paused','Save and Exit pauses durably');
 perform pg_temp.assert_cycle((select qty_on_hand=7 from public.stock where part_number='CY-R10'),'Save and Exit never adjusts stock');
 perform pg_temp.assert_cycle((select count(*)=before_audit from public.audit_log) and (select count(*)=before_sap from public.sap_staging),'save and pause create no inventory or SAP events');
 failed:=false;begin perform public.apply_cycle_count_operation('save',request||jsonb_build_object('expectedRevision',2),'fixture-admin',gen_random_uuid());exception when others then failed:=true;end;
 perform pg_temp.assert_cycle(failed,'paused session rejects autosave');
 response:=public.apply_cycle_count_operation('start',jsonb_build_object('id',schedule,'scopeMode','w2w'),'fixture-admin',gen_random_uuid());
 rev:=(response->>'revision')::integer;
 perform pg_temp.assert_cycle((select lines->0->>'countedQty'='4' from public.cycle_count_sessions where id=session),'Play restores saved count');
 failed:=false;begin perform public.apply_cycle_count_operation('save',request,'fixture-admin',gen_random_uuid());exception when others then failed:=true;end;
 perform pg_temp.assert_cycle(failed,'stale session revision cannot overwrite');
 request:=request||jsonb_build_object('expectedRevision',rev,'adjustmentBasis','counted','wipFingerprint',public.read_cycle_count_wip()->>'fingerprint');
 cid:=gen_random_uuid();select count(*) into before_results from public.cycle_results;
 response:=public.apply_cycle_count_operation('confirm',request,'fixture-admin',cid);
 perform pg_temp.assert_cycle(response->>'status'='completed','Confirm completes session');
 perform pg_temp.assert_cycle((select status='completed' from public.cycle_schedules where id=schedule),'Confirm closes schedule');
 perform pg_temp.assert_cycle((select qty_on_hand=4 from public.stock where part_number='CY-R10'),'counted-only final quantity');
 perform pg_temp.assert_cycle((select count(*)=1 from public.audit_log where correlation_id='cycle-count:'||session::text||':'||stock_id::text),'one audited ADJUST per changed part');
 perform pg_temp.assert_cycle((select count(*)=1 from public.sap_staging where correlation_id='cycle-count:'||session::text||':'||stock_id::text),'one SAP staging row per adjustment');
 perform pg_temp.assert_cycle((select count(*)=before_results+1 from public.cycle_results),'final count history is atomic');
 response:=public.apply_cycle_count_operation('confirm',request,'fixture-admin',cid);
 perform pg_temp.assert_cycle((response->>'duplicate')::boolean,'confirm exact retry returns original receipt');
 perform pg_temp.assert_cycle((select count(*)=before_results+1 from public.cycle_results),'confirmation retry creates no duplicate history');
 failed:=false;begin perform public.apply_cycle_count_operation('confirm',request,'fixture-admin',gen_random_uuid());exception when others then failed:=true;end;
 perform pg_temp.assert_cycle(failed,'closed count cannot adjust again');
 -- Two-line combined adjustment: the second line fails after the first would
 -- have written. PostgreSQL must roll back stock, ledger, history and lifecycle.
 response:=public.apply_cycle_count_operation('createSchedule',jsonb_build_object('name','Cycle fixture rollback','frequency','Single','assignedTo','Fixture','startDate',1,'parts',jsonb_build_array('CY-A1','CY-R2')),'fixture-admin',gen_random_uuid());
 second_schedule:=(response->>'id')::uuid;
 response:=public.apply_cycle_count_operation('start',jsonb_build_object('id',second_schedule,'scopeMode','standard'),'fixture-admin',gen_random_uuid());second_session:=(response->>'sessionId')::uuid;
 snapshot:=public.read_cycle_count_wip();
 select jsonb_agg(jsonb_build_object('partNumber',p->>'partNumber','countedQty',5,'incomingQty',1,'stockToken',p->>'stockToken') order by p->>'partNumber') into line from jsonb_array_elements(snapshot->'parts') p where p->>'partNumber' in ('CY-A1','CY-R2');
 request:=jsonb_build_object('sessionId',second_session,'expectedRevision',0,'sortMode','alpha','lines',line,'adjustmentBasis','counted_wip_incoming','wipFingerprint',snapshot->>'fingerprint');
 update public.stock set updated_at=clock_timestamp() where part_number='CY-R2';
 select count(*) into before_audit from public.audit_log;select count(*) into before_sap from public.sap_staging;select count(*) into before_results from public.cycle_results;
 failed:=false;begin perform public.apply_cycle_count_operation('confirm',request,'fixture-admin',gen_random_uuid());exception when others then failed:=sqlerrm like 'Stock changed during count%';end;
 perform pg_temp.assert_cycle(failed,'stock conflict is explicit');
 perform pg_temp.assert_cycle((select qty_on_hand=2 from public.stock where part_number='CY-A1'),'earlier part adjustment rolled back');
 perform pg_temp.assert_cycle((select count(*)=before_audit from public.audit_log) and (select count(*)=before_sap from public.sap_staging) and (select count(*)=before_results from public.cycle_results),'no partial ledger, SAP or result on conflict');
 perform pg_temp.assert_cycle((select status='active' and revision=0 from public.cycle_count_sessions where id=second_session),'failed confirm remains active');
 -- A DHR update after review changes the WIP fingerprint.
 perform public.apply_dhr_scan_transition(dhr_id,'C1','CY-R10',4,4,'required','Cycle fixture required','fixture-admin','cycle-fixture-update',1,'CYCLE-ACTIVE');
 failed:=false;begin perform public.apply_cycle_count_operation('confirm',request,'fixture-admin',gen_random_uuid());exception when others then failed:=sqlerrm like 'DHR WIP changed%';end;
 perform pg_temp.assert_cycle(failed,'WIP update requires a new review');
 snapshot:=public.read_cycle_count_wip();
 select jsonb_agg(jsonb_build_object('partNumber',p->>'partNumber','countedQty',5,'incomingQty',1,'stockToken',p->>'stockToken') order by p->>'partNumber') into line from jsonb_array_elements(snapshot->'parts') p where p->>'partNumber' in ('CY-A1','CY-R2');
 request:=request||jsonb_build_object('lines',line,'wipFingerprint',snapshot->>'fingerprint');
 response:=public.apply_cycle_count_operation('confirm',request,'fixture-admin',gen_random_uuid());
 perform pg_temp.assert_cycle((select qty_on_hand=6 from public.stock where part_number='CY-A1'),'combined quantity includes incoming');
 -- Confirm with WIP included uses the current server quantity, not browser WIP.
 response:=public.apply_cycle_count_operation('updateSchedule',jsonb_build_object('id',schedule,'status','active'),'fixture-admin',gen_random_uuid());
 response:=public.apply_cycle_count_operation('start',jsonb_build_object('id',schedule,'scopeMode','standard'),'fixture-admin',gen_random_uuid());session:=(response->>'sessionId')::uuid;
 snapshot:=public.read_cycle_count_wip();select p->>'stockToken' into token from jsonb_array_elements(snapshot->'parts') p where p->>'partNumber'='CY-R10';
 request:=jsonb_build_object('sessionId',session,'expectedRevision',0,'sortMode','alpha','lines',jsonb_build_array(jsonb_build_object('partNumber','CY-R10','countedQty',2,'incomingQty',1,'stockToken',token)),'adjustmentBasis','counted_wip_incoming','wipFingerprint',snapshot->>'fingerprint');
 response:=public.apply_cycle_count_operation('confirm',request,'fixture-admin',gen_random_uuid());
 perform pg_temp.assert_cycle((select qty_on_hand=8 from public.stock where part_number='CY-R10'),'combined = counted 2 + live WIP 5 + incoming 1');
 failed:=false;begin update public.cycle_count_events set actor='tampered' where correlation_id=cid;exception when others then failed:=true;end;
 perform pg_temp.assert_cycle(failed,'cycle audit events immutable');
 perform pg_temp.assert_cycle(not has_function_privilege('anon','public.apply_cycle_count_operation(text,jsonb,text,uuid)','execute'),'anonymous RPC execution denied');
 perform pg_temp.assert_cycle(not has_function_privilege('authenticated','public.apply_cycle_count_operation(text,jsonb,text,uuid)','execute'),'direct authenticated RPC execution denied');
 perform pg_temp.assert_cycle(has_function_privilege('service_role','public.apply_cycle_count_operation(text,jsonb,text,uuid)','execute'),'server RPC execution allowed');
 perform pg_temp.assert_cycle(not has_table_privilege('anon','public.cycle_count_sessions','select'),'anonymous session data denied');
 raise notice 'CYCLE_COUNT_DATABASE=PASS: durable checkpoints, WIP, scope, CAS, exact retries, atomic adjustments and rollback';
end;
$$;
rollback;
