-- Authoritative SAP staging review/export workflow.
-- This migration does NOT post to SAP. It only records review/export state in VITROS.

-- Production historically allowed pending/exported/failed/cancelled. Add the
-- intermediate reviewed `ready` state as a strict superset without rewriting rows.
alter table public.sap_staging drop constraint if exists sap_staging_export_status_check;
alter table public.sap_staging add constraint sap_staging_export_status_check
  check (export_status in ('pending', 'ready', 'exported', 'failed', 'cancelled'));

create table if not exists public.sap_staging_status_events (
  id uuid primary key default uuid_generate_v4(),
  sap_staging_id uuid not null references public.sap_staging(id) on delete restrict,
  correlation_id text not null,
  action text not null check (action in ('MARK_READY', 'MARK_EXPORTED')),
  from_status text not null,
  to_status text not null check (to_status in ('ready', 'exported')),
  actor text not null,
  occurred_at timestamptz not null default now(),
  unique (correlation_id, sap_staging_id)
);

alter table public.sap_staging_status_events enable row level security;
revoke all on table public.sap_staging_status_events from public, anon, authenticated;
grant all on table public.sap_staging_status_events to service_role;

create or replace function public.reject_sap_staging_status_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'sap_staging_status_events is immutable';
end;
$$;

revoke all on function public.reject_sap_staging_status_event_mutation() from public;

drop trigger if exists sap_staging_status_events_immutable on public.sap_staging_status_events;
create trigger sap_staging_status_events_immutable
before update or delete on public.sap_staging_status_events
for each row execute function public.reject_sap_staging_status_event_mutation();

create or replace function public.apply_sap_staging_status_transition(
  p_ids uuid[],
  p_target_status text,
  p_actor text,
  p_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ids uuid[];
  v_requested_count integer;
  v_existing_count integer;
  v_existing_matching integer;
  v_row_count integer;
  v_now timestamptz := clock_timestamp();
  v_action text;
begin
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    raise exception 'At least one SAP staging id is required';
  end if;

  if array_length(p_ids, 1) > 250 then
    raise exception 'SAP staging batch is too large';
  end if;

  if p_target_status not in ('ready', 'exported') then
    raise exception 'Unsupported SAP staging target status';
  end if;

  if p_actor is null or btrim(p_actor) = '' or length(p_actor) > 200 then
    raise exception 'Actor is required';
  end if;

  if p_correlation_id is null or btrim(p_correlation_id) = '' or length(p_correlation_id) > 128 then
    raise exception 'Valid correlation id is required';
  end if;

  select array_agg(x.id order by x.id), count(*)
    into v_ids, v_requested_count
  from (select distinct unnest(p_ids) as id) x;

  if v_requested_count <> array_length(p_ids, 1) then
    raise exception 'Duplicate SAP staging ids are not allowed';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sap-staging:' || p_correlation_id, 0)
  );

  select count(*)
    into v_existing_count
  from public.sap_staging_status_events
  where correlation_id = p_correlation_id;

  if v_existing_count > 0 then
    select count(*)
      into v_existing_matching
    from public.sap_staging_status_events
    where correlation_id = p_correlation_id
      and sap_staging_id = any(v_ids)
      and to_status = p_target_status;

    if v_existing_count = v_requested_count and v_existing_matching = v_requested_count then
      return jsonb_build_object(
        'success', true,
        'duplicate', true,
        'count', v_requested_count,
        'status', p_target_status,
        'correlationId', p_correlation_id
      );
    end if;

    raise exception 'Correlation id was already used for a different SAP staging transition';
  end if;

  -- Serialize all selected rows in deterministic UUID order before validating state.
  perform 1
  from public.sap_staging
  where id = any(v_ids)
  order by id
  for update;

  select count(*)
    into v_row_count
  from public.sap_staging
  where id = any(v_ids);

  if v_row_count <> v_requested_count then
    raise exception 'One or more SAP staging rows were not found';
  end if;

  if p_target_status = 'ready' then
    if exists (
      select 1
      from public.sap_staging
      where id = any(v_ids)
        and lower(coalesce(export_status, 'pending')) <> 'pending'
    ) then
      raise exception 'Only pending SAP staging rows can be marked ready';
    end if;
    v_action := 'MARK_READY';
  else
    if exists (
      select 1
      from public.sap_staging
      where id = any(v_ids)
        and lower(coalesce(export_status, 'pending')) <> 'ready'
    ) then
      raise exception 'Only ready SAP staging rows can be marked exported';
    end if;
    v_action := 'MARK_EXPORTED';
  end if;

  insert into public.sap_staging_status_events (
    sap_staging_id,
    correlation_id,
    action,
    from_status,
    to_status,
    actor,
    occurred_at
  )
  select
    s.id,
    p_correlation_id,
    v_action,
    lower(coalesce(s.export_status, 'pending')),
    p_target_status,
    p_actor,
    v_now
  from public.sap_staging s
  where s.id = any(v_ids);

  if p_target_status = 'ready' then
    update public.sap_staging
    set export_status = 'ready',
        error_message = null
    where id = any(v_ids);
  else
    update public.sap_staging
    set export_status = 'exported',
        exported_at = v_now,
        exported_by = p_actor,
        error_message = null
    where id = any(v_ids);
  end if;

  return jsonb_build_object(
    'success', true,
    'duplicate', false,
    'count', v_requested_count,
    'status', p_target_status,
    'correlationId', p_correlation_id,
    'processedAt', v_now
  );
end;
$$;

revoke all on function public.apply_sap_staging_status_transition(uuid[], text, text, text) from public, anon, authenticated;
grant execute on function public.apply_sap_staging_status_transition(uuid[], text, text, text) to service_role;
