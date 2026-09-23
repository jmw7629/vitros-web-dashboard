-- DISPOSABLE SYNTHETIC DATABASE ONLY. Exercises literal persisted Incoming Stock attempt RPCs.
-- Requires dhr_document_bootstrap.sql, atomic inventory migrations, then the receipt recovery migration.
\set ON_ERROR_STOP on

create or replace function public.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if coalesce(p_condition,false) is not true then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

-- First reviewed physical line is persisted before RECEIVE.
select public.register_incoming_receipt_review(
  'fixture-actor','FIXTURE-DOC','1',1,'ABC123',2,
  'incoming:FIXTURE-DOC|1|1','FIXTURE-DOC'
) as reviewed \gset
select public.assert_true((:'reviewed'::jsonb->>'state')='reviewed','reviewed state persists');
select public.assert_true((:'reviewed'::jsonb->>'correlationId')='incoming:FIXTURE-DOC|1|1','correlation identity persists');
-- Execute through the existing atomic inventory transition in the same transaction.
select public.execute_incoming_receipt_attempt(
  (:'reviewed'::jsonb->>'attemptId')::uuid,
  'fixture-actor',
  (:'reviewed'::jsonb->>'revision')::bigint
) as accepted \gset
select public.assert_true((:'accepted'::jsonb->>'state')='accepted','accepted state persists');
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=22,'stock moves exactly once');
select public.assert_true((select count(*) from public.audit_log where correlation_id='incoming:FIXTURE-DOC|1|1')=1,'one audit row');
select public.assert_true((select count(*) from public.sap_staging where correlation_id='incoming:FIXTURE-DOC|1|1' and export_status='pending')=1,'one pending SAP row');

-- Lost acknowledgement/reload: the accepted attempt remains recoverable, and replay does not move stock twice.
select public.list_incoming_receipt_recovery('fixture-actor') as recovery \gset
select public.assert_true(jsonb_array_length(:'recovery'::jsonb)=1,'accepted receipt remains recoverable until acknowledged');
select public.register_incoming_receipt_review(
  'fixture-actor','FIXTURE-DOC','1',1,'ABC123',2,
  'incoming:FIXTURE-DOC|1|1','FIXTURE-DOC'
) as replay_review \gset
select public.assert_true((:'replay_review'::jsonb->>'state')='accepted','same physical line resolves prior acceptance');
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=22,'same request replay makes no movement');
select public.acknowledge_incoming_receipt_attempt((:'replay_review'::jsonb->>'attemptId')::uuid,'fixture-actor') as first_ack \gset
select public.assert_true((:'first_ack'::jsonb->>'acknowledgedAt') is not null,'first accepted receipt acknowledgement persists');
-- Changed material on an accepted physical identity must fail closed and preserve movement/history.
do $$
begin
  begin
    perform public.register_incoming_receipt_review(
      'fixture-actor','FIXTURE-DOC','1',1,'ABC123',3,
      'incoming:FIXTURE-DOC|1|1','FIXTURE-DOC'
    );
    raise exception 'expected accepted identity conflict';
  exception when others then
    if sqlerrm = 'expected accepted identity conflict' then raise; end if;
    if position('conflicts with an accepted receipt' in sqlerrm)=0 then raise; end if;
  end;
end $$;
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=22,'changed accepted request moves no stock');

-- A genuinely unknown reviewed request keeps its original correlation and can only execute that exact material request.
select public.register_incoming_receipt_review(
  'fixture-actor','SECOND-DOC','MANUAL',1,'ABC123',1,
  'incoming:SECOND-DOC|MANUAL|1','SECOND-DOC'
) as second_review \gset
select public.mark_incoming_receipt_attempt_unknown((:'second_review'::jsonb->>'attemptId')::uuid,'fixture-actor') as unknown \gset
select public.assert_true((:'unknown'::jsonb->>'state')='unknown','unknown state persists');
-- Different receipt reference is blocked while the prior attempt is unresolved; no silent re-key.
do $$
begin
  begin
    perform public.register_incoming_receipt_review(
      'fixture-actor','THIRD-DOC','MANUAL',1,'ABC123',1,
      'incoming:THIRD-DOC|MANUAL|1','THIRD-DOC'
    );
    raise exception 'expected unresolved receipt blocker';
  exception when others then
    if sqlerrm = 'expected unresolved receipt blocker' then raise; end if;
    if position('requires reconciliation' in sqlerrm)=0 then raise; end if;
  end;
end $$;

select public.execute_incoming_receipt_attempt(
  (:'unknown'::jsonb->>'attemptId')::uuid,
  'fixture-actor',
  (:'unknown'::jsonb->>'revision')::bigint
) as recovered_accept \gset
select public.assert_true((:'recovered_accept'::jsonb->>'state')='accepted','unknown exact retry resolves accepted');
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=23,'unknown exact retry moves stock once');
-- Acknowledgement removes an accepted result from active recovery without changing inventory history.
select public.acknowledge_incoming_receipt_attempt((:'recovered_accept'::jsonb->>'attemptId')::uuid,'fixture-actor') as acknowledged \gset
select public.assert_true((:'acknowledged'::jsonb->>'acknowledgedAt') is not null,'acknowledgement persists');
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=23,'acknowledgement moves no stock');
select public.assert_true((select count(*) from public.inventory_operations where correlation_id like 'incoming:%')=2,'exactly two inventory operations exist');
select public.assert_true((select count(*) from public.audit_log where correlation_id like 'incoming:%')=2,'exactly two immutable audit movements exist');
select public.assert_true((select count(*) from public.sap_staging where correlation_id like 'incoming:%' and export_status='pending')=2,'exactly two pending SAP rows exist');


-- Changed material on an unresolved physical identity becomes an explicit conflict without stock movement.
select public.register_incoming_receipt_review(
  'conflict-actor','CONFLICT-DOC','1',1,'ABC123',1,
  'incoming:CONFLICT-DOC|1|1','CONFLICT-DOC'
) as conflict_review \gset
select public.mark_incoming_receipt_attempt_unknown((:'conflict_review'::jsonb->>'attemptId')::uuid,'conflict-actor') as conflict_unknown \gset
select public.register_incoming_receipt_review(
  'conflict-actor','CONFLICT-DOC','1',1,'ABC123',2,
  'incoming:CONFLICT-DOC|1|1','CONFLICT-DOC'
) as material_conflict \gset
select public.assert_true((:'material_conflict'::jsonb->>'state')='conflict','changed unresolved material becomes explicit conflict');
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=23,'material conflict moves no stock');
select public.assert_true((select count(*) from public.inventory_operations where correlation_id='incoming:CONFLICT-DOC|1|1')=0,'material conflict creates no inventory operation');
select public.assert_true((select count(*) from public.incoming_receipt_attempt_events where attempt_id=(:'material_conflict'::jsonb->>'attemptId')::uuid and event_type='material_conflict')=1,'material conflict is immutably recorded');

-- A conflict with no accepted/possibly accepted movement has an audited operator resolution path.
select public.resolve_incoming_receipt_attempt(
  (:'material_conflict'::jsonb->>'attemptId')::uuid,
  'conflict-actor',
  (:'material_conflict'::jsonb->>'revision')::bigint
) as resolved_conflict \gset
select public.assert_true((:'resolved_conflict'::jsonb->>'state')='abandoned','safe material conflict can be abandoned deliberately');
select public.assert_true((select count(*) from public.incoming_receipt_attempt_events where attempt_id=(:'resolved_conflict'::jsonb->>'attemptId')::uuid and event_type='abandoned')=1,'conflict resolution is immutably audited');
select public.assert_true((select count(*) from public.inventory_operations where correlation_id='incoming:CONFLICT-DOC|1|1')=0,'conflict resolution creates no inventory operation');
select public.register_incoming_receipt_review(
  'conflict-actor','CONFLICT-NEXT','1',1,'ABC123',1,
  'incoming:CONFLICT-NEXT|1|1','CONFLICT-NEXT'
) as after_resolution \gset
select public.assert_true((:'after_resolution'::jsonb->>'state')='reviewed','actor can begin a new receipt after safe resolution');

-- Accepted movement can never be discarded merely to unblock a new receipt.
do $$
declare v_attempt public.incoming_receipt_attempts%rowtype;
begin
  select * into v_attempt from public.incoming_receipt_attempts where correlation_id='incoming:FIXTURE-DOC|1|1';
  begin
    perform public.resolve_incoming_receipt_attempt(v_attempt.id,'fixture-actor',v_attempt.revision);
    raise exception 'expected accepted resolution rejection';
  exception when others then
    if sqlerrm = 'expected accepted resolution rejection' then raise; end if;
    if position('cannot be abandoned after execution may have started' in sqlerrm)=0 then raise; end if;
  end;
end $$;

-- Even a reviewed row is not discardable after a durable inventory operation record exists.
select public.register_incoming_receipt_review(
  'possible-actor','POSSIBLE-DOC','1',1,'ABC123',1,
  'incoming:POSSIBLE-DOC|1|1','POSSIBLE-DOC'
) as possible_review \gset
insert into public.inventory_operations(
  correlation_id,part_number,mode,requested_qty,requested_batch_id,requested_analyzer_serial
) values ('incoming:POSSIBLE-DOC|1|1','ABC123','RECEIVE',1,'POSSIBLE-DOC',null);
do $$
declare v_attempt public.incoming_receipt_attempts%rowtype;
begin
  select * into v_attempt from public.incoming_receipt_attempts where correlation_id='incoming:POSSIBLE-DOC|1|1';
  begin
    perform public.resolve_incoming_receipt_attempt(v_attempt.id,'possible-actor',v_attempt.revision);
    raise exception 'expected possible-movement resolution rejection';
  exception when others then
    if sqlerrm = 'expected possible-movement resolution rejection' then raise; end if;
    if position('possibly accepted inventory movement' in sqlerrm)=0 then raise; end if;
  end;
end $$;

-- Manual line identity is persisted by the reservation transaction before the client can review it.
select public.reserve_incoming_manual_receipt_review('manual-actor','MANUAL-DOC','ABC123',1) as manual_one \gset
select public.reserve_incoming_manual_receipt_review('manual-actor','MANUAL-DOC','ABC123',1) as manual_two \gset
select public.assert_true((:'manual_one'::jsonb->>'sourceLineNo')::integer=1,'first manual reservation is physical line 1');
select public.assert_true((:'manual_two'::jsonb->>'sourceLineNo')::integer=2,'second manual reservation is a distinct physical line');
select public.assert_true((:'manual_one'::jsonb->>'correlationId') <> (:'manual_two'::jsonb->>'correlationId'),'manual reservations have distinct correlations');
select public.assert_true((select count(*) from public.incoming_receipt_attempts where actor='manual-actor' and document_ref_normalized='MANUAL-DOC' and source_page_normalized='MANUAL')=2,'manual identities are persisted before RECEIVE');
select public.assert_true((select count(*) from public.inventory_operations where correlation_id in (:'manual_one'::jsonb->>'correlationId',:'manual_two'::jsonb->>'correlationId'))=0,'manual reservation alone moves no inventory');

-- Deliberately abandoning an unused reservation does not allow its physical identity to be reused.
select public.resolve_incoming_receipt_attempt(
  (:'manual_one'::jsonb->>'attemptId')::uuid,'manual-actor',(:'manual_one'::jsonb->>'revision')::bigint
) as manual_abandoned \gset
select public.assert_true((:'manual_abandoned'::jsonb->>'state')='abandoned','unused manual reservation can be deliberately abandoned');
select public.reserve_incoming_manual_receipt_review('manual-actor','MANUAL-DOC','ABC123',1) as manual_three \gset
select public.assert_true((:'manual_three'::jsonb->>'sourceLineNo')::integer=3,'abandoned manual physical identity is never silently reused');

-- Another actor cannot reserve or resolve this actor's open manual receipt.
do $$
begin
  begin
    perform public.reserve_incoming_manual_receipt_review('manual-other','MANUAL-DOC','ABC123',1);
    raise exception 'expected cross-actor manual reservation rejection';
  exception when others then
    if sqlerrm = 'expected cross-actor manual reservation rejection' then raise; end if;
    if position('already reserved by another operator' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform public.resolve_incoming_receipt_attempt(
      (select id from public.incoming_receipt_attempts where correlation_id='incoming:MANUAL-DOC|MANUAL|2'),
      'manual-other',
      (select revision from public.incoming_receipt_attempts where correlation_id='incoming:MANUAL-DOC|MANUAL|2')
    );
    raise exception 'expected cross-actor resolution rejection';
  exception when others then
    if sqlerrm = 'expected cross-actor resolution rejection' then raise; end if;
    if position('not available' in sqlerrm)=0 then raise; end if;
  end;
end $$;

-- A second operator cannot reserve or recover another actor's persisted physical line.
select public.register_incoming_receipt_review(
  'owner-actor','SHARED-DOC','1',1,'ABC123',1,
  'incoming:SHARED-DOC|1|1','SHARED-DOC'
) as owner_review \gset
do $$
begin
  begin
    perform public.register_incoming_receipt_review(
      'other-actor','SHARED-DOC','1',1,'ABC123',1,
      'incoming:SHARED-DOC|1|1','SHARED-DOC'
    );
    raise exception 'expected cross-actor reservation rejection';
  exception when others then
    if sqlerrm = 'expected cross-actor reservation rejection' then raise; end if;
    if position('already reserved' in sqlerrm)=0 then raise; end if;
  end;
end $$;
select public.list_incoming_receipt_recovery('other-actor') as other_recovery \gset
select public.assert_true(jsonb_array_length(:'other_recovery'::jsonb)=0,'another actor cannot recover the reserved line');
select public.assert_true((select qty_on_hand from public.stock where part_number='ABC123')=23,'cross-actor collision moves no stock');

-- Browser roles have no direct table/RPC authority.
select public.assert_true(not has_table_privilege('anon','public.incoming_receipt_attempts','select'),'anon cannot read attempts');
select public.assert_true(not has_table_privilege('authenticated','public.incoming_receipt_attempts','select'),'authenticated cannot read attempts');
select public.assert_true(has_function_privilege('service_role','public.execute_incoming_receipt_attempt(uuid,text,bigint)','execute'),'service role can execute receipt RPC');
select public.assert_true(not has_function_privilege('authenticated','public.execute_incoming_receipt_attempt(uuid,text,bigint)','execute'),'authenticated cannot execute receipt RPC');
select public.assert_true(has_function_privilege('service_role','public.resolve_incoming_receipt_attempt(uuid,text,bigint)','execute'),'service role can resolve safe receipt conflict');
select public.assert_true(not has_function_privilege('authenticated','public.resolve_incoming_receipt_attempt(uuid,text,bigint)','execute'),'authenticated cannot resolve receipt conflict directly');
select public.assert_true(has_function_privilege('service_role','public.reserve_incoming_manual_receipt_review(text,text,text,integer)','execute'),'service role can atomically reserve manual receipt identity');
select public.assert_true(not has_function_privilege('authenticated','public.reserve_incoming_manual_receipt_review(text,text,text,integer)','execute'),'authenticated cannot reserve manual receipt identity directly');

select 'INCOMING_RECEIPT_ATTEMPT_DATABASE=PASS' as result;
