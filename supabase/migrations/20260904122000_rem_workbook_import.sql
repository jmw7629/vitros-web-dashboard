-- Transactional, idempotent REM workbook import boundary.
-- Browser never receives database credentials and cannot call this RPC directly.

create table if not exists public.rem_import_runs (
  id uuid primary key default gen_random_uuid(),
  file_hash text not null unique,
  file_name text not null,
  source_sheet text not null,
  source_week integer,
  actor text not null,
  row_count integer not null check (row_count > 0 and row_count <= 250),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint rem_import_runs_file_hash_format check (file_hash ~ '^[0-9a-f]{64}$')
);

alter table public.rem_import_runs enable row level security;
revoke all on table public.rem_import_runs from public, anon, authenticated;
grant select, insert on table public.rem_import_runs to service_role;

create or replace function public.apply_rem_workbook_import(
  p_file_hash text,
  p_file_name text,
  p_source_sheet text,
  p_source_week integer,
  p_actor text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  v_serial text;
  v_type text;
  v_po numeric;
  v_clean numeric;
  v_service numeric;
  v_final numeric;
  v_release numeric;
  v_pack numeric;
  v_stage text;
  v_complete boolean;
  v_matches integer;
  v_existing_result jsonb;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_result jsonb;
begin
  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_file_hash';
  end if;
  if p_file_name is null or length(btrim(p_file_name)) = 0 or length(p_file_name) > 255 then
    raise exception 'invalid_file_name';
  end if;
  if p_source_sheet is null or length(btrim(p_source_sheet)) = 0 or length(p_source_sheet) > 160 then
    raise exception 'invalid_source_sheet';
  end if;
  if p_source_week is not null and (p_source_week < 1 or p_source_week > 53) then
    raise exception 'invalid_source_week';
  end if;
  if p_actor is null or length(btrim(p_actor)) = 0 or length(p_actor) > 200 then
    raise exception 'invalid_actor';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_must_be_array';
  end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 250 then
    raise exception 'invalid_row_count';
  end if;

  perform pg_advisory_xact_lock(hashtext('rem-import:' || p_file_hash));

  select result into v_existing_result
  from public.rem_import_runs
  where file_hash = p_file_hash;

  if found then
    return coalesce(v_existing_result, '{}'::jsonb) || jsonb_build_object('already_applied', true);
  end if;

  if exists (
    select 1
    from (
      select upper(btrim(value->>'serial_number')) as serial, count(*)
      from jsonb_array_elements(p_rows)
      group by upper(btrim(value->>'serial_number'))
      having count(*) > 1
    ) d
  ) then
    raise exception 'duplicate_serial_in_import';
  end if;

  for r in
    select value
    from jsonb_array_elements(p_rows)
    order by upper(btrim(value->>'serial_number'))
  loop
    v_serial := upper(btrim(coalesce(r->>'serial_number', '')));
    if v_serial = '' or v_serial !~ '^[A-Z0-9-]{4,32}$' then
      raise exception 'invalid_serial_number';
    end if;

    v_type := btrim(coalesce(r->>'analyzer_type', ''));
    if v_type = '' or length(v_type) > 40 then
      raise exception 'invalid_analyzer_type';
    end if;

    begin
      v_po := nullif(r->>'production_order', '')::numeric;
    exception when others then
      raise exception 'invalid_production_order';
    end;
    if v_po is not null and (v_po < 0 or v_po > 1000000) then
      raise exception 'invalid_production_order';
    end if;

    begin
      v_clean := coalesce(nullif(r->>'cleaning_pct', '')::numeric, 0);
      v_service := coalesce(nullif(r->>'service_pct', '')::numeric, 0);
      v_final := coalesce(nullif(r->>'final_line_pct', '')::numeric, 0);
      v_release := coalesce(nullif(r->>'release_testing_pct', '')::numeric, 0);
      v_pack := coalesce(nullif(r->>'packaging_pct', '')::numeric, 0);
    exception when others then
      raise exception 'invalid_progress_value';
    end;

    if v_clean < 0 or v_clean > 100
      or v_service < 0 or v_service > 100
      or v_final < 0 or v_final > 100
      or v_release < 0 or v_release > 100
      or v_pack < 0 or v_pack > 100 then
      raise exception 'progress_out_of_range';
    end if;

    v_complete := v_clean >= 100 and v_service >= 100 and v_final >= 100 and v_release >= 100 and v_pack >= 100;
    v_stage := case
      when v_clean < 100 then 'Cleaning'
      when v_service < 100 then 'Service'
      when v_final < 100 then 'Final Line'
      when v_release < 100 then 'Release Testing'
      when v_pack < 100 then 'Packaging'
      else 'QA Release'
    end;

    -- Serialize updates to the same analyzer across concurrent workbook imports.
    perform pg_advisory_xact_lock(hashtext('rem-analyzer:' || v_serial));

    select count(*) into v_matches
    from public.rem_analyzers
    where upper(btrim(serial_number)) = v_serial;

    if v_matches > 1 then
      raise exception 'ambiguous_existing_serial:%', v_serial;
    elsif v_matches = 1 then
      update public.rem_analyzers
      set serial_number = v_serial,
          analyzer_type = v_type,
          production_order = coalesce(v_po, production_order),
          cleaning_pct = v_clean,
          service_pct = v_service,
          final_line_pct = v_final,
          release_testing_pct = v_release,
          packaging_pct = v_pack,
          current_stage = v_stage,
          is_complete = v_complete
      where upper(btrim(serial_number)) = v_serial;
      v_updated := v_updated + 1;
    else
      insert into public.rem_analyzers (
        serial_number,
        analyzer_type,
        production_order,
        cleaning_pct,
        service_pct,
        final_line_pct,
        release_testing_pct,
        packaging_pct,
        current_stage,
        is_complete
      ) values (
        v_serial,
        v_type,
        coalesce(v_po, 0),
        v_clean,
        v_service,
        v_final,
        v_release,
        v_pack,
        v_stage,
        v_complete
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  v_result := jsonb_build_object(
    'file_hash', p_file_hash,
    'source_sheet', p_source_sheet,
    'source_week', p_source_week,
    'rows', jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'updated', v_updated,
    'already_applied', false
  );

  insert into public.rem_import_runs (
    file_hash, file_name, source_sheet, source_week, actor, row_count, result
  ) values (
    p_file_hash, p_file_name, p_source_sheet, p_source_week, p_actor,
    jsonb_array_length(p_rows), v_result
  );

  insert into public.audit_log (
    action,
    entity_type,
    entity_id,
    user_name,
    details,
    new_value,
    correlation_id
  ) values (
    'REM_WORKBOOK_IMPORT',
    'rem_import',
    p_file_hash,
    p_actor,
    jsonb_build_object('file_name', p_file_name, 'source_sheet', p_source_sheet, 'source_week', p_source_week),
    v_result,
    'rem-import:' || p_file_hash
  );

  return v_result;
end;
$$;

revoke all on function public.apply_rem_workbook_import(text,text,text,integer,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_rem_workbook_import(text,text,text,integer,text,jsonb) to service_role;
