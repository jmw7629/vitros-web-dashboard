-- Authoritative REM workbook parity import.
-- Additive schema metadata only; no business rows are deleted.

alter table public.rem_tracker_weekly add column if not exists source_key text;
alter table public.rem_tracker_weekly add column if not exists plan_year integer;
alter table public.rem_tracker_weekly add column if not exists product text;
alter table public.rem_tracker_weekly add column if not exists week_number integer;
alter table public.rem_tracker_weekly add column if not exists quarter text;
alter table public.rem_tracker_weekly add column if not exists week_start text;
create unique index if not exists rem_tracker_weekly_source_key_uidx
  on public.rem_tracker_weekly(source_key) where source_key is not null;

alter table public.rem_build_plan add column if not exists source_key text;
alter table public.rem_build_plan add column if not exists plan_year integer;
alter table public.rem_build_plan add column if not exists week_number integer;
alter table public.rem_build_plan add column if not exists quarter text;
alter table public.rem_build_plan add column if not exists week_start text;
create unique index if not exists rem_build_plan_source_key_uidx
  on public.rem_build_plan(source_key) where source_key is not null;

alter table public.rem_staff add column if not exists source_key text;
alter table public.rem_staff add column if not exists plan_year integer;
alter table public.rem_staff add column if not exists wwid text;
alter table public.rem_staff add column if not exists fte numeric;
alter table public.rem_staff add column if not exists started text;
alter table public.rem_staff add column if not exists complete_after text;
alter table public.rem_staff add column if not exists training_until text;
alter table public.rem_staff add column if not exists comment text;
create unique index if not exists rem_staff_source_key_uidx
  on public.rem_staff(source_key) where source_key is not null;

alter table public.rem_weekly_notes add column if not exists source_key text;
alter table public.rem_weekly_notes add column if not exists plan_year integer;
create unique index if not exists rem_weekly_notes_source_key_uidx
  on public.rem_weekly_notes(source_key) where source_key is not null;

alter table public.rem_targets add column if not exists source_key text;
create unique index if not exists rem_targets_source_key_uidx
  on public.rem_targets(source_key) where source_key is not null;

create table if not exists public.rem_authoritative_import_runs (
  id uuid primary key default gen_random_uuid(),
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  schema_version integer not null default 2 check (schema_version = 2),
  file_name text not null,
  plan_year integer not null check (plan_year between 2020 and 2100),
  source_sheet text not null,
  source_week integer check (source_week between 1 and 53),
  actor text not null,
  section_counts jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (file_hash, schema_version)
);

alter table public.rem_authoritative_import_runs enable row level security;
revoke all on table public.rem_authoritative_import_runs from public, anon, authenticated;
grant select on table public.rem_authoritative_import_runs to service_role;

create or replace function public.reject_rem_authoritative_import_run_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'REM authoritative import history is immutable';
end;
$$;
revoke all on function public.reject_rem_authoritative_import_run_mutation() from public, anon, authenticated;

drop trigger if exists rem_authoritative_import_runs_immutable on public.rem_authoritative_import_runs;
create trigger rem_authoritative_import_runs_immutable
before update or delete on public.rem_authoritative_import_runs
for each row execute function public.reject_rem_authoritative_import_run_mutation();

create or replace function public.apply_rem_authoritative_workbook_import(
  p_file_hash text,
  p_file_name text,
  p_plan_year integer,
  p_source_sheet text,
  p_source_week integer,
  p_actor text,
  p_analyzers jsonb,
  p_tracker_weekly jsonb,
  p_build_plan jsonb,
  p_staff jsonb,
  p_weekly_notes jsonb,
  p_targets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  v_existing_result jsonb;
  v_key text;
  v_serial text;
  v_type text;
  v_po numeric;
  v_clean numeric;
  v_service numeric;
  v_final numeric;
  v_release numeric;
  v_pack numeric;
  v_complete boolean;
  v_stage text;
  v_matches integer;
  v_week integer;
  v_quarter text;
  v_product text;
  v_week_start text;
  v_name text;
  v_wwid text;
  v_role text;
  v_fte numeric;
  v_note_array jsonb;
  v_text text;
  v_target_type text;
  v_target_value numeric;
  v_actual_value numeric;
  v_analyzer_inserted integer := 0;
  v_analyzer_updated integer := 0;
  v_tracker_inserted integer := 0;
  v_tracker_updated integer := 0;
  v_build_inserted integer := 0;
  v_build_updated integer := 0;
  v_staff_inserted integer := 0;
  v_staff_updated integer := 0;
  v_note_inserted integer := 0;
  v_note_updated integer := 0;
  v_target_inserted integer := 0;
  v_target_updated integer := 0;
  v_result jsonb;
begin
  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_file_hash'; end if;
  if p_file_name is null or length(btrim(p_file_name)) = 0 or length(p_file_name) > 255 then raise exception 'invalid_file_name'; end if;
  if p_plan_year is null or p_plan_year < 2020 or p_plan_year > 2100 then raise exception 'invalid_plan_year'; end if;
  if p_source_sheet is null or length(btrim(p_source_sheet)) = 0 or length(p_source_sheet) > 160 then raise exception 'invalid_source_sheet'; end if;
  if p_source_week is not null and (p_source_week < 1 or p_source_week > 53) then raise exception 'invalid_source_week'; end if;
  if p_actor is null or length(btrim(p_actor)) = 0 or length(p_actor) > 200 then raise exception 'invalid_actor'; end if;

  if jsonb_typeof(p_analyzers) <> 'array' or jsonb_array_length(p_analyzers) < 5 or jsonb_array_length(p_analyzers) > 250 then raise exception 'invalid_analyzer_rows'; end if;
  if jsonb_typeof(p_tracker_weekly) <> 'array' or jsonb_array_length(p_tracker_weekly) < 40 or jsonb_array_length(p_tracker_weekly) > 260 then raise exception 'invalid_tracker_rows'; end if;
  if jsonb_typeof(p_build_plan) <> 'array' or jsonb_array_length(p_build_plan) < 20 or jsonb_array_length(p_build_plan) > 53 then raise exception 'invalid_build_plan_rows'; end if;
  if jsonb_typeof(p_staff) <> 'array' or jsonb_array_length(p_staff) < 5 or jsonb_array_length(p_staff) > 250 then raise exception 'invalid_staff_rows'; end if;
  if jsonb_typeof(p_weekly_notes) <> 'array' or jsonb_array_length(p_weekly_notes) > 53 then raise exception 'invalid_note_rows'; end if;
  if jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) < 1 or jsonb_array_length(p_targets) > 32 then raise exception 'invalid_target_rows'; end if;

  perform pg_advisory_xact_lock(hashtextextended('rem-authoritative-import|' || p_file_hash || '|2', 0));
  select result into v_existing_result
  from public.rem_authoritative_import_runs
  where file_hash = p_file_hash and schema_version = 2;
  if found then
    return coalesce(v_existing_result, '{}'::jsonb) || jsonb_build_object('already_applied', true);
  end if;

  if exists (
    select 1 from (
      select upper(btrim(value->>'serialNumber')) as serial, count(*)
      from jsonb_array_elements(p_analyzers)
      group by upper(btrim(value->>'serialNumber'))
      having count(*) > 1
    ) d
  ) then raise exception 'duplicate_serial_in_import'; end if;

  for r in select value from jsonb_array_elements(p_analyzers) order by upper(btrim(value->>'serialNumber')) loop
    v_serial := upper(btrim(coalesce(r->>'serialNumber', '')));
    v_type := btrim(coalesce(r->>'analyzerType', ''));
    if v_serial !~ '^\d{8}$' then raise exception 'invalid_serial_number'; end if;
    if v_type not in ('3600','5600','7600') then raise exception 'invalid_analyzer_type'; end if;
    begin v_po := nullif(r->>'productionOrder', '')::numeric; exception when others then raise exception 'invalid_production_order'; end;
    if v_po is not null and (v_po < 0 or v_po > 1000000) then raise exception 'invalid_production_order'; end if;
    begin
      v_clean := coalesce(nullif(r->>'cleaningPct','')::numeric, 0);
      v_service := coalesce(nullif(r->>'servicePct','')::numeric, 0);
      v_final := coalesce(nullif(r->>'finalLinePct','')::numeric, 0);
      v_release := coalesce(nullif(r->>'releaseTestingPct','')::numeric, 0);
      v_pack := coalesce(nullif(r->>'packagingPct','')::numeric, 0);
    exception when others then raise exception 'invalid_progress_value'; end;
    if v_clean < 0 or v_clean > 100 or v_service < 0 or v_service > 100 or v_final < 0 or v_final > 100 or v_release < 0 or v_release > 100 or v_pack < 0 or v_pack > 100 then raise exception 'progress_out_of_range'; end if;
    v_complete := v_clean >= 100 and v_service >= 100 and v_final >= 100 and v_release >= 100 and v_pack >= 100;
    v_stage := case when v_clean < 100 then 'Cleaning' when v_service < 100 then 'Service' when v_final < 100 then 'Final Line' when v_release < 100 then 'Release Testing' when v_pack < 100 then 'Packaging' else 'QA Release' end;
    perform pg_advisory_xact_lock(hashtextextended('rem-analyzer|' || v_serial, 0));
    select count(*) into v_matches from public.rem_analyzers where upper(btrim(serial_number)) = v_serial;
    if v_matches > 1 then raise exception 'ambiguous_existing_serial:%', v_serial;
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
      v_analyzer_updated := v_analyzer_updated + 1;
    else
      insert into public.rem_analyzers(serial_number, analyzer_type, production_order, cleaning_pct, service_pct, final_line_pct, release_testing_pct, packaging_pct, current_stage, is_complete)
      values (v_serial, v_type, coalesce(v_po,0), v_clean, v_service, v_final, v_release, v_pack, v_stage, v_complete);
      v_analyzer_inserted := v_analyzer_inserted + 1;
    end if;
  end loop;

  for r in select value from jsonb_array_elements(p_tracker_weekly) order by value->>'sourceKey' loop
    v_key := btrim(coalesce(r->>'sourceKey',''));
    if v_key = '' or v_key not like p_plan_year::text || ':tracker:%' then raise exception 'invalid_tracker_source_key'; end if;
    begin v_week := (r->>'weekNumber')::integer; exception when others then raise exception 'invalid_tracker_week'; end;
    if v_week < 1 or v_week > 53 then raise exception 'invalid_tracker_week'; end if;
    v_product := btrim(coalesce(r->>'product',''));
    if v_product not in ('VITROS','VISION','LVCC_ELECTROMETER','LVCC_IR_WASH') then raise exception 'invalid_tracker_product'; end if;
    v_quarter := upper(btrim(coalesce(r->>'quarter','')));
    if v_quarter !~ '^Q[1-4]$' then raise exception 'invalid_tracker_quarter'; end if;
    v_week_start := nullif(btrim(coalesce(r->>'weekStart','')), '');
    perform pg_advisory_xact_lock(hashtextextended('rem-tracker|' || v_key, 0));
    select count(*) into v_matches from public.rem_tracker_weekly where source_key = v_key;
    if v_matches > 1 then raise exception 'ambiguous_tracker_key:%', v_key;
    elsif v_matches = 1 then
      update public.rem_tracker_weekly
      set plan_year=p_plan_year, product=v_product, week_number=v_week, quarter=v_quarter, week_start=v_week_start,
          data=coalesce(data,'{}'::jsonb) || r
      where source_key=v_key;
      v_tracker_updated := v_tracker_updated + 1;
    else
      insert into public.rem_tracker_weekly(source_key,plan_year,product,week_number,quarter,week_start,data)
      values(v_key,p_plan_year,v_product,v_week,v_quarter,v_week_start,r);
      v_tracker_inserted := v_tracker_inserted + 1;
    end if;
  end loop;

  for r in select value from jsonb_array_elements(p_build_plan) order by value->>'sourceKey' loop
    v_key := btrim(coalesce(r->>'sourceKey',''));
    if v_key = '' or v_key not like p_plan_year::text || ':build-plan:%' then raise exception 'invalid_build_plan_source_key'; end if;
    begin v_week := (r->>'weekNumber')::integer; exception when others then raise exception 'invalid_build_plan_week'; end;
    if v_week < 1 or v_week > 53 then raise exception 'invalid_build_plan_week'; end if;
    v_quarter := upper(btrim(coalesce(r->>'quarter','')));
    if v_quarter !~ '^Q[1-4]$' then raise exception 'invalid_build_plan_quarter'; end if;
    v_week_start := nullif(btrim(coalesce(r->>'weekStart','')), '');
    perform pg_advisory_xact_lock(hashtextextended('rem-build-plan|' || v_key, 0));
    select count(*) into v_matches from public.rem_build_plan where source_key=v_key;
    if v_matches > 1 then raise exception 'ambiguous_build_plan_key:%', v_key;
    elsif v_matches = 1 then
      update public.rem_build_plan
      set plan_year=p_plan_year, week_number=v_week, quarter=v_quarter, week_start=v_week_start,
          data=coalesce(data,'{}'::jsonb) || coalesce(r->'data','{}'::jsonb)
      where source_key=v_key;
      v_build_updated := v_build_updated + 1;
    else
      insert into public.rem_build_plan(source_key,plan_year,week_number,quarter,week_start,data)
      values(v_key,p_plan_year,v_week,v_quarter,v_week_start,coalesce(r->'data','{}'::jsonb));
      v_build_inserted := v_build_inserted + 1;
    end if;
  end loop;

  for r in select value from jsonb_array_elements(p_staff) order by value->>'sourceKey' loop
    v_key := btrim(coalesce(r->>'sourceKey',''));
    if v_key = '' or v_key not like p_plan_year::text || ':staff:%' then raise exception 'invalid_staff_source_key'; end if;
    v_wwid := btrim(coalesce(r->>'wwid',''));
    v_name := btrim(coalesce(r->>'name',''));
    v_role := nullif(btrim(coalesce(r->>'role','')), '');
    if v_wwid !~ '^\d{6,12}$' then raise exception 'invalid_staff_wwid'; end if;
    if v_name = '' or length(v_name) > 160 then raise exception 'invalid_staff_name'; end if;
    begin v_fte := nullif(r->>'fte','')::numeric; exception when others then raise exception 'invalid_staff_fte'; end;
    if v_fte is not null and (v_fte < 0 or v_fte > 5) then raise exception 'invalid_staff_fte'; end if;
    perform pg_advisory_xact_lock(hashtextextended('rem-staff|' || v_key, 0));
    select count(*) into v_matches from public.rem_staff where source_key=v_key;
    if v_matches > 1 then raise exception 'ambiguous_staff_key:%', v_key;
    elsif v_matches = 1 then
      update public.rem_staff
      set name=v_name, role=v_role, plan_year=p_plan_year, wwid=v_wwid, fte=v_fte,
          started=nullif(btrim(coalesce(r->>'started','')), ''),
          complete_after=nullif(btrim(coalesce(r->>'completeAfter','')), ''),
          training_until=nullif(btrim(coalesce(r->>'trainingUntil','')), ''),
          comment=nullif(btrim(coalesce(r->>'comment','')), ''),
          skills=coalesce(skills,'{}'::jsonb) || coalesce(r->'skills','{}'::jsonb),
          certifications=coalesce(certifications,'{}'::jsonb) || coalesce(r->'certifications','{}'::jsonb)
      where source_key=v_key;
      v_staff_updated := v_staff_updated + 1;
    else
      insert into public.rem_staff(source_key,plan_year,wwid,name,role,fte,started,complete_after,training_until,comment,skills,certifications)
      values(v_key,p_plan_year,v_wwid,v_name,v_role,v_fte,
        nullif(btrim(coalesce(r->>'started','')), ''),
        nullif(btrim(coalesce(r->>'completeAfter','')), ''),
        nullif(btrim(coalesce(r->>'trainingUntil','')), ''),
        nullif(btrim(coalesce(r->>'comment','')), ''),
        coalesce(r->'skills','{}'::jsonb), coalesce(r->'certifications','{}'::jsonb));
      v_staff_inserted := v_staff_inserted + 1;
    end if;
  end loop;

  for r in select value from jsonb_array_elements(p_weekly_notes) order by (value->>'weekNumber')::integer loop
    v_key := btrim(coalesce(r->>'sourceKey',''));
    if v_key = '' or v_key not like p_plan_year::text || ':notes:%' then raise exception 'invalid_note_source_key'; end if;
    begin v_week := (r->>'weekNumber')::integer; exception when others then raise exception 'invalid_note_week'; end;
    if v_week < 1 or v_week > 53 then raise exception 'invalid_note_week'; end if;
    v_quarter := upper(btrim(coalesce(r->>'quarter','')));
    if v_quarter !~ '^Q[1-4]$' then raise exception 'invalid_note_quarter'; end if;
    v_week_start := coalesce(nullif(btrim(coalesce(r->>'weekStart','')), ''), '');
    v_note_array := '[]'::jsonb;
    v_text := nullif(btrim(coalesce(r->'notes'->>'vitros','')), '');
    if v_text is not null then v_note_array := v_note_array || jsonb_build_array(jsonb_build_object('product','VITROS','content',v_text)); end if;
    v_text := nullif(btrim(coalesce(r->'notes'->>'vision','')), '');
    if v_text is not null then v_note_array := v_note_array || jsonb_build_array(jsonb_build_object('product','VISION','content',v_text)); end if;
    v_text := nullif(btrim(coalesce(r->'notes'->>'lvccElectrometer','')), '');
    if v_text is not null then v_note_array := v_note_array || jsonb_build_array(jsonb_build_object('product','LVCC Electrometer','content',v_text)); end if;
    v_text := nullif(btrim(coalesce(r->'notes'->>'lvccIrWash','')), '');
    if v_text is not null then v_note_array := v_note_array || jsonb_build_array(jsonb_build_object('product','LVCC IR Wash','content',v_text)); end if;
    if jsonb_array_length(v_note_array) = 0 then continue; end if;
    perform pg_advisory_xact_lock(hashtextextended('rem-notes|' || v_key, 0));
    select count(*) into v_matches from public.rem_weekly_notes where source_key=v_key;
    if v_matches = 0 then
      select count(*) into v_matches from public.rem_weekly_notes
      where source_key is null and week_number=v_week and quarter=v_quarter;
      if v_matches = 1 then
        update public.rem_weekly_notes
        set source_key=v_key, plan_year=p_plan_year, week_start=v_week_start, notes=v_note_array
        where source_key is null and week_number=v_week and quarter=v_quarter;
        v_note_updated := v_note_updated + 1;
        continue;
      elsif v_matches > 1 then
        raise exception 'ambiguous_legacy_note_week:%', v_week;
      end if;
    elsif v_matches > 1 then
      raise exception 'ambiguous_note_key:%', v_key;
    else
      update public.rem_weekly_notes
      set plan_year=p_plan_year, week_start=v_week_start, week_number=v_week, quarter=v_quarter, notes=v_note_array
      where source_key=v_key;
      v_note_updated := v_note_updated + 1;
      continue;
    end if;
    insert into public.rem_weekly_notes(source_key,plan_year,week_start,week_number,quarter,notes)
    values(v_key,p_plan_year,v_week_start,v_week,v_quarter,v_note_array);
    v_note_inserted := v_note_inserted + 1;
  end loop;

  for r in select value from jsonb_array_elements(p_targets) order by value->>'sourceKey' loop
    v_key := btrim(coalesce(r->>'sourceKey',''));
    if v_key = '' or v_key not like p_plan_year::text || ':target:%' then raise exception 'invalid_target_source_key'; end if;
    v_target_type := upper(btrim(coalesce(r->>'targetType','')));
    if v_target_type !~ '^[A-Z0-9_]{3,80}$' then raise exception 'invalid_target_type'; end if;
    begin
      v_target_value := (r->>'targetValue')::numeric;
      v_actual_value := (r->>'actualValue')::numeric;
    exception when others then raise exception 'invalid_target_value'; end;
    if v_target_value < 0 or v_target_value > 10000000 or v_actual_value < 0 or v_actual_value > 10000000 then raise exception 'invalid_target_value'; end if;
    perform pg_advisory_xact_lock(hashtextextended('rem-target|' || v_key, 0));
    select count(*) into v_matches from public.rem_targets where source_key=v_key;
    if v_matches = 0 then
      select count(*) into v_matches from public.rem_targets where source_key is null and year=p_plan_year and target_type=v_target_type;
      if v_matches = 1 then
        update public.rem_targets
        set source_key=v_key,target_value=v_target_value,actual_value=v_actual_value,data=coalesce(data,'{}'::jsonb)||coalesce(r->'data','{}'::jsonb)
        where source_key is null and year=p_plan_year and target_type=v_target_type;
        v_target_updated := v_target_updated + 1;
        continue;
      elsif v_matches > 1 then raise exception 'ambiguous_legacy_target:%', v_target_type; end if;
    elsif v_matches > 1 then raise exception 'ambiguous_target_key:%', v_key;
    else
      update public.rem_targets
      set year=p_plan_year,target_type=v_target_type,target_value=v_target_value,actual_value=v_actual_value,data=coalesce(data,'{}'::jsonb)||coalesce(r->'data','{}'::jsonb)
      where source_key=v_key;
      v_target_updated := v_target_updated + 1;
      continue;
    end if;
    insert into public.rem_targets(source_key,year,target_type,target_value,actual_value,data)
    values(v_key,p_plan_year,v_target_type,v_target_value,v_actual_value,coalesce(r->'data','{}'::jsonb));
    v_target_inserted := v_target_inserted + 1;
  end loop;

  v_result := jsonb_build_object(
    'schema_version',2,
    'file_hash',p_file_hash,
    'plan_year',p_plan_year,
    'source_sheet',p_source_sheet,
    'source_week',p_source_week,
    'already_applied',false,
    'analyzers',jsonb_build_object('rows',jsonb_array_length(p_analyzers),'inserted',v_analyzer_inserted,'updated',v_analyzer_updated),
    'tracker',jsonb_build_object('rows',jsonb_array_length(p_tracker_weekly),'inserted',v_tracker_inserted,'updated',v_tracker_updated),
    'build_plan',jsonb_build_object('rows',jsonb_array_length(p_build_plan),'inserted',v_build_inserted,'updated',v_build_updated),
    'staff',jsonb_build_object('rows',jsonb_array_length(p_staff),'inserted',v_staff_inserted,'updated',v_staff_updated),
    'weekly_notes',jsonb_build_object('rows',jsonb_array_length(p_weekly_notes),'inserted',v_note_inserted,'updated',v_note_updated),
    'targets',jsonb_build_object('rows',jsonb_array_length(p_targets),'inserted',v_target_inserted,'updated',v_target_updated)
  );

  insert into public.rem_authoritative_import_runs(file_hash,schema_version,file_name,plan_year,source_sheet,source_week,actor,section_counts,result)
  values(p_file_hash,2,p_file_name,p_plan_year,p_source_sheet,p_source_week,p_actor,
    jsonb_build_object('analyzers',jsonb_array_length(p_analyzers),'tracker',jsonb_array_length(p_tracker_weekly),'build_plan',jsonb_array_length(p_build_plan),'staff',jsonb_array_length(p_staff),'weekly_notes',jsonb_array_length(p_weekly_notes),'targets',jsonb_array_length(p_targets)),
    v_result);

  insert into public.audit_log(action,entity_type,entity_id,user_name,details,new_value,correlation_id)
  values('REM_AUTHORITATIVE_WORKBOOK_IMPORT','rem_authoritative_import',p_file_hash,p_actor,
    jsonb_build_object('file_name',p_file_name,'plan_year',p_plan_year,'source_sheet',p_source_sheet,'source_week',p_source_week),
    v_result,'rem-authoritative-import:' || p_file_hash);

  return v_result;
end;
$$;

revoke all on function public.apply_rem_authoritative_workbook_import(text,text,integer,text,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.apply_rem_authoritative_workbook_import(text,text,integer,text,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
