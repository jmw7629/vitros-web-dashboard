-- Only fictional bindings are registered in this disposable fixture.
create function public.test_digital_event(p_field text,p_version integer,p_previous integer,p_quantity integer,p_id uuid default gen_random_uuid()) returns jsonb language sql as $$
 select jsonb_build_object('eventId',p_id,'idempotencyKey',p_id,'documentInstanceId','dddddddd-dddd-4ddd-8ddd-dddddddddddd','documentTemplateId','synthetic:document','documentRevision','TEST-1','fieldId',p_field,'fieldVersion',p_version,'sectionId','SYNTHETIC','partNumber',case p_field when 'synthetic.tool' then 'TOOL1' when 'synthetic.missing' then 'MISSING' when 'synthetic.alias' then 'ALIAS' else 'ABC123' end,'previousQuantity',p_previous,'quantity',p_quantity,'instrumentSn','56009999','woNumber','SYNTHETIC-WO','occurredAt','2026-09-13T00:00:00.000Z')
$$;
create function public.test_digital_apply(p_event jsonb,p_operator text default 'synthetic-operator-a',p_employee uuid default '11111111-1111-4111-8111-111111111111') returns jsonb language sql as $$
 select public.apply_digital_dhr_field_event(p_event,p_operator,p_employee)
$$;
create function public.test_digital_reject(p_event jsonb,p_message text) returns void language plpgsql as $$
declare rejected boolean:=false;
begin
 begin perform public.test_digital_apply(p_event); exception when others then if sqlerrm is distinct from p_message then raise exception 'Unexpected rejection: %',sqlerrm; end if;rejected:=true;end;
 if not rejected then raise exception 'Expected digital event rejection'; end if;
end $$;

do $$
declare m jsonb; bad jsonb; r jsonb; event jsonb; first_event jsonb; saved jsonb; n integer; rejected boolean:=false;
begin
 if public.get_digital_dhr_bridge_status() then raise exception 'bridge defaults on'; end if;
 event:=public.test_digital_event('synthetic.quantity.a',1,0,2);
 perform public.test_digital_reject(event,'digital_dhr_disabled');
 m:='{"schemaVersion":1,"templateId":"synthetic:document","documentRevision":"TEST-1","analyzerModel":"5600","artifactSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bindings":[{"fieldId":"synthetic.quantity.a","sectionId":"SYNTHETIC","partNumber":"ABC123","kind":"consumable_part","quantityMode":"integer"},{"fieldId":"synthetic.quantity.b","sectionId":"SYNTHETIC","partNumber":"ABC123","kind":"consumable_part","quantityMode":"integer"},{"fieldId":"synthetic.tool","sectionId":"SYNTHETIC","partNumber":"TOOL1","kind":"tool","quantityMode":"integer"},{"fieldId":"synthetic.missing","sectionId":"SYNTHETIC","partNumber":"MISSING","kind":"consumable_part","quantityMode":"integer"},{"fieldId":"synthetic.alias","sectionId":"SYNTHETIC","partNumber":"ALIAS","kind":"consumable_part","quantityMode":"integer"}]}'::jsonb;
 update public.dhr_expected_parts set inventory_part_number='ALT123' where part_number='ALIAS';
 perform public.register_digital_dhr_manifest(m,'synthetic-reviewer','disposable-fixture-only');
 perform public.register_digital_dhr_manifest(m,'synthetic-reviewer','disposable-fixture-only');
 if (select count(*) from public.digital_dhr_manifests)<>1 then raise exception 'manifest replay duplicates'; end if;
 bad:=jsonb_set(m,'{bindings,2,kind}','"consumable_part"');
 begin perform public.register_digital_dhr_manifest(bad,'synthetic','synthetic');exception when others then rejected:=true;end;
 if not rejected then raise exception 'tool misclassified consumable';end if;
 update public.settings set value='true' where key='digitalDhrEnabled';
 r:=public.create_digital_dhr_document('dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','synthetic:document','TEST-1','synthetic-operator-a','11111111-1111-4111-8111-111111111111');
 if jsonb_array_length(r->'fields')<>5 or (select count(*) from public.digital_dhr_part_totals)<>4 then raise exception 'repeated part aggregation initialization'; end if;
 r:=public.create_digital_dhr_document('dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','synthetic:document','TEST-1','synthetic-operator-a','11111111-1111-4111-8111-111111111111');
 first_event:=event;r:=public.test_digital_apply(event);saved:=r;
 if r->>'status'<>'consumed' or r->>'delta'<>'2' or r->>'stockBefore'<>'20' or r->>'stockAfter'<>'18' or r->>'operatorInitials'<>'SA' or r->>'occurredAt'<>event->>'occurredAt' then raise exception 'first receipt invalid';end if;
 if (select qty_on_hand from public.stock where part_number='ABC123')<>18 or (select count(*) from public.sap_staging where export_status='pending' and qty_on_hand=2)<>1 then raise exception 'stock/SAP consumption mismatch';end if;
 r:=public.test_digital_apply(event);
 if r is distinct from saved||'{"duplicate":true}'::jsonb or (select count(*) from public.audit_log)<>1 then raise exception 'replay changed stock or receipt';end if;
 perform public.test_digital_reject(jsonb_set(event,'{quantity}','3'),'digital_dhr_conflict');
 perform public.test_digital_reject(public.test_digital_event('synthetic.quantity.a',1,0,3),'digital_dhr_conflict');
 r:=public.test_digital_apply(public.test_digital_event('synthetic.quantity.a',2,2,3),'synthetic-operator-b','22222222-2222-4222-8222-222222222222');
 if r->>'delta'<>'1' or r->>'operatorInitials'<>'SB' then raise exception 'multiuser field revision attribution';end if;
 r:=public.test_digital_apply(public.test_digital_event('synthetic.quantity.b',1,0,4));
 if r->>'delta'<>'4' or (select scanned_qty from public.dhr_scan_results where part_number='ABC123')<>7 then raise exception 'repeated field contribution lost';end if;
 r:=public.test_digital_apply(public.test_digital_event('synthetic.quantity.a',3,3,1));
 if r->>'status'<>'returned' or r->>'delta'<>'-2' or (select scanned_qty from public.dhr_scan_results where part_number='ABC123')<>5 or (select qty_on_hand from public.stock where part_number='ABC123')<>15 then raise exception 'field-specific compensating return invalid';end if;
 n:=(select count(*) from public.audit_log);
 r:=public.test_digital_apply(public.test_digital_event('synthetic.quantity.a',4,1,1));
 if r->>'status'<>'unchanged' or r->>'delta'<>'0' or (select count(*) from public.audit_log)<>n then raise exception 'unchanged creates movement';end if;
 r:=public.test_digital_apply(public.test_digital_event('synthetic.tool',1,0,3));
 if r->>'status'<>'ignored' or r->>'delta'<>'0' or r->'stockBefore'<>'null'::jsonb or (select count(*) from public.audit_log)<>n then raise exception 'tool moves inventory';end if;
 perform public.test_digital_reject(public.test_digital_event('synthetic.missing',1,0,1),'digital_dhr_not_found');
 perform public.test_digital_reject(public.test_digital_event('synthetic.quantity.a',5,1,100),'digital_dhr_insufficient_stock');
 perform public.test_digital_reject(public.test_digital_event('synthetic.quantity.a',5,1,-1),'digital_dhr_validation');
 perform public.test_digital_reject(jsonb_set(public.test_digital_event('synthetic.quantity.a',5,1,2),'{quantity}','1.5'),'digital_dhr_validation');
 perform public.test_digital_reject(jsonb_set(public.test_digital_event('synthetic.quantity.a',5,1,2),'{actor}','"forged"'),'digital_dhr_validation');
 perform public.test_digital_reject(jsonb_set(public.test_digital_event('synthetic.quantity.a',5,1,2),'{instrumentSn}','"56000000"'),'digital_dhr_conflict');
 r:=public.test_digital_apply(public.test_digital_event('synthetic.alias',1,0,1));
 if r->>'partNumber'<>'ALIAS' or r->>'inventoryPartNumber'<>'ALT123' or r->>'stockId' is distinct from (select id::text from public.stock where part_number='ALT123') or (select qty_on_hand from public.stock where part_number='ALT123')<>19 then raise exception 'canonical inventory alias not honored';end if;
 update public.dhr_scan_sessions set status='completed' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 r:=public.test_digital_apply(first_event);
 if not (r->>'duplicate')::boolean then raise exception 'finalized exact retry unavailable';end if;
 perform public.test_digital_reject(public.test_digital_event('synthetic.quantity.a',5,1,2),'digital_dhr_conflict');
 update public.dhr_scan_sessions set status='in_progress' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 -- Manual scanner remains independently usable and creates a detectable conflict.
 perform public.apply_dhr_scan_transition('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SYNTHETIC','ABC123',2,6,'required','ignored','Synthetic Manual (SM)','synthetic-manual',5,'56009999');
 perform public.test_digital_reject(public.test_digital_event('synthetic.quantity.a',5,1,2),'digital_dhr_conflict');
 r:=public.get_digital_dhr_document('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
 if (select count(*) from jsonb_array_elements(r->'fields') f where (f->>'conflict')::boolean)<>2 then raise exception 'shared aggregate conflict not exposed';end if;
 if not exists(select 1 from public.audit_log where user_name='Synthetic Bob (SB)') then raise exception 'canonical multiuser audit identity missing';end if;
 if has_function_privilege('authenticated','public.apply_digital_dhr_field_event(jsonb,text,uuid)','EXECUTE') or has_table_privilege('anon','public.digital_dhr_consumption_events','SELECT') or has_table_privilege('service_role','public.digital_dhr_field_state','UPDATE') then raise exception 'bridge grants exposed';end if;
 if exists(select 1 from pg_class where relname like 'digital_dhr_%' and relkind='r' and not relrowsecurity) then raise exception 'bridge RLS missing';end if;
 rejected:=false;begin update public.digital_dhr_consumption_events set receipt='{}'::jsonb;exception when others then rejected:=true;end;if not rejected then raise exception 'receipt history mutable';end if;
end $$;

-- Force the final bridge ledger insert to fail AFTER the real inventory/scanner
-- primitive. Every linked stock/audit/SAP/scanner/field change must roll back.
create function public.test_digital_late_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic-late-failure';end$$;
create trigger synthetic_digital_late_failure before insert on public.digital_dhr_consumption_events for each row execute function public.test_digital_late_failure();
do $$
declare n integer; rejected boolean:=false; quantity integer; field_revision integer;
begin
 select count(*) into n from public.audit_log;
 select qty_on_hand into quantity from public.stock where part_number='ALT123';
 select field_version into field_revision from public.digital_dhr_field_state where field_id='synthetic.alias';
 begin perform public.test_digital_apply(public.test_digital_event('synthetic.alias',2,1,2));exception when others then if sqlerrm<>'synthetic-late-failure' then raise;end if;rejected:=true;end;
 if not rejected or (select count(*) from public.audit_log)<>n or (select qty_on_hand from public.stock where part_number='ALT123')<>quantity or (select field_version from public.digital_dhr_field_state where field_id='synthetic.alias')<>field_revision or (select scanned_qty from public.dhr_scan_results where part_number='ALIAS')<>1 then raise exception 'late failure did not roll back';end if;
end$$;
drop trigger synthetic_digital_late_failure on public.digital_dhr_consumption_events;

-- Additional fail-closed identity/adoption boundaries and an explicit 0 -> 0.
do $$
declare r jsonb; m jsonb; e jsonb; rejected boolean; n integer; before_stock integer;
begin
 select count(*) into n from public.audit_log;
 select qty_on_hand into before_stock from public.stock where part_number='ABC123';
 e:=public.test_digital_event('synthetic.quantity.a',6,1,2);
 rejected:=false;begin perform public.test_digital_apply(e,'synthetic-inactive','33333333-3333-4333-8333-333333333333');exception when others then if sqlerrm<>'digital_dhr_identity_unavailable' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'inactive identity accepted';end if;
 select request into e from public.digital_dhr_consumption_events order by created_at,event_id limit 1;
 rejected:=false;begin perform public.test_digital_apply(e,'synthetic-impostor','22222222-2222-4222-8222-222222222222');exception when others then if sqlerrm<>'digital_dhr_conflict' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'different actor stole duplicate receipt';end if;
 -- An existing manual row cannot become an assumed already-consumed baseline.
 perform public.apply_dhr_scan_transition('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','SYNTHETIC','ABC123',2,0,'required','ignored','Synthetic Manual (SM)','synthetic-manual-zero',0,'56009998');
 rejected:=false;begin perform public.create_digital_dhr_document('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic:document','TEST-1','synthetic-operator-a','11111111-1111-4111-8111-111111111111');exception when others then if sqlerrm<>'digital_dhr_fresh_session_required' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'manual baseline automatically adopted';end if;
 insert into public.dhr_scan_sessions(id,instrument_sn,analyzer_model,status) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','56009997','5600','in_progress');
 perform public.create_digital_dhr_document('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','cccccccc-cccc-4ccc-8ccc-cccccccccccc','synthetic:document','TEST-1','synthetic-operator-a','11111111-1111-4111-8111-111111111111');
 e:=public.test_digital_event('synthetic.quantity.a',1,0,0)-'woNumber';
 e:=e||'{"documentInstanceId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","instrumentSn":"56009997"}'::jsonb;
 r:=public.test_digital_apply(e);
 if r->>'status'<>'unchanged' or r->>'delta'<>'0' or r->>'fieldVersion'<>'1' or r->'woNumber'<>'null'::jsonb then raise exception 'zero baseline event invalid';end if;
 if (select count(*) from public.audit_log)<>n or (select qty_on_hand from public.stock where part_number='ABC123')<>before_stock then raise exception 'rejected identity or zero baseline moved stock';end if;
 select manifest into m from public.digital_dhr_manifests limit 1;
 rejected:=false;begin perform public.register_digital_dhr_manifest(jsonb_set(m,'{artifactSha256}','"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"'),'synthetic-reviewer','synthetic');exception when others then if sqlerrm<>'digital_dhr_conflict' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'immutable template revision remapped';end if;
end$$;

-- A changed inventory alias must never redirect a compensating return.
do $$
declare e jsonb; r jsonb; a integer; b integer; audit_count integer;
begin
 e:=(public.test_digital_event('synthetic.quantity.a',2,0,2)-'woNumber')||'{"documentInstanceId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","instrumentSn":"56009997"}'::jsonb;
 r:=public.test_digital_apply(e);
 if r->>'inventoryPartNumber'<>'ABC123' then raise exception 'resolved initial inventory identity absent';end if;
 select qty_on_hand into a from public.stock where part_number='ABC123';
 select qty_on_hand into b from public.stock where part_number='ALT123';
 select count(*) into audit_count from public.audit_log;
 update public.dhr_expected_parts set inventory_part_number='ALT123' where part_number='ABC123';
 e:=(public.test_digital_event('synthetic.quantity.a',3,2,0)-'woNumber')||'{"documentInstanceId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","instrumentSn":"56009997"}'::jsonb;
 perform public.test_digital_reject(e,'digital_dhr_conflict');
 if (select qty_on_hand from public.stock where part_number='ABC123')<>a or (select qty_on_hand from public.stock where part_number='ALT123')<>b or (select count(*) from public.audit_log)<>audit_count or (select quantity from public.digital_dhr_field_state where instance_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' and field_id='synthetic.quantity.a')<>2 then raise exception 'mapping drift corrupted inventory or accepted state';end if;
 r:=public.get_digital_dhr_document('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
 if (select count(*) from jsonb_array_elements(r->'fields') f where (f->>'conflict')::boolean)<>2 then raise exception 'mapping drift missing from shared field state';end if;
 update public.dhr_expected_parts set inventory_part_number=null where part_number='ABC123';
 r:=public.test_digital_apply(e);
 if r->>'status'<>'returned' or r->>'inventoryPartNumber'<>'ABC123' or (select qty_on_hand from public.stock where part_number='ABC123')<>a+2 or (select qty_on_hand from public.stock where part_number='ALT123')<>b then raise exception 'restored mapping did not return to original inventory';end if;
end$$;

-- Deterministic interleaving probe: a late configuration mutation before field
-- insertion must not leave a committed instance with fields missing aggregates.
create function public.test_digital_attachment_drift() returns trigger language plpgsql as $$
begin
 if new.instance_id='ffffffff-ffff-4fff-8fff-ffffffffffff' and new.field_id='synthetic.quantity.a' then
  update public.dhr_expected_parts set part_number='ABC123-MOVED' where part_number='ABC123';
 end if;
 return new;
end$$;
create trigger synthetic_digital_attachment_drift before insert on public.digital_dhr_field_state for each row execute function public.test_digital_attachment_drift();
do $$
declare rejected boolean:=false; r jsonb;
begin
 insert into public.dhr_scan_sessions(id,instrument_sn,analyzer_model,status) values('ffffffff-ffff-4fff-8fff-ffffffffffff','56009996','5600','in_progress');
 begin
  perform public.create_digital_dhr_document('ffffffff-ffff-4fff-8fff-ffffffffffff','ffffffff-ffff-4fff-8fff-ffffffffffff','synthetic:document','TEST-1','synthetic-operator-a','11111111-1111-4111-8111-111111111111');
 exception when others then if sqlerrm<>'digital_dhr_conflict' then raise;end if;rejected:=true;end;
 if not rejected or exists(select 1 from public.digital_dhr_instances where id='ffffffff-ffff-4fff-8fff-ffffffffffff') or exists(select 1 from public.digital_dhr_field_state where instance_id='ffffffff-ffff-4fff-8fff-ffffffffffff') or exists(select 1 from public.digital_dhr_part_totals where instance_id='ffffffff-ffff-4fff-8fff-ffffffffffff') or exists(select 1 from public.dhr_expected_parts where part_number='ABC123-MOVED') then raise exception 'partial attachment or configuration drift committed';end if;
end$$;
drop trigger synthetic_digital_attachment_drift on public.digital_dhr_field_state;
do $$
declare r jsonb;
begin
 r:=public.create_digital_dhr_document('ffffffff-ffff-4fff-8fff-ffffffffffff','ffffffff-ffff-4fff-8fff-ffffffffffff','synthetic:document','TEST-1','synthetic-operator-a','11111111-1111-4111-8111-111111111111');
 if jsonb_array_length(r->'fields')<>5 then raise exception 'failed attachment retry did not recover complete state';end if;
end$$;
