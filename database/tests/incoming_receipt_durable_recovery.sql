-- DISPOSABLE POSTGRESQL 17 ONLY. #442 serial durable receipt contract.
\set ON_ERROR_STOP on
create or replace function public.assert_true(p_condition boolean,p_message text)
returns void language plpgsql as $$
begin
  if coalesce(p_condition,false) is not true then
    raise exception 'ASSERTION FAILED: %',p_message;
  end if;
end;
$$;

select public.assert_true(to_regclass('public.incoming_receipt_lines') is not null,'lines table installed');
select public.assert_true(to_regclass('public.incoming_receipt_attempts') is not null,'attempts table installed');
select public.assert_true(to_regclass('public.incoming_receipt_attempt_events') is not null,'events table installed');
select public.assert_true(to_regprocedure('public.reserve_incoming_manual_line(text,text)') is not null,'manual reservation signature');
select public.assert_true(to_regprocedure('public.register_incoming_receipt_review(text,text,text,integer,text,integer,uuid)') is not null,'review signature');
select public.assert_true(to_regprocedure('public.rereview_incoming_receipt_attempt(uuid,text,bigint,text,integer)') is not null,'rereview signature');

-- Normal reviewed source line -> accepted RECEIVE.
select public.register_incoming_receipt_review('actor-a','DOC-A','1',1,'abc123',2,null) as first_review \gset
select public.assert_true((:'first_review'::jsonb->>'state')='reviewed','review persists');
select public.execute_incoming_receipt_attempt(
  (:'first_review'::jsonb->>'attemptId')::uuid,'actor-a',(:'first_review'::jsonb->>'revision')::bigint
) as first_accept \gset
select public.assert_true((:'first_accept'::jsonb->>'state')='accepted','receive accepted');
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=22,'stock incremented exactly two');
select public.assert_true((select count(*) from public.inventory_operations where correlation_id=(:'first_accept'::jsonb->>'correlationId'))=1,'one inventory operation');
select public.assert_true((select count(*) from public.audit_log where correlation_id=(:'first_accept'::jsonb->>'correlationId'))=1,'one audit movement');
select public.assert_true((select count(*) from public.sap_staging where correlation_id=(:'first_accept'::jsonb->>'correlationId') and export_status='pending')=1,'one pending SAP movement');

-- Lost acknowledgement: repeat same reviewed material and execute callback must reconcile prior acceptance.
select public.register_incoming_receipt_review('actor-a','DOC-A','1',1,'ABC123',2,null) as replay_review \gset
select public.assert_true((:'replay_review'::jsonb->>'attemptId')=(:'first_accept'::jsonb->>'attemptId'),'same physical line returns original attempt');
select public.execute_incoming_receipt_attempt(
  (:'replay_review'::jsonb->>'attemptId')::uuid,'actor-a',1
) as replay_accept \gset
select public.assert_true((:'replay_accept'::jsonb->>'state')='accepted','accepted replay reconciles');
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=22,'accepted replay does not duplicate movement');

-- Unknown -> accepted via three-step transition (reviewed -> attempted -> unknown -> accepted)
select public.register_incoming_receipt_review('actor-f','DOC-F','1',1,'ABC123',1,null) as unknown_review \gset
select public.assert_true((:'unknown_review'::jsonb->>'state')='reviewed','unknown origin review persists');
select public.begin_incoming_receipt_attempt(
  (:'unknown_review'::jsonb->>'attemptId')::uuid,'actor-f',(:'unknown_review'::jsonb->>'revision')::bigint
) as attempt_begun \gset
select public.assert_true((:'attempt_begun'::jsonb->>'state')='attempted','attempt begun from reviewed');
select public.mark_incoming_receipt_attempt_unknown(
  (:'attempt_begun'::jsonb->>'attemptId')::uuid,'actor-f',(:'attempt_begun'::jsonb->>'revision')::bigint
) as attempt_marked_unknown \gset
select public.assert_true((:'attempt_marked_unknown'::jsonb->>'state')='unknown','attempt marked unknown');
-- BEFORE execution: all movement counts must be zero
select public.assert_true((select count(*) from public.inventory_operations where correlation_id=(:'attempt_marked_unknown'::jsonb->>'correlationId'))=0,'no inventory operations before unknown execution');
select public.assert_true((select count(*) from public.audit_log where correlation_id=(:'attempt_marked_unknown'::jsonb->>'correlationId'))=0,'no audit movements before unknown execution');
select public.assert_true((select count(*) from public.sap_staging where correlation_id=(:'attempt_marked_unknown'::jsonb->>'correlationId') and export_status='pending')=0,'no pending SAP before unknown execution');
-- execute from unknown
select public.execute_incoming_receipt_attempt(
  (:'attempt_marked_unknown'::jsonb->>'attemptId')::uuid,'actor-f',(:'attempt_marked_unknown'::jsonb->>'revision')::bigint
) as unknown_accept \gset
select public.assert_true((:'unknown_accept'::jsonb->>'state')='accepted','unknown->accepted');
-- AFTER execution: stock increases by exactly requested qty, one movement each
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=21,'stock incremented exactly one from unknown');
select public.assert_true((select count(*) from public.inventory_operations where correlation_id=(:'unknown_accept'::jsonb->>'correlationId'))=1,'one inventory operation from unknown');
select public.assert_true((select count(*) from public.audit_log where correlation_id=(:'unknown_accept'::jsonb->>'correlationId'))=1,'one audit movement from unknown');
select public.assert_true((select count(*) from public.sap_staging where correlation_id=(:'unknown_accept'::jsonb->>'correlationId') and export_status='pending')=1,'one pending SAP from unknown');
-- Lost acknowledgement: repeat same physical line/material and reconcile
select public.register_incoming_receipt_review('actor-f','DOC-F','1',1,'ABC123',1,null) as unknown_replay \gset
select public.assert_true((:'unknown_replay'::jsonb->>'attemptId')=(:'unknown_accept'::jsonb->>'attemptId'),'same physical line returns original attempt');
select public.execute_incoming_receipt_attempt(
  (:'unknown_replay'::jsonb->>'attemptId')::uuid,'actor-f',(:'unknown_accept'::jsonb->>'revision')::bigint
) as unknown_replay_accept \gset
select public.assert_true((:'unknown_replay_accept'::jsonb->>'state')='accepted','unknown replay reconciles');
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=21,'unknown replay does not duplicate movement');
-- Stale revision rejection: pre-unknown revision must fail with SQLSTATE 40001
do $$ declare caught boolean:=false; stale bigint; begin select a.revision-1 into stale from public.incoming_receipt_attempts a join public.incoming_receipt_lines l on l.id=a.line_id where l.document_ref_normalized='DOC-F' and a.state='unknown'; begin perform public.execute_incoming_receipt_attempt((select a.id from public.incoming_receipt_attempts a join public.incoming_receipt_lines l on l.id=a.line_id where l.document_ref_normalized='DOC-F' and a.state='unknown'),'actor-f',stale); exception when sqlstate '40001' then if sqlerrm='Receipt attempt revision is stale' then caught:=true; else raise; end if; if not caught then raise exception 'EXPECTED STALE REVISION DENIAL WAS NOT RAISED'; end if; end $$;
-- Changed material on unknown path -> conflict/no movement (preserve existing behavior)
select public.register_incoming_receipt_review('actor-h','DOC-H','1',1,'XYZ999',1,null) as changed_material \gset
select public.begin_incoming_receipt_attempt(
  (:'changed_material'::jsonb->>'attemptId')::uuid,'actor-h',(:'changed_material'::jsonb->>'revision')::bigint
) as changed_begun \gset
select public.mark_incoming_receipt_attempt_unknown(
  (:'changed_begun'::jsonb->>'attemptId')::uuid,'actor-h',(:'changed_begun'::jsonb->>'revision')::bigint
) as changed_unknown \gset
select public.execute_incoming_receipt_attempt(
  (:'changed_unknown'::jsonb->>'attemptId')::uuid,'actor-h',(:'changed_unknown'::jsonb->>'revision')::bigint
) as changed_accept \gset
select public.assert_true((select count(*) from public.inventory_operations where correlation_id=(:'changed_accept'::jsonb->>'correlationId'))=0,'changed material on unknown path produces no movement');
select public.assert_true((select count(*) from public.audit_log where correlation_id=(:'changed_accept'::jsonb->>'correlationId'))=0,'changed material on unknown path produces no audit movement');

-- Cross-actor access to a persisted physical line is denied with the expected error only.
do $$
declare caught boolean:=false;
begin
  begin
    perform public.register_incoming_receipt_review('actor-b','DOC-A','1',1,'ABC123',2,null);
  exception when sqlstate '42501' then
    if sqlerrm='Receipt line is already reserved by another operator' then caught:=true; else raise; end if;
  end;
  if not caught then raise exception 'EXPECTED CROSS ACTOR DENIAL WAS NOT RAISED'; end if;
end $$;

-- Conflict -> verified no-movement abandon -> same-material re-review.
select public.register_incoming_receipt_review('actor-c','DOC-C','2',1,'ABC123',1,null) as conflict_review \gset
select public.begin_incoming_receipt_attempt(
  (:'conflict_review'::jsonb->>'attemptId')::uuid,'actor-c',(:'conflict_review'::jsonb->>'revision')::bigint
) as conflict_begun \gset
select public.mark_incoming_receipt_attempt_unknown(
  (:'conflict_begun'::jsonb->>'attemptId')::uuid,'actor-c',(:'conflict_begun'::jsonb->>'revision')::bigint
) as conflict_unknown \gset
select public.list_incoming_receipt_recovery('actor-c') as conflict_recovery \gset
select public.assert_true((:'conflict_recovery'::jsonb->0->>'documentRef')='DOC-C','recovery returns persisted document identity');
select public.assert_true((:'conflict_recovery'::jsonb->0->>'sourcePage')='2','recovery returns persisted source page');
select public.assert_true((:'conflict_recovery'::jsonb->0->>'sourceLineNo')::int=1,'recovery returns persisted physical line');
do $$
declare caught boolean:=false;
begin
  begin perform public.register_incoming_receipt_review('actor-c','DOC-C-RENAMED','2',1,'ABC123',1,null);
  exception when sqlstate '55000' then if sqlerrm='A prior receipt requires reconciliation before another document can start' then caught:=true; else raise; end if; end;
  if not caught then raise exception 'EXPECTED DOCUMENT REKEY DENIAL WAS NOT RAISED'; end if;
end $$;
select public.register_incoming_receipt_review('actor-c','DOC-C','2',1,'ABC123',2,null) as conflict_state \gset
select public.assert_true((:'conflict_state'::jsonb->>'state')='conflict','changed unresolved request becomes conflict');
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=22,'conflict has no movement');

do $$
declare caught boolean:=false; aid uuid; stale bigint;
begin
  select a.id,a.revision-1 into aid,stale from public.incoming_receipt_attempts a join public.incoming_receipt_lines l on l.id=a.line_id where l.document_ref_normalized='DOC-C' and a.state='conflict';
  begin perform public.abandon_incoming_receipt_attempt(aid,'actor-c',stale,'verified no movement');
  exception when sqlstate '40001' then if sqlerrm='Receipt attempt revision is stale' then caught:=true; else raise; end if; end;
  if not caught then raise exception 'EXPECTED STALE ABANDON DENIAL WAS NOT RAISED'; end if;
end $$;

select public.abandon_incoming_receipt_attempt(
  (:'conflict_state'::jsonb->>'attemptId')::uuid,'actor-c',(:'conflict_state'::jsonb->>'revision')::bigint,'verified no movement'
) as abandoned \gset
select public.assert_true((:'abandoned'::jsonb->>'state')='abandoned','conflict can be abandoned after no movement');

do $$
declare caught boolean:=false; aid uuid; stale bigint;
begin
  select a.id,a.revision-1 into aid,stale from public.incoming_receipt_attempts a join public.incoming_receipt_lines l on l.id=a.line_id where l.document_ref_normalized='DOC-C' and a.state='abandoned';
  begin perform public.rereview_incoming_receipt_attempt(aid,'actor-c',stale,null,null);
  exception when sqlstate '40001' then if sqlerrm='Receipt attempt revision is stale' then caught:=true; else raise; end if; end;
  if not caught then raise exception 'EXPECTED STALE REREVIEW DENIAL WAS NOT RAISED'; end if;
end $$;

select public.rereview_incoming_receipt_attempt(
  (:'abandoned'::jsonb->>'attemptId')::uuid,'actor-c',(:'abandoned'::jsonb->>'revision')::bigint,null,null
) as same_material \gset
select public.assert_true((:'same_material'::jsonb->>'generation')::int=2,'same-line rereview creates next generation');
select public.execute_incoming_receipt_attempt(
  (:'same_material'::jsonb->>'attemptId')::uuid,'actor-c',(:'same_material'::jsonb->>'revision')::bigint
) as same_material_accept \gset
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=23,'same-material rereview executes once');
-- Corrected-material re-review preserves the physical line but creates a new immutable generation.
select public.register_incoming_receipt_review('actor-d','DOC-D','3',1,'ABC123',1,null) as corrected_base \gset
select public.register_incoming_receipt_review('actor-d','DOC-D','3',1,'XYZ999',2,null) as corrected_conflict \gset
select public.abandon_incoming_receipt_attempt(
  (:'corrected_conflict'::jsonb->>'attemptId')::uuid,'actor-d',(:'corrected_conflict'::jsonb->>'revision')::bigint,'verified no movement'
) as corrected_abandoned \gset
select public.rereview_incoming_receipt_attempt(
  (:'corrected_abandoned'::jsonb->>'attemptId')::uuid,'actor-d',(:'corrected_abandoned'::jsonb->>'revision')::bigint,'XYZ999',2
) as corrected_review \gset
select public.assert_true((:'corrected_review'::jsonb->>'partNumber')='XYZ999','corrected material persists in new generation');
select public.execute_incoming_receipt_attempt(
  (:'corrected_review'::jsonb->>'attemptId')::uuid,'actor-d',(:'corrected_review'::jsonb->>'revision')::bigint
) as corrected_accept \gset
select public.assert_true((select qty_on_hand from public.stock where part_number='XYZ999')=12,'corrected-material rereview executes once');

-- Manual lines require a server allocation and receive a stable persisted line id.
select public.reserve_incoming_manual_line('actor-m','DOC-M') as manual_line \gset
select public.register_incoming_receipt_review(
  'actor-m','DOC-M','MANUAL',(:'manual_line'::jsonb->>'sourceLineNo')::int,'ABC123',1,
  (:'manual_line'::jsonb->>'lineId')::uuid
) as manual_review \gset
select public.assert_true((:'manual_review'::jsonb->>'lineId')=(:'manual_line'::jsonb->>'lineId'),'manual review uses reserved physical identity');

do $$
declare caught boolean:=false;
begin
  begin perform public.register_incoming_receipt_review('actor-x','DOC-X','MANUAL',1,'ABC123',1,null);
  exception when sqlstate '22023' then if sqlerrm='Manual receipt line requires server reservation' then caught:=true; else raise; end if; end;
  if not caught then raise exception 'EXPECTED MANUAL RESERVATION DENIAL WAS NOT RAISED'; end if;
end $$;
-- Any inventory-operation evidence makes no-movement abandonment fail closed.
select public.register_incoming_receipt_review('actor-e','DOC-E','4',1,'ABC123',1,null) as evidence_review \gset
insert into public.inventory_operations(correlation_id,part_number,mode,requested_qty,requested_batch_id,requested_analyzer_serial)
values((:'evidence_review'::jsonb->>'correlationId'),'ABC123','RECEIVE',1,'DOC-E',null);
do $$
declare caught boolean:=false; aid uuid; rev bigint;
begin
  select a.id,a.revision into aid,rev
  from public.incoming_receipt_attempts a join public.incoming_receipt_lines l on l.id=a.line_id
  where l.document_ref_normalized='DOC-E' and a.state='reviewed';
  begin perform public.abandon_incoming_receipt_attempt(aid,'actor-e',rev,'verified no movement');
  exception when sqlstate '55000' then if sqlerrm='Receipt attempt has movement evidence and cannot be abandoned' then caught:=true; else raise; end if; end;
  if not caught then raise exception 'EXPECTED MOVEMENT EVIDENCE DENIAL WAS NOT RAISED'; end if;
end $$;

-- Accepted attempts also cannot be abandoned.
do $$
declare caught boolean:=false; aid uuid; rev bigint;
begin
  select id,revision into aid,rev from public.incoming_receipt_attempts where actor='actor-a' and state='accepted' limit 1;
  begin perform public.abandon_incoming_receipt_attempt(aid,'actor-a',rev,'not allowed');
  exception when sqlstate '55000' then if sqlerrm='Accepted receipt cannot be abandoned' then caught:=true; else raise; end if; end;
  if not caught then raise exception 'EXPECTED ACCEPTED ABANDON DENIAL WAS NOT RAISED'; end if;
end $$;

-- Immutable event and parent-attempt lineage cannot be erased.
do $$
declare caught_event boolean:=false; caught_attempt boolean:=false; eid uuid; aid uuid;
begin
  select e.id,e.attempt_id into eid,aid from public.incoming_receipt_attempt_events e order by e.created_at,e.id limit 1;
  begin delete from public.incoming_receipt_attempt_events where id=eid;
  exception when sqlstate '55000' then if sqlerrm='Incoming receipt event history is immutable' then caught_event:=true; else raise; end if; end;
  begin delete from public.incoming_receipt_attempts where id=aid;
  exception when sqlstate '55000' then if sqlerrm='Incoming receipt attempts are immutable history' then caught_attempt:=true; else raise; end if; end;
  if not caught_event then raise exception 'EXPECTED EVENT IMMUTABILITY DENIAL WAS NOT RAISED'; end if;
  if not caught_attempt then raise exception 'EXPECTED ATTEMPT IMMUTABILITY DENIAL WAS NOT RAISED'; end if;
end $$;
-- Direct browser roles cannot execute the durable receipt authority.
select public.assert_true(not has_table_privilege('anon','public.incoming_receipt_attempts','select'),'anon cannot read attempts');
select public.assert_true(not has_table_privilege('authenticated','public.incoming_receipt_attempts','select'),'authenticated cannot read attempts');
select public.assert_true(has_function_privilege('service_role','public.execute_incoming_receipt_attempt(uuid,text,bigint)','execute'),'service role can execute durable receipt RPC');
select public.assert_true(not has_function_privilege('authenticated','public.execute_incoming_receipt_attempt(uuid,text,bigint)','execute'),'authenticated cannot execute durable receipt RPC');
select public.assert_true(not has_function_privilege('anon','public.reserve_incoming_manual_line(text,text)','execute'),'anon cannot reserve manual lines');

-- Acknowledgement is durable metadata only and never moves stock again.
select public.acknowledge_incoming_receipt_attempt(
  (:'first_accept'::jsonb->>'attemptId')::uuid,'actor-a'
) as first_ack \gset
select public.assert_true((:'first_ack'::jsonb->>'acknowledgedAt') is not null,'accepted acknowledgement persists');
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=23,'acknowledgement makes no movement');
select public.assert_true((select count(*) from public.inventory_operations where correlation_id like 'incoming:%' and result is not null)=3,'exactly three accepted movements exist');

select 'INCOMING_RECEIPT_DURABLE_RECOVERY_SERIAL=PASS' as result;
