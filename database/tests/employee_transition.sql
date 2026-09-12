-- Focused rollback fixture for 20260910_canonical_employee_directory — disposable tests only
-- Captures pre counts, verifies synthetic preservation, runs 17+ assertions including audit rollback, then verifies rollback leaves no residuals


begin;

-- Pre-counts (captured before modifications, persisted for post-rollback check)
do $$
declare c int;
begin
  select count(*) into c from public.convex_employees;
  perform set_config('vitros.pre_emp', c::text, false);
  select count(*) into c from public.admin_employee_events;
  perform set_config('vitros.pre_evt', c::text, false);
end $$;
commit;

begin;

-- Verify migration preserved synthetic bootstrap rows (id/timestamps and nullable fields)
do $$
declare r record;
begin
  select * into r from public.convex_employees where id='11111111-1111-1111-1111-111111111111'::uuid;
  if not found or r.name <> 'Synthetic Existing SE' or r.initials <> 'SE' or r.created_at <> '2025-01-01 00:00:00+00'::timestamptz then
    raise exception 'FAIL synthetic existing row not preserved %', r;
  end if;
  if r.version <> 1 then raise exception 'FAIL synthetic existing version not 1'; end if;
  if r.updated_at is distinct from r.created_at then raise exception 'FAIL synthetic updated_at not preserved'; end if;
  select * into r from public.convex_employees where id='22222222-2222-2222-2222-222222222222'::uuid;
  if not found or r.active is not null or r.created_at is not null then
    raise exception 'FAIL nullable row not preserved active=% created_at=%', r.active, r.created_at;
  end if;
  if r.updated_at is not null then raise exception 'FAIL nullable updated_at should stay null'; end if;
  raise notice 'PASS synthetic preservation';
end $$;

do $$
declare
  v_res jsonb;
  v_id text;
  v_first jsonb;
  v_second jsonb;
  v_evt_count integer;
  v_failed boolean;
  v_id2 text;
  v_before jsonb;
  v_after jsonb;
  v_audit_id text;
  v_after_row record;
begin
  -- 1 CREATE as service_role
  execute 'set local role service_role';
  v_res := public.apply_employee_transition('CREATE', null, 'Alice Example', 'AE', null, null, 'test-create-1', 'test-actor', 'create reason');
  if not (v_res ? 'id' and v_res ? 'name' and v_res ? 'initials' and v_res ? 'active' and v_res ? 'version' and v_res ? 'created_at' and v_res ? 'updated_at') then
    raise exception 'FAIL CREATE keys %', v_res;
  end if;
  if (v_res->>'initials') <> 'AE' then raise exception 'FAIL initials %', v_res; end if;
  if (v_res->>'version')::int <> 1 then raise exception 'FAIL version 1'; end if;
  v_id := v_res->>'id';
  perform set_config('vitros.test_emp_id', v_id, true);
  execute 'reset role';

  -- 2 exact replay
  execute 'set local role service_role';
  v_first := public.apply_employee_transition('CREATE', null, 'Alice Example', 'AE', null, null, 'test-create-1', 'test-actor', 'create reason');
  v_second := public.apply_employee_transition('CREATE', null, 'Alice Example', 'AE', null, null, 'test-create-1', 'test-actor', 'create reason');
  if (v_first->>'id') <> (v_second->>'id') then raise exception 'FAIL replay id mismatch'; end if;
  if (v_second->>'duplicate')::boolean is distinct from true then raise exception 'FAIL duplicate flag'; end if;
  select count(*) into v_evt_count from public.admin_employee_events where correlation_id='test-create-1';
  if v_evt_count <> 1 then raise exception 'FAIL duplicate created second row %', v_evt_count; end if;
  execute 'reset role';

  -- 3 changed request / actor reject
  execute 'set local role service_role';
  v_failed := false;
  begin perform public.apply_employee_transition('CREATE', null, 'Alice Changed', 'AE', null, null, 'test-create-1', 'test-actor', 'create reason');
  exception when sqlstate 'P0001' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL changed request not rejected'; end if;
  v_failed := false;
  begin perform public.apply_employee_transition('CREATE', null, 'Alice Example', 'AE', null, null, 'test-create-1', 'different-actor', 'create reason');
  exception when sqlstate 'P0001' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL different actor not rejected'; end if;
  execute 'reset role';

  -- 4 UPDATE partial preserve
  execute 'set local role service_role';
  v_res := public.apply_employee_transition('UPDATE', v_id, 'Alice Renamed', null, null, 1, 'test-update-1', 'test-actor', null);
  if (v_res->>'name') <> 'Alice Renamed' then raise exception 'FAIL update name'; end if;
  if (v_res->>'initials') <> 'AE' then raise exception 'FAIL preserve initials'; end if;
  if (v_res->>'version')::int <> 2 then raise exception 'FAIL version 2'; end if;
  if not exists (select 1 from public.admin_employee_events where correlation_id='test-update-1' and previous_values->>'name'='Alice Example' and new_values->>'name'='Alice Renamed' and previous_version=1 and new_version=2) then
    raise exception 'FAIL before/after';
  end if;
  v_second := public.apply_employee_transition('UPDATE', v_id, 'Alice Renamed', null, null, 1, 'test-update-1', 'test-actor', null);
  if (v_second->>'duplicate')::boolean is distinct from true then raise exception 'FAIL update replay duplicate'; end if;
  execute 'reset role';

  -- 5 version conflict
  execute 'set local role service_role';
  v_failed := false;
  begin perform public.apply_employee_transition('UPDATE', v_id, 'Stale', null, null, 1, 'test-stale', 'test-actor', null);
  exception when sqlstate '40001' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL version conflict not raised'; end if;
  execute 'reset role';

  -- 5b DEACTIVATE/ACTIVATE
  execute 'set local role service_role';
  v_res := public.apply_employee_transition('DEACTIVATE', v_id, null, null, null, 2, 'test-deactivate-1', 'test-actor', null);
  if (v_res->>'active')::boolean is distinct from false then raise exception 'FAIL deactivate'; end if;
  v_res := public.apply_employee_transition('ACTIVATE', v_id, null, null, null, 3, 'test-activate-1', 'test-actor', null);
  if (v_res->>'active')::boolean is distinct from true then raise exception 'FAIL activate'; end if;
  execute 'reset role';

  -- 6 duplicate active rejected; inactive share allowed
  execute 'set local role service_role';
  v_failed := false;
  begin perform public.apply_employee_transition('CREATE', null, 'Bob Second', 'ae', null, null, 'test-dup-active', 'test-actor', null);
  exception when sqlstate '23505' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL duplicate active not rejected'; end if;
  v_res := public.apply_employee_transition('CREATE', null, 'Inactive Bob', 'AE', false, null, 'test-inactive-share', 'test-actor', null);
  if (v_res->>'initials') <> 'AE' or (v_res->>'active')::boolean is distinct from false then raise exception 'FAIL inactive share'; end if;
  v_id2 := v_res->>'id';
  perform public.apply_employee_transition('DEACTIVATE', v_id, null, null, null, 4, 'test-deactivate-2', 'test-actor', null);
  v_res := public.apply_employee_transition('CREATE', null, 'Bob After Free', 'AE', null, null, 'test-dup-after-free', 'test-actor', null);
  if (v_res->>'initials') <> 'AE' then raise exception 'FAIL after free'; end if;
  execute 'reset role';

  -- 7 immutability
  v_failed := false;
  begin update public.admin_employee_events set reason='tamper' where correlation_id='test-create-1';
  exception when sqlstate '55000' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL event UPDATE not blocked'; end if;
  v_failed := false;
  begin delete from public.admin_employee_events where correlation_id='test-create-1';
  exception when sqlstate '55000' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL event DELETE not blocked'; end if;
  v_failed := false;
  begin truncate table public.admin_employee_events;
  exception when sqlstate '55000' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL event TRUNCATE not blocked'; end if;
  execute 'set local role service_role';
  v_failed := false;
  begin update public.admin_employee_events set reason='tamper2' where correlation_id='test-create-1';
  exception when sqlstate '42501' or sqlstate '55000' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL service_role update not denied'; end if;
  execute 'reset role';

  -- 8 permissions
  if has_function_privilege('public', 'public.apply_employee_transition(text,text,text,text,boolean,integer,text,text,text)', 'execute') then raise exception 'FAIL public EXECUTE'; end if;
  if has_function_privilege('anon', 'public.apply_employee_transition(text,text,text,text,boolean,integer,text,text,text)', 'execute') then raise exception 'FAIL anon EXECUTE'; end if;
  if has_function_privilege('authenticated', 'public.apply_employee_transition(text,text,text,text,boolean,integer,text,text,text)', 'execute') then raise exception 'FAIL authenticated EXECUTE'; end if;
  if not has_function_privilege('service_role', 'public.apply_employee_transition(text,text,text,text,boolean,integer,text,text,text)', 'execute') then raise exception 'FAIL service_role missing EXECUTE'; end if;
  if has_function_privilege('public', 'public.insert_employee_event(text,text,text,text,text,text,text,integer,text)', 'execute') then raise exception 'FAIL public legacy'; end if;
  if has_function_privilege('anon', 'public.insert_employee_event(text,text,text,text,text,text,text,integer,text)', 'execute') then raise exception 'FAIL anon legacy'; end if;
  if has_function_privilege('authenticated', 'public.insert_employee_event(text,text,text,text,text,text,text,integer,text)', 'execute') then raise exception 'FAIL authenticated legacy'; end if;
  if has_function_privilege('service_role', 'public.insert_employee_event(text,text,text,text,text,text,text,integer,text)', 'execute') then raise exception 'FAIL service_role legacy should be revoked'; end if;
  if has_table_privilege('anon', 'public.convex_employees', 'INSERT') then raise exception 'FAIL anon INSERT'; end if;
  if has_table_privilege('service_role', 'public.convex_employees', 'INSERT') then raise exception 'FAIL service_role INSERT'; end if;
  if not has_table_privilege('service_role', 'public.convex_employees', 'SELECT') then raise exception 'FAIL service_role SELECT convex'; end if;
  if has_table_privilege('service_role', 'public.admin_employee_events', 'INSERT') then raise exception 'FAIL service_role INSERT events'; end if;
  if not has_table_privilege('service_role', 'public.admin_employee_events', 'SELECT') then raise exception 'FAIL service_role SELECT events'; end if;
  execute 'set local role anon';
  v_failed := false;
  begin perform public.apply_employee_transition('CREATE', null, 'Anon Try', 'AN', null, null, 'test-anon', 'anon-actor', null);
  exception when sqlstate '42501' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL anon call not denied'; end if;
  execute 'reset role';
  execute 'set local role authenticated';
  v_failed := false;
  begin perform public.apply_employee_transition('CREATE', null, 'Auth Try', 'AU', null, null, 'test-auth', 'auth-actor', null);
  exception when sqlstate '42501' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL authenticated call not denied'; end if;
  execute 'reset role';

  -- 9 RLS
  if not (select relrowsecurity from pg_class where oid='public.convex_employees'::regclass) then raise exception 'FAIL RLS convex'; end if;
  if not (select relrowsecurity from pg_class where oid='public.admin_employee_events'::regclass) then raise exception 'FAIL RLS events'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename in ('convex_employees','admin_employee_events')) <> 0 then raise exception 'FAIL policies exist'; end if;

  -- 10 index
  if not exists (select 1 from pg_class where relname='convex_employees_canonical_initials_uq') then raise exception 'FAIL index missing'; end if;

  -- 11 validation
  execute 'set local role service_role';
  v_failed := false; begin perform public.apply_employee_transition('CREATE', null, 'Bad'||chr(9)||'Name', 'XX', null, null, 'test-cntrl-tab', 'test-actor', null); exception when sqlstate '22023' then v_failed := true; end; if not v_failed then raise exception 'FAIL cntrl tab'; end if;
  v_failed := false; begin perform public.apply_employee_transition('CREATE', null, 'Bad'||chr(10)||'Name', 'YY', null, null, 'test-cntrl-nl', 'test-actor', null); exception when sqlstate '22023' then v_failed := true; end; if not v_failed then raise exception 'FAIL cntrl nl'; end if;
  v_failed := false; begin perform public.apply_employee_transition('CREATE', null, 'Valid', 'ABCDE', null, null, 'test-long', 'test-actor', null); exception when sqlstate '22023' then v_failed := true; end; if not v_failed then raise exception 'FAIL long'; end if;
  v_failed := false; begin perform public.apply_employee_transition('CREATE', null, 'Valid', 'A@', null, null, 'test-badchar', 'test-actor', null); exception when sqlstate '22023' then v_failed := true; end; if not v_failed then raise exception 'FAIL badchar'; end if;
  v_failed := false; begin perform public.apply_employee_transition('UPDATE', 'not-a-uuid', 'X', 'ZZ', null, 1, 'test-bad-uuid', 'test-actor', null); exception when sqlstate '22023' then v_failed := true; end; if not v_failed then raise exception 'FAIL bad uuid'; end if;
  execute 'reset role';

  -- 12 result equality after later changes
  execute 'set local role service_role';
  v_before := public.apply_employee_transition('CREATE', null, 'Stable', 'ST', null, null, 'test-stable', 'test-actor', null);
  perform public.apply_employee_transition('UPDATE', v_before->>'id', 'Stable Renamed', null, null, 1, 'test-stable-update', 'test-actor', null);
  v_after := public.apply_employee_transition('CREATE', null, 'Stable', 'ST', null, null, 'test-stable', 'test-actor', null);
  if (v_after->>'id') <> (v_before->>'id') or (v_after->>'name') <> 'Stable' or (v_after->>'duplicate')::boolean is distinct from true then raise exception 'FAIL stable replay % %', v_before, v_after; end if;
  execute 'reset role';

  -- 13 forced audit INSERT failure proves atomic rollback
  execute 'set local role service_role';
  v_res := public.apply_employee_transition('CREATE', null, 'AuditFail', 'AF', null, null, 'test-audit-create', 'test-actor', null);
  v_audit_id := v_res->>'id';
  execute 'reset role';
  -- create failing trigger inside this transaction
  create or replace function public.fixture_reject_event() returns trigger language plpgsql as $fixture$ begin raise exception 'fixture audit failure'; end $fixture$;
  create trigger fixture_reject_event before insert on public.admin_employee_events for each row execute function public.fixture_reject_event();
  execute 'set local role service_role';
  v_failed := false;
  begin perform public.apply_employee_transition('UPDATE', v_audit_id, 'Should Rollback', null, null, 1, 'test-audit-fail', 'test-actor', null);
  exception when sqlstate 'P0001' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL audit failure not raised'; end if;
  execute 'reset role';
  -- verify employee unchanged
  select version, name into v_after_row from public.convex_employees where id = v_audit_id::uuid;
  if v_after_row.version <> 1 or v_after_row.name <> 'AuditFail' then raise exception 'FAIL audit rollback left dirty version=% name=%', v_after_row.version, v_after_row.name; end if;
  -- remove trigger/function within same transaction
  drop trigger fixture_reject_event on public.admin_employee_events;
  drop function public.fixture_reject_event();

  -- Invalid legacy inactive identity must remain inactive, unchanged and unaudited.
  insert into public.convex_employees(name, initials, active) values ('Invalid Legacy', 'TOOLONG', false) returning id::text into v_id2;
  select count(*) into v_evt_count from public.admin_employee_events;
  execute 'set local role service_role';
  v_failed := false;
  begin
    perform public.apply_employee_transition('ACTIVATE', v_id2, null, null, true, 1, 'test-invalid-activation', 'test-actor', null);
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL invalid inactive identity activated'; end if;
  execute 'reset role';
  if not exists (select 1 from public.convex_employees where id=v_id2::uuid and active=false and version=1)
     or (select count(*) from public.admin_employee_events) <> v_evt_count then
    raise exception 'FAIL rejected activation mutated row/version/audit';
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;

-- Verify rollback left no residual test rows/events beyond bootstrap counts
do $$
declare pre_emp int := current_setting('vitros.pre_emp')::int;
  pre_evt int := current_setting('vitros.pre_evt')::int;
  cur_emp int; cur_evt int;
begin
  select count(*) into cur_emp from public.convex_employees;
  select count(*) into cur_evt from public.admin_employee_events;
  if cur_emp <> pre_emp then raise exception 'FAIL rollback left % employees expected %', cur_emp, pre_emp; end if;
  if cur_evt <> pre_evt then raise exception 'FAIL rollback left % events expected %', cur_evt, pre_evt; end if;
  raise notice 'PASS rollback no residuals emp=% evt=%', cur_emp, cur_evt;
end $$;
