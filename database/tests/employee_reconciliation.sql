-- DISPOSABLE synthetic rollback fixtures; never production acceptance evidence.
begin;
do $$
declare
  v_created jsonb;
  v_request jsonb;
  v_proof jsonb;
  v_id text;
  v_failed boolean;
begin
  set local role service_role;
  v_created := public.apply_employee_transition('CREATE', null, 'Synthetic Recovery', 'RCV', true, null, 'recovery-create', 'synthetic-admin', null);
  v_id := v_created->>'id';
  v_request := jsonb_build_object('p_action','DEACTIVATE','p_employee_id',v_id,'p_name',null,'p_initials',null,
    'p_active',false,'p_expected_version',1,'p_correlation_id','recovery-deactivate','p_actor','synthetic-admin','p_reason',null);
  v_proof := public.reconcile_employee_transition(v_request);
  if v_proof->>'outcome' <> 'pending' then raise exception 'equal version must remain pending'; end if;
  v_proof := public.reconcile_employee_transition(v_request || '{"p_expected_version":2}'::jsonb);
  if v_proof->>'outcome' <> 'pending' then raise exception 'future version must remain pending'; end if;
  perform public.apply_employee_transition('DEACTIVATE', v_id, null, null, false, 1, 'recovery-deactivate', 'synthetic-admin', null);
  v_proof := public.reconcile_employee_transition(v_request);
  if v_proof->>'outcome' <> 'committed' or (v_proof->'receipt'->>'active')::boolean is distinct from false
     or (v_proof->'receipt'->>'version')::integer <> 2 then raise exception 'lost successful receipt not recovered'; end if;
  v_failed := false;
  begin perform public.reconcile_employee_transition(v_request || '{"p_actor":"different-admin"}'::jsonb);
  exception when sqlstate '22023' then v_failed := true; end;
  if not v_failed then raise exception 'different actor accepted'; end if;
  v_failed := false;
  begin perform public.reconcile_employee_transition(v_request || '{"p_active":true}'::jsonb);
  exception when sqlstate '22023' then v_failed := true; end;
  if not v_failed then raise exception 'changed request accepted'; end if;
  -- Another stale request has no event and can never commit at expected version 1.
  v_request := v_request || '{"p_correlation_id":"lost-stale-response"}'::jsonb;
  v_proof := public.reconcile_employee_transition(v_request);
  if v_proof->>'outcome' <> 'superseded' or (v_proof->>'expected_version')::integer <> 1
     or (v_proof->>'current_version')::integer <> 2 or v_proof->>'actor' <> 'synthetic-admin'
     or v_proof->>'correlation_id' <> 'lost-stale-response' then raise exception 'missing monotonic rejection proof'; end if;
  if exists(select 1 from public.admin_employee_events where correlation_id='lost-stale-response') then raise exception 'reconciliation invented an event'; end if;
  if (select version from public.convex_employees where id=v_id::uuid) <> 2 then raise exception 'reconciliation changed directory'; end if;
  reset role;
  if has_function_privilege('anon','public.reconcile_employee_transition(jsonb)','execute')
    or has_function_privilege('authenticated','public.reconcile_employee_transition(jsonb)','execute') then
    raise exception 'browser can reconcile';
  end if;
  raise notice 'EMPLOYEE_RECONCILIATION=PASS';
end $$;
rollback;
