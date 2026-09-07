-- Authoritative REM operational edits for the Engineer Kiosk.
-- Browser callers never receive a Supabase credential; only the Convex service-role action may execute this RPC.

alter table public.rem_analyzers
  add column if not exists operator_notes text;

alter table public.rem_analyzers
  drop constraint if exists rem_analyzers_operator_notes_length;

alter table public.rem_analyzers
  add constraint rem_analyzers_operator_notes_length
  check (operator_notes is null or char_length(operator_notes) <= 4000);

create or replace function public.apply_rem_analyzer_operational_update(
  p_analyzer_id uuid,
  p_expected_stage text,
  p_expected_notes text,
  p_stage text,
  p_notes text,
  p_actor text,
  p_correlation_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.rem_analyzers%rowtype;
  v_audit public.audit_log%rowtype;
  v_expected_notes text := coalesce(btrim(p_expected_notes), '');
  v_notes text := nullif(btrim(p_notes), '');
  v_allowed_stages constant text[] := array[
    'Procurement', 'Cleaning', 'Service', 'Final Line', 'Packaging',
    'Release Testing', 'QA Release', 'SAP Release', 'Complete'
  ];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;

  if p_analyzer_id is null then
    raise exception 'REM analyzer id is required';
  end if;
  if coalesce(btrim(p_actor), '') = '' or char_length(p_actor) > 200 then
    raise exception 'Invalid REM actor';
  end if;
  if coalesce(btrim(p_correlation_id), '') = '' or char_length(p_correlation_id) > 180
     or p_correlation_id !~ '^[A-Za-z0-9:._-]+$' then
    raise exception 'Invalid REM correlation id';
  end if;
  if not (btrim(p_expected_stage) = any(v_allowed_stages))
     or not (btrim(p_stage) = any(v_allowed_stages)) then
    raise exception 'Invalid REM analyzer stage';
  end if;
  if char_length(coalesce(p_expected_notes, '')) > 4000 or char_length(coalesce(p_notes, '')) > 4000 then
    raise exception 'REM operator notes exceed 4000 characters';
  end if;

  -- Serialize identical retries before checking immutable audit evidence.
  perform pg_advisory_xact_lock(hashtextextended(p_correlation_id, 0));

  select * into v_audit
  from public.audit_log
  where correlation_id = p_correlation_id
    and action = 'REM_ANALYZER_OPERATIONAL_UPDATE'
    and entity_type = 'rem_analyzer'
    and entity_id = p_analyzer_id::text
  order by created_at desc
  limit 1;

  if found then
    if coalesce(v_audit.user_name, '') <> btrim(p_actor)
       or coalesce(btrim(v_audit.old_value->>'stage'), '') <> btrim(p_expected_stage)
       or coalesce(btrim(v_audit.old_value->>'notes'), '') <> v_expected_notes
       or coalesce(v_audit.new_value->>'stage', '') <> btrim(p_stage)
       or coalesce(v_audit.new_value->>'notes', '') <> coalesce(v_notes, '') then
      raise exception 'REM idempotency conflict';
    end if;
    return jsonb_build_object(
      'success', true,
      'duplicate', true,
      'analyzerId', p_analyzer_id,
      'stage', coalesce(v_audit.new_value->>'stage', ''),
      'notes', coalesce(v_audit.new_value->>'notes', ''),
      'auditId', v_audit.id
    );
  end if;

  select * into v_row
  from public.rem_analyzers
  where id = p_analyzer_id
  for update;

  if not found then
    raise exception 'REM analyzer not found';
  end if;

  if coalesce(btrim(v_row.current_stage), '') <> btrim(p_expected_stage)
     or coalesce(btrim(v_row.operator_notes), '') <> v_expected_notes then
    raise exception 'REM analyzer revision conflict';
  end if;

  update public.rem_analyzers
  set current_stage = btrim(p_stage),
      operator_notes = v_notes,
      is_complete = (btrim(p_stage) = 'Complete')
  where id = p_analyzer_id;

  insert into public.audit_log (
    action,
    entity_type,
    entity_id,
    user_name,
    details,
    old_value,
    new_value,
    correlation_id
  ) values (
    'REM_ANALYZER_OPERATIONAL_UPDATE',
    'rem_analyzer',
    p_analyzer_id::text,
    btrim(p_actor),
    jsonb_build_object('source', 'engineer_kiosk'),
    jsonb_build_object(
      'stage', coalesce(v_row.current_stage, ''),
      'notes', coalesce(v_row.operator_notes, ''),
      'isComplete', coalesce(v_row.is_complete, false)
    ),
    jsonb_build_object(
      'stage', btrim(p_stage),
      'notes', coalesce(v_notes, ''),
      'isComplete', (btrim(p_stage) = 'Complete')
    ),
    p_correlation_id
  ) returning * into v_audit;

  return jsonb_build_object(
    'success', true,
    'duplicate', false,
    'analyzerId', p_analyzer_id,
    'stage', btrim(p_stage),
    'notes', coalesce(v_notes, ''),
    'auditId', v_audit.id
  );
end;
$$;

revoke all on function public.apply_rem_analyzer_operational_update(uuid, text, text, text, text, text, text) from public;
revoke all on function public.apply_rem_analyzer_operational_update(uuid, text, text, text, text, text, text) from anon;
revoke all on function public.apply_rem_analyzer_operational_update(uuid, text, text, text, text, text, text) from authenticated;
grant execute on function public.apply_rem_analyzer_operational_update(uuid, text, text, text, text, text, text) to service_role;
