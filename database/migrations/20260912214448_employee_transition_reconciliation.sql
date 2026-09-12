-- Read-only reconciliation for lost employee transition responses.
-- No state is invented: immutable receipt, or monotonic version supersession only.
begin;
create or replace function public.reconcile_employee_transition(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_id text := nullif(btrim(p_request->>'p_employee_id'), '');
  v_uuid uuid;
  v_correlation text := btrim(coalesce(p_request->>'p_correlation_id', ''));
  v_actor text := btrim(coalesce(p_request->>'p_actor', ''));
  v_expected integer := (p_request->>'p_expected_version')::integer;
  v_request jsonb;
  v_event public.admin_employee_events%rowtype;
  v_employee public.convex_employees%rowtype;
begin
  if v_id is null or v_correlation = '' or v_actor = '' or v_expected is null or v_expected < 1
     or upper(btrim(coalesce(p_request->>'p_action', ''))) not in ('UPDATE','ACTIVATE','DEACTIVATE') then
    raise exception 'invalid employee reconciliation request' using errcode='22023';
  end if;
  v_uuid := v_id::uuid;
  v_request := jsonb_build_object(
    'action', upper(btrim(p_request->>'p_action')),
    'employee_id', v_id,
    'name', btrim(p_request->>'p_name'),
    'initials', upper(btrim(p_request->>'p_initials')),
    'active', (p_request->>'p_active')::boolean,
    'expected_version', v_expected,
    'actor', v_actor,
    'reason', nullif(btrim(coalesce(p_request->>'p_reason', '')), '')
  );
  -- Same ordering/key as apply_employee_transition. An outstanding same-key SQL
  -- request finishes before this reads its event, and later requests see its result.
  perform pg_advisory_xact_lock(hashtextextended('employee-correlation:' || v_correlation, 0));
  perform pg_advisory_xact_lock(hashtextextended('employee:' || v_id, 0));
  select * into v_event from public.admin_employee_events where correlation_id = v_correlation;
  if found then
    if v_event.request_values is distinct from v_request or v_event.actor is distinct from v_actor then
      raise exception 'employee reconciliation request does not match immutable receipt' using errcode='22023';
    end if;
    return jsonb_build_object('outcome', 'committed', 'receipt', v_event.new_values);
  end if;
  select * into v_employee from public.convex_employees where id = v_uuid for update;
  if not found then return jsonb_build_object('outcome', 'pending'); end if;
  -- Directory versions only increase through the atomic transition RPC. Once
  -- superseded, no invocation of this old expected version can ever commit.
  if v_employee.version > v_expected then
    return jsonb_build_object('outcome', 'superseded', 'employee_id', v_uuid::text,
      'correlation_id', v_correlation, 'actor', v_actor,
      'expected_version', v_expected, 'current_version', v_employee.version);
  end if;
  return jsonb_build_object('outcome', 'pending');
end;
$$;
revoke all on function public.reconcile_employee_transition(jsonb) from public, anon, authenticated;
grant execute on function public.reconcile_employee_transition(jsonb) to service_role;
commit;
