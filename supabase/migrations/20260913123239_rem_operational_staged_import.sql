-- Bounded, owner-bound REM uploads. Staging is never part of visible reads.
-- Finalization wraps the existing core import in the SAME database transaction.
-- No inventory, SAP or existing REM rows are deleted or reset by this migration.

create table public.rem_operational_imports (
  id uuid primary key default gen_random_uuid(),
  file_hash text not null unique check (file_hash ~ '^[a-f0-9]{64}$'),
  plan_year integer not null check (plan_year between 2020 and 2100),
  actor text not null check (length(actor) between 1 and 200),
  expected_rows integer not null check (expected_rows between 0 and 100000),
  received_rows integer not null default 0 check (received_rows >= 0 and received_rows <= expected_rows),
  status text not null default 'staging' check (status in ('staging','applied')),
  core_fingerprint text,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index rem_operational_imports_actor_status on public.rem_operational_imports(actor,status,created_at);
create table public.rem_operational_import_batches (
  import_id uuid not null references public.rem_operational_imports(id),
  batch_index integer not null check (batch_index between 0 and 399),
  payload_hash text not null,
  row_count integer not null check (row_count between 1 and 250),
  primary key(import_id,batch_index)
);
create table public.rem_operational_staged_records (
  import_id uuid not null references public.rem_operational_imports(id),
  source_key text not null,
  record jsonb not null,
  primary key(import_id,source_key)
);
create table public.rem_operational_records (
  source_key text primary key,
  dataset text not null check (dataset in ('field_status','lvcc_reviews','install_parts','certified_parts','summary_targets')),
  plan_year integer not null check (plan_year between 2020 and 2100),
  product text not null default '',
  source_sheet text not null,
  source_row integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  last_import_id uuid not null references public.rem_operational_imports(id),
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now()
);
create index rem_operational_records_dataset_key on public.rem_operational_records(dataset,source_key);
create index rem_operational_records_dataset_product_key on public.rem_operational_records(dataset,product,source_key);
create table public.rem_operational_record_events (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.rem_operational_imports(id),
  source_key text not null references public.rem_operational_records(source_key),
  actor text not null,
  source_sheet text not null,
  source_row integer not null,
  old_value jsonb,
  new_value jsonb not null,
  created_at timestamptz not null default now(),
  unique(import_id,source_key)
);
create index rem_operational_record_events_key on public.rem_operational_record_events(source_key,created_at);

alter table public.rem_operational_imports enable row level security;
alter table public.rem_operational_import_batches enable row level security;
alter table public.rem_operational_staged_records enable row level security;
alter table public.rem_operational_records enable row level security;
alter table public.rem_operational_record_events enable row level security;
revoke all on public.rem_operational_imports, public.rem_operational_import_batches, public.rem_operational_staged_records, public.rem_operational_records, public.rem_operational_record_events from public, anon, authenticated, service_role;
grant select on public.rem_operational_imports, public.rem_operational_import_batches, public.rem_operational_staged_records, public.rem_operational_records, public.rem_operational_record_events to service_role;

create function public.reject_rem_operational_history_mutation() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'REM operational import history is immutable'; end;
$$;
create trigger rem_operational_events_immutable before update or delete on public.rem_operational_record_events for each row execute function public.reject_rem_operational_history_mutation();
create trigger rem_operational_batches_immutable before update or delete on public.rem_operational_import_batches for each row execute function public.reject_rem_operational_history_mutation();
create trigger rem_operational_staging_immutable before update or delete on public.rem_operational_staged_records for each row execute function public.reject_rem_operational_history_mutation();

create function public.guard_rem_operational_import_receipt() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status='applied' then raise exception 'REM finalized import receipt is immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger rem_operational_import_receipt_immutable before update or delete on public.rem_operational_imports for each row execute function public.guard_rem_operational_import_receipt();

create function public.rem_uri_component(p_value text) returns text
language plpgsql immutable strict set search_path = public, pg_temp as $$
declare b bytea := convert_to(p_value,'UTF8'); i integer; n integer; result text := '';
begin
  for i in 0..length(b)-1 loop
    n := get_byte(b,i);
    if n between 48 and 57 or n between 65 and 90 or n between 97 and 122 or n in (45,95,46,33,126,42,39,40,41) then result := result || chr(n);
    else result := result || '%' || upper(lpad(to_hex(n),2,'0')); end if;
  end loop;
  return result;
end;
$$;

create function public.validate_rem_operational_record(p_record jsonb,p_year integer) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
declare d jsonb; ds text; allowed text[]; required text[]; keys text[]; k text; val jsonb; n numeric; item jsonb; expected text; raw text; parsed timestamp;
begin
  if p_year is null or p_year not between 2020 and 2100 or p_record is null or jsonb_typeof(p_record) <> 'object' or octet_length(p_record::text) > 32000 then raise exception 'invalid_operational_record'; end if;
  if not p_record ?& array['dataset','sourceKey','sourceSheet','sourceRow','data'] then raise exception 'missing_operational_record_field'; end if;
  if exists(select 1 from jsonb_object_keys(p_record) x where x not in ('dataset','sourceKey','sourceSheet','sourceRow','data')) then raise exception 'unexpected_operational_record_field'; end if;
  ds := p_record->>'dataset'; d := p_record->'data';
  if d is null or jsonb_typeof(d) <> 'object' or (select count(*) from jsonb_object_keys(d)) > 40 then raise exception 'invalid_operational_data'; end if;
  if jsonb_typeof(p_record->'sourceSheet') <> 'string' or coalesce(length(btrim(p_record->>'sourceSheet')),0) not between 1 and 160 or p_record->>'sourceSheet' <> btrim(p_record->>'sourceSheet') then raise exception 'invalid_operational_sheet'; end if;
  if jsonb_typeof(p_record->'sourceRow') <> 'number' or (p_record->>'sourceRow')::numeric not between 1 and 1048576 or (p_record->>'sourceRow')::numeric <> trunc((p_record->>'sourceRow')::numeric) then raise exception 'invalid_operational_source_row'; end if;
  case ds
    when 'field_status' then
      allowed := array['product','batch','orderReference','duplicateCount','postingDate','sourcePostingDate','yearMonth','cleanliness','cabinetry','buildQuality','finalLine','release','releaseFpyPct','sourceReleaseFpy','partsAtInstallUsd','first90','status','installDate','sourceInstallDate','country','partsNotCertified','partsAlsoCertified','comment','fpyGoalPct','sourceFpyGoal','sourceNumericText'];
      required := array['product','batch']; keys := array['product','batch'];
    when 'lvcc_reviews' then
      allowed := array['partNumber','weekNumber','weekStart','sourceWeekStart','reviewIds','listedCount','recordedTotal','sourceColumnD','sourceColumnDLabel','sourceColumnE','sourceColumnELabel','totalDifference','sourceNumericText'];
      required := array['partNumber','weekNumber','weekStart','sourceWeekStart','reviewIds','listedCount']; keys := array['partNumber','weekNumber'];
    when 'install_parts' then
      allowed := array['serviceOrder','equipmentNumber','partNumber','completedAt','equipmentPartKey','yearMonth','quantity','costUsd','partCostUsd','sourceCompletedAt','sourceYearMonth','replacedInServiceKey','region','country','productFamily','problemCode','feedbackCode','description','technicianCode','technicianName','serviceMemo','resolutionMemo','serviceOrderFeedback','installFeedbackNotes','internalComments','sourceNumericText'];
      required := array['serviceOrder','equipmentNumber','partNumber','completedAt','equipmentPartKey','yearMonth','quantity','costUsd','partCostUsd']; keys := array['serviceOrder','equipmentNumber','partNumber'];
    when 'certified_parts' then
      allowed := array['serviceOrder','partLineNumber','laborLineNumber','partNumber','lineType','equipmentNumber','equipmentPartKey','yearMonth','quantity','partCostUsd','allCostUsd','sourceYearMonth','feedbackCode','description','sourceNumericText'];
      required := array['serviceOrder','partLineNumber','laborLineNumber','partNumber','lineType','equipmentNumber','equipmentPartKey','quantity','partCostUsd','allCostUsd']; keys := array['serviceOrder','partLineNumber','laborLineNumber','partNumber','lineType'];
    when 'summary_targets' then
      allowed := array['product','quarter','targetValue','annualTargetValue','trackerPlanValue','planVariance','sourceNumericText'];
      required := array['product','quarter','targetValue','annualTargetValue']; keys := array['product','quarter'];
    else raise exception 'invalid_operational_dataset';
  end case;
  foreach k in array required loop
    if not d ? k or d->k = 'null'::jsonb or (jsonb_typeof(d->k)='string' and btrim(d->>k)='') then raise exception 'missing_operational_field'; end if;
  end loop;
  for k,val in select key,value from jsonb_each(d) loop
    if not k = any(allowed) then raise exception 'unexpected_operational_field'; end if;
    if val = 'null'::jsonb or (jsonb_typeof(val)='string' and btrim(val #>> '{}')='') then continue; end if;
    if k = 'sourceNumericText' then
      if jsonb_typeof(val) <> 'object' or (select count(*) from jsonb_object_keys(val)) > 40 then raise exception 'invalid_source_numeric_text'; end if;
      if exists(select 1 from jsonb_each(val) p where not p.key = any(allowed) or jsonb_typeof(p.value) <> 'string' or length(p.value #>> '{}') > 1000) then raise exception 'invalid_source_numeric_text'; end if;
    elsif k = 'reviewIds' then
      if jsonb_typeof(val) <> 'array' or jsonb_array_length(val) > 100 then raise exception 'invalid_lvcc_review_ids'; end if;
      for item in select value from jsonb_array_elements(val) loop
        if jsonb_typeof(item) <> 'object' or (select count(*) from jsonb_object_keys(item)) <> 3 or not item ?& array['slot','value','sourceCell'] or jsonb_typeof(item->'slot') <> 'number' or (item->>'slot')::numeric not between 1 and 100 or (item->>'slot')::numeric <> trunc((item->>'slot')::numeric) or jsonb_typeof(item->'value') <> 'string' or coalesce(length(btrim(item->>'value')),0) not between 1 and 160 or coalesce(item->>'sourceCell','') !~ '^[A-Z]{1,3}[1-9][0-9]{0,6}$' then raise exception 'invalid_lvcc_review_id'; end if;
      end loop;
      if (select count(distinct value->>'slot') from jsonb_array_elements(val)) <> jsonb_array_length(val) then raise exception 'duplicate_lvcc_slot'; end if;
    elsif k = any(array['sourceColumnD','sourceColumnE','duplicateCount','finalLine','release','releaseFpyPct','partsAtInstallUsd','fpyGoalPct','weekNumber','listedCount','recordedTotal','totalDifference','quantity','costUsd','partCostUsd','allCostUsd','targetValue','annualTargetValue','trackerPlanValue','planVariance']) then
      if jsonb_typeof(val) <> 'number' then raise exception 'invalid_operational_number'; end if;
      n := (val #>> '{}')::numeric;
      if abs(n) > 1000000000 then raise exception 'operational_number_out_of_bounds'; end if;
      if k = any(array['listedCount','recordedTotal','duplicateCount','finalLine','release','sourceColumnD','sourceColumnE']) and (n < 0 or trunc(n) <> n) then raise exception 'invalid_operational_count'; end if;
      if k = any(array['targetValue','annualTargetValue']) and n < 0 then raise exception 'invalid_operational_target'; end if;
      if k = any(array['releaseFpyPct','fpyGoalPct']) and n not between 0 and 100 then raise exception 'invalid_operational_percentage'; end if;
    elsif k = any(array['sourcePostingDate','sourceInstallDate','sourceReleaseFpy','sourceFpyGoal','sourceCompletedAt','sourceYearMonth','sourceWeekStart','sourceColumnD','sourceColumnE']) then
      if jsonb_typeof(val) not in ('string','number') or length(val #>> '{}') > 1000 then raise exception 'invalid_operational_source_scalar'; end if;
      if jsonb_typeof(val) = 'number' and abs((val #>> '{}')::numeric) > 1000000000 then raise exception 'invalid_operational_source_scalar'; end if;
    elsif jsonb_typeof(val) <> 'string' or length(val #>> '{}') > 8000 then raise exception 'invalid_operational_text';
    end if;
    if k = any(array['product','batch','partNumber','serviceOrder','equipmentNumber','partLineNumber','laborLineNumber','lineType','quarter']) then
      if jsonb_typeof(val) <> 'string' or coalesce(length(btrim(val #>> '{}')),0) not between 1 and 160 or val #>> '{}' <> upper(btrim(val #>> '{}')) then raise exception 'invalid_operational_identity'; end if;
    end if;
  end loop;
  if d ? 'product' and (d->>'product' not in ('VITROS','VISION','LVCC_ELECTROMETER','LVCC_IR_WASH') or ds = 'field_status' and d->>'product' not in ('VITROS','VISION')) then raise exception 'invalid_operational_product'; end if;
  if d ? 'quarter' and d->>'quarter' !~ '^Q[1-4]$' then raise exception 'invalid_operational_quarter'; end if;
  if nullif(d->>'yearMonth','') is not null and d->>'yearMonth' !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_operational_year_month'; end if;
  foreach k in array array['postingDate','installDate','weekStart','completedAt'] loop
    raw := nullif(d->>k,''); if raw is null then continue; end if;
    if k = 'completedAt' then
      if raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$' then raise exception 'invalid_operational_timestamp'; end if;
      parsed := raw::timestamp;
      if to_char(parsed,'YYYY-MM-DD"T"HH24:MI:SS') <> raw then raise exception 'invalid_operational_timestamp'; end if;
    else
      if raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(raw::date,'YYYY-MM-DD') <> raw then raise exception 'invalid_operational_date'; end if;
    end if;
  end loop;
  if ds = 'lvcc_reviews' then
    if (d->>'weekNumber')::numeric not between 1 and 53 or trunc((d->>'weekNumber')::numeric) <> (d->>'weekNumber')::numeric or (d->>'listedCount')::integer <> jsonb_array_length(d->'reviewIds') then raise exception 'invalid_lvcc_week_or_count'; end if;
    if (d->>'weekStart')::date <> make_date(p_year,1,4)-(extract(isodow from make_date(p_year,1,4))::integer-1)+7*((d->>'weekNumber')::integer-1) then raise exception 'lvcc_iso_week_date_mismatch'; end if;
    if d ? 'totalDifference' and (not d ? 'recordedTotal' or (d->>'totalDifference')::numeric is distinct from (d->>'listedCount')::numeric-(d->>'recordedTotal')::numeric) then raise exception 'lvcc_total_difference_mismatch'; end if;
    if exists(select 1 from jsonb_array_elements(d->'reviewIds') as review(value) where regexp_replace(review.value->>'sourceCell','^[A-Z]+','')::integer <> (p_record->>'sourceRow')::integer) then raise exception 'lvcc_source_cell_row_mismatch'; end if;
  end if;
  if d ? 'planVariance' and (not d ? 'trackerPlanValue' or (d->>'planVariance')::numeric is distinct from (d->>'trackerPlanValue')::numeric-(d->>'targetValue')::numeric) then raise exception 'summary_variance_mismatch'; end if;
  if upper(btrim(coalesce(d->>'sourcePostingDate','')))='TBD' and nullif(d->>'postingDate','') is not null or upper(btrim(coalesce(d->>'sourceInstallDate','')))='TBD' and nullif(d->>'installDate','') is not null then raise exception 'operational_date_contradicts_source'; end if;
  expected := case when ds in ('install_parts','certified_parts') then 'history' else p_year::text end || ':' || ds;
  foreach k in array keys loop expected := expected || ':' || public.rem_uri_component(d->>k); end loop;
  if p_record->>'sourceKey' is distinct from expected or length(expected) > 1800 then raise exception 'operational_source_key_mismatch'; end if;
end;
$$;

create function public.merge_rem_operational_data(p_dataset text,p_existing jsonb,p_incoming jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare clean jsonb; merged jsonb; old_numeric jsonb; new_numeric jsonb; key text; value jsonb; pair text[];
begin
  select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into clean from jsonb_each(p_incoming) e where e.value <> 'null'::jsonb and not(jsonb_typeof(e.value)='string' and btrim(e.value #>> '{}')='');
  merged:=coalesce(p_existing,'{}'::jsonb)||clean;
  -- A blank review list is an omitted workbook field, not a request to erase
  -- previously recorded reviews. Nonempty incoming lists replace the old list.
  if p_dataset='lvcc_reviews' and clean->'reviewIds'='[]'::jsonb and jsonb_array_length(coalesce(p_existing->'reviewIds','[]'::jsonb))>0 then merged:=jsonb_set(merged,'{reviewIds}',p_existing->'reviewIds'); end if;
  old_numeric:=coalesce(p_existing->'sourceNumericText','{}'::jsonb);
  select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into new_numeric from jsonb_each(coalesce(clean->'sourceNumericText','{}'::jsonb)) e where btrim(e.value #>> '{}')<>'';
  for key,value in select e.key,e.value from jsonb_each(clean) e loop
    if jsonb_typeof(value)='number' and not new_numeric ? key then old_numeric:=old_numeric-key; end if;
  end loop;
  if p_existing ? 'sourceNumericText' or clean ? 'sourceNumericText' then
    if old_numeric||new_numeric='{}'::jsonb then merged:=merged-'sourceNumericText';
    else merged:=jsonb_set(merged,'{sourceNumericText}',old_numeric||new_numeric); end if;
  end if;
  foreach pair slice 1 in array array[['postingDate','sourcePostingDate'],['installDate','sourceInstallDate']] loop
    if upper(btrim(coalesce(clean->>pair[2],'')))='TBD' then merged:=merged-pair[1];
    elsif clean ? pair[1] and not clean ? pair[2] then merged:=merged-pair[2]; end if;
  end loop;
  if p_dataset='lvcc_reviews' then
    merged:=jsonb_set(merged,'{listedCount}',to_jsonb(jsonb_array_length(merged->'reviewIds')));
    if merged ? 'recordedTotal' then merged:=jsonb_set(merged,'{totalDifference}',to_jsonb((merged->>'listedCount')::numeric-(merged->>'recordedTotal')::numeric));
    else merged:=merged-'totalDifference'; end if;
  elsif p_dataset='summary_targets' then
    if merged ? 'trackerPlanValue' then merged:=jsonb_set(merged,'{planVariance}',to_jsonb((merged->>'trackerPlanValue')::numeric-(merged->>'targetValue')::numeric));
    else merged:=merged-'planVariance'; end if;
  end if;
  if merged ? 'sourceNumericText' then
    old_numeric := merged->'sourceNumericText';
    if p_dataset='lvcc_reviews' then old_numeric:=old_numeric-array['listedCount','totalDifference'];
    elsif p_dataset='summary_targets' then old_numeric:=old_numeric-'planVariance'; end if;
    if old_numeric='{}'::jsonb then merged:=merged-'sourceNumericText'; else merged:=jsonb_set(merged,'{sourceNumericText}',old_numeric); end if;
  end if;
  return merged;
end;
$$;

create function public.get_rem_operational_import_progress(p_import_id uuid,p_actor text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.rem_operational_imports;
begin
  select * into i from public.rem_operational_imports where id=p_import_id and actor=p_actor;
  if not found then raise exception 'operational_import_not_found'; end if;
  return jsonb_build_object('importId',i.id,'planYear',i.plan_year,'expectedRows',i.expected_rows,'receivedRows',i.received_rows,'status',i.status,'nextBatchIndex',(i.received_rows+249)/250);
end;
$$;

create function public.begin_rem_operational_import(p_file_hash text,p_plan_year integer,p_expected_rows integer,p_actor text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.rem_operational_imports;
begin
  if p_file_hash is null or p_file_hash !~ '^[a-f0-9]{64}$' or p_plan_year is null or p_plan_year not between 2020 and 2100 or p_expected_rows is null or p_expected_rows not between 0 and 100000 or p_actor is null or length(btrim(p_actor)) not between 1 and 200 then raise exception 'invalid_operational_import'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rem-operational-begin|'||p_actor,0));
  perform pg_advisory_xact_lock(hashtextextended('rem-operational-file|'||p_file_hash,0));
  select * into i from public.rem_operational_imports where file_hash=p_file_hash;
  if found then
    if i.actor <> p_actor or i.plan_year <> p_plan_year or i.expected_rows <> p_expected_rows then raise exception 'operational_import_identity_conflict'; end if;
    return public.get_rem_operational_import_progress(i.id,p_actor);
  end if;
  if (select count(*) from public.rem_operational_imports where actor=p_actor and status='staging' and created_at > now()-interval '24 hours') >= 5 then raise exception 'too_many_pending_rem_uploads'; end if;
  insert into public.rem_operational_imports(file_hash,plan_year,actor,expected_rows) values(p_file_hash,p_plan_year,p_actor,p_expected_rows) returning * into i;
  return public.get_rem_operational_import_progress(i.id,p_actor);
end;
$$;

create function public.stage_rem_operational_import(p_import_id uuid,p_batch_index integer,p_records jsonb,p_actor text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.rem_operational_imports; b public.rem_operational_import_batches; r jsonb; row_count integer; fingerprint text;
begin
  if p_batch_index is null or p_batch_index not between 0 and 399 or p_records is null or jsonb_typeof(p_records) <> 'array' or octet_length(p_records::text) > 1200000 then raise exception 'invalid_operational_batch'; end if;
  row_count := jsonb_array_length(p_records);
  if row_count not between 1 and 250 then raise exception 'invalid_operational_batch_size'; end if;
  select * into i from public.rem_operational_imports where id=p_import_id and actor=p_actor for update;
  if not found then raise exception 'operational_import_not_found'; end if;
  fingerprint := encode(sha256(convert_to(p_records::text,'UTF8')),'hex');
  select * into b from public.rem_operational_import_batches where import_id=p_import_id and batch_index=p_batch_index;
  if found then
    if b.payload_hash <> fingerprint or b.row_count <> row_count then raise exception 'operational_batch_retry_conflict'; end if;
    return public.get_rem_operational_import_progress(i.id,p_actor)||jsonb_build_object('duplicate',true);
  end if;
  if i.status <> 'staging' or p_batch_index*250 <> i.received_rows or row_count <> least(250,i.expected_rows-i.received_rows) then raise exception 'operational_batch_out_of_order_or_incomplete'; end if;
  if (select count(distinct value->>'sourceKey') from jsonb_array_elements(p_records)) <> row_count then raise exception 'duplicate_operational_source_key'; end if;
  for r in select value from jsonb_array_elements(p_records) loop
    perform public.validate_rem_operational_record(r,i.plan_year);
    if exists(select 1 from public.rem_operational_staged_records where import_id=i.id and source_key=r->>'sourceKey') then raise exception 'duplicate_operational_source_key'; end if;
    insert into public.rem_operational_staged_records(import_id,source_key,record) values(i.id,r->>'sourceKey',r);
  end loop;
  insert into public.rem_operational_import_batches(import_id,batch_index,payload_hash,row_count) values(i.id,p_batch_index,fingerprint,row_count);
  update public.rem_operational_imports set received_rows=received_rows+row_count where id=i.id;
  return public.get_rem_operational_import_progress(i.id,p_actor)||jsonb_build_object('duplicate',false);
end;
$$;

create function public.apply_rem_full_workbook_import(
  p_file_hash text,p_file_name text,p_plan_year integer,p_source_sheet text,p_source_week integer,p_actor text,
  p_analyzers jsonb,p_tracker_weekly jsonb,p_build_plan jsonb,p_staff jsonb,p_weekly_notes jsonb,p_targets jsonb,
  p_operational_import_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp
-- PostgREST 12.2+ hoists this RPC-specific timeout to its request transaction.
-- A full workbook exceeds the default inherited service-role timeout (8s),
-- while 55s remains below the Supabase Client API's 60s request ceiling.
set statement_timeout = '55s' as $$
declare i public.rem_operational_imports; r jsonb; existing public.rem_operational_records; clean_data jsonb; merged_data jsonb;
  fingerprint text; core_result jsonb; v_result jsonb; inserted_count integer:=0; updated_count integer:=0; unchanged_count integer:=0; had_existing boolean; counts jsonb;
begin
  -- Serialize full imports before taking core/operational row locks. An older
  -- committed import cannot interleave half its operational records with another.
  perform pg_advisory_xact_lock(hashtextextended('rem-full-workbook-finalize',0));
  select * into i from public.rem_operational_imports where id=p_operational_import_id and actor=p_actor for update;
  if not found then raise exception 'operational_import_not_found'; end if;
  if i.file_hash is distinct from p_file_hash or i.plan_year is distinct from p_plan_year then raise exception 'operational_finalize_identity_conflict'; end if;
  fingerprint := encode(sha256(convert_to(jsonb_build_object('planYear',p_plan_year,'sourceSheet',p_source_sheet,'sourceWeek',p_source_week,'analyzers',p_analyzers,'tracker',p_tracker_weekly,'buildPlan',p_build_plan,'staff',p_staff,'notes',p_weekly_notes,'targets',p_targets)::text,'UTF8')),'hex');
  if i.status='applied' then
    if i.core_fingerprint is distinct from fingerprint then raise exception 'operational_finalize_retry_conflict'; end if;
    return i.result||jsonb_build_object('already_applied',true);
  end if;
  if i.received_rows <> i.expected_rows or (select count(*) from public.rem_operational_staged_records where import_id=i.id) <> i.expected_rows then raise exception 'operational_upload_incomplete'; end if;
  -- Legacy core-only imports did not retain request fingerprints. Never claim
  -- an arbitrary supplied core payload equals that historical accepted payload.
  perform pg_advisory_xact_lock(hashtextextended('rem-authoritative-import|'||p_file_hash||'|2',0));
  if exists(select 1 from public.rem_authoritative_import_runs where file_hash=p_file_hash and schema_version=2) then raise exception 'core_only_import_requires_review'; end if;
  core_result := public.apply_rem_authoritative_workbook_import(p_file_hash,p_file_name,p_plan_year,p_source_sheet,p_source_week,p_actor,p_analyzers,p_tracker_weekly,p_build_plan,p_staff,p_weekly_notes,p_targets);
  for r in select record from public.rem_operational_staged_records where import_id=i.id order by source_key loop
    perform public.validate_rem_operational_record(r,i.plan_year);
    select * into existing from public.rem_operational_records where source_key=r->>'sourceKey' for update;
    had_existing := found;
    merged_data := public.merge_rem_operational_data(r->>'dataset',existing.data,r->'data');
    if had_existing and r->>'dataset'='lvcc_reviews' and r->'data'->'reviewIds'='[]'::jsonb and jsonb_array_length(coalesce(existing.data->'reviewIds','[]'::jsonb))>0 and (existing.source_sheet is distinct from r->>'sourceSheet' or existing.source_row is distinct from (r->>'sourceRow')::integer) then raise exception 'partial_lvcc_reviews_changed_source_requires_review'; end if;
    perform public.validate_rem_operational_record(jsonb_set(r,'{data}',merged_data),i.plan_year);
    if had_existing and existing.data = merged_data then unchanged_count := unchanged_count+1; continue; end if;
    if had_existing then
      update public.rem_operational_records set data=merged_data,source_sheet=r->>'sourceSheet',source_row=(r->>'sourceRow')::integer,last_import_id=i.id,version=version+1,updated_at=now(),product=upper(coalesce(merged_data->>'product',merged_data->>'productFamily','')) where source_key=r->>'sourceKey';
      updated_count := updated_count+1;
    else
      insert into public.rem_operational_records(source_key,dataset,plan_year,product,source_sheet,source_row,data,last_import_id) values(r->>'sourceKey',r->>'dataset',p_plan_year,upper(coalesce(merged_data->>'product',merged_data->>'productFamily','')),r->>'sourceSheet',(r->>'sourceRow')::integer,merged_data,i.id);
      inserted_count := inserted_count+1;
    end if;
    insert into public.rem_operational_record_events(import_id,source_key,actor,source_sheet,source_row,old_value,new_value) values(i.id,r->>'sourceKey',p_actor,r->>'sourceSheet',(r->>'sourceRow')::integer,case when had_existing then existing.data else null end,merged_data);
  end loop;
  select coalesce(jsonb_object_agg(dataset,n),'{}'::jsonb) into counts from (select record->>'dataset' dataset,count(*) n from public.rem_operational_staged_records where import_id=i.id group by record->>'dataset') c;
  v_result := core_result||jsonb_build_object('operational',jsonb_build_object('import_id',i.id,'rows',i.expected_rows,'inserted',inserted_count,'updated',updated_count,'unchanged',unchanged_count,'datasets',counts));
  insert into public.audit_log(action,entity_type,entity_id,user_name,details,new_value,correlation_id) values('REM_OPERATIONAL_WORKBOOK_IMPORT','rem_operational_import',i.id::text,p_actor,jsonb_build_object('file_hash',p_file_hash,'plan_year',p_plan_year,'file_name',p_file_name),v_result->'operational','rem-operational-import:'||i.id::text);
  update public.rem_operational_imports set status='applied',core_fingerprint=fingerprint,result=v_result,completed_at=now() where id=i.id;
  return v_result;
end;
$$;

create function public.list_rem_operational_records(p_dataset text,p_offset integer,p_limit integer,p_query text default '',p_product text default '',p_plan_year integer default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare rows jsonb; total integer;
begin
  if p_dataset is null or p_dataset not in ('field_status','lvcc_reviews','install_parts','certified_parts','summary_targets') or p_offset is null or p_offset not between 0 and 10000000 or p_limit is null or p_limit not between 1 and 100 or p_query is null or length(p_query)>160 or p_product is null or length(p_product)>80 or (p_plan_year is not null and p_plan_year not between 2020 and 2100) then raise exception 'invalid_operational_page'; end if;
  select count(*) into total from public.rem_operational_records r where r.dataset=p_dataset and (p_plan_year is null or r.plan_year=p_plan_year) and (p_product='' or r.product=p_product) and (p_query='' or strpos(lower(r.data::text),lower(p_query))>0);
  select coalesce(jsonb_agg(x.record order by x.source_key),'[]'::jsonb) into rows from (
    select r.source_key,jsonb_build_object('dataset',r.dataset,'sourceKey',r.source_key,'sourceSheet',r.source_sheet,'sourceRow',r.source_row,'data',r.data) record
    from public.rem_operational_records r where r.dataset=p_dataset and (p_plan_year is null or r.plan_year=p_plan_year) and (p_product='' or r.product=p_product) and (p_query='' or strpos(lower(r.data::text),lower(p_query))>0)
    order by r.source_key offset p_offset limit p_limit
  ) x;
  return jsonb_build_object('records',rows,'total',total,'offset',p_offset,'limit',p_limit,'hasMore',p_offset+jsonb_array_length(rows)<total);
end;
$$;

revoke all on function public.reject_rem_operational_history_mutation(), public.guard_rem_operational_import_receipt(), public.rem_uri_component(text), public.validate_rem_operational_record(jsonb,integer), public.merge_rem_operational_data(text,jsonb,jsonb), public.get_rem_operational_import_progress(uuid,text), public.begin_rem_operational_import(text,integer,integer,text), public.stage_rem_operational_import(uuid,integer,jsonb,text), public.apply_rem_full_workbook_import(text,text,integer,text,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid), public.list_rem_operational_records(text,integer,integer,text,text,integer) from public,anon,authenticated;
grant execute on function public.get_rem_operational_import_progress(uuid,text), public.begin_rem_operational_import(text,integer,integer,text), public.stage_rem_operational_import(uuid,integer,jsonb,text), public.apply_rem_full_workbook_import(text,text,integer,text,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid), public.list_rem_operational_records(text,integer,integer,text,text,integer) to service_role;
