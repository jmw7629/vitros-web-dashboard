-- Transport-neutral controlled-document field bridge. No production manifest is
-- seeded. Scanner RPC and routes remain unchanged; inventory effects run through
-- the existing scanner transaction, with this state/event write in the SAME call.
insert into public.settings(key,value) values('digitalDhrEnabled','false') on conflict(key) do nothing;

create table public.digital_dhr_manifests (
  template_id text not null, document_revision text not null, analyzer_model text not null,
  manifest jsonb not null, registered_by text not null, review_reference text not null,
  created_at timestamptz not null default now(), primary key(template_id,document_revision)
);
create table public.digital_dhr_instances (
  id uuid primary key, session_id uuid not null unique references public.dhr_scan_sessions(id) on delete restrict,
  template_id text not null, document_revision text not null, created_by text not null,
  employee_id uuid not null references public.convex_employees(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(template_id,document_revision) references public.digital_dhr_manifests(template_id,document_revision) on delete restrict
);
create table public.digital_dhr_field_state (
  instance_id uuid not null references public.digital_dhr_instances(id) on delete restrict,
  field_id text not null, section_id text not null, part_number text not null,
  quantity integer not null default 0 check(quantity between 0 and 1000000),
  field_version integer not null default 0 check(field_version between 0 and 1000000),
  primary key(instance_id,field_id)
);
create table public.digital_dhr_part_totals (
  instance_id uuid not null references public.digital_dhr_instances(id) on delete restrict,
  section_id text not null, part_number text not null,
  expected_part_id uuid not null references public.dhr_expected_parts(id) on delete restrict,
  inventory_part_number text, stock_id uuid references public.stock(id) on delete restrict,
  quantity integer not null default 0 check(quantity between 0 and 1000000),
  scanner_revision integer not null default 0 check(scanner_revision>=0),
  primary key(instance_id,section_id,part_number)
);
create table public.digital_dhr_consumption_events (
  event_id uuid primary key, idempotency_key uuid not null unique,
  instance_id uuid not null references public.digital_dhr_instances(id) on delete restrict,
  field_id text not null, field_version integer not null,
  operator_id text not null, employee_id uuid not null,
  request jsonb not null, receipt jsonb not null,
  created_at timestamptz not null default now(), unique(instance_id,field_id,field_version)
);
create index digital_dhr_events_instance_idx on public.digital_dhr_consumption_events(instance_id,created_at);

create function public.reject_digital_dhr_history_mutation() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'digital_dhr_immutable_history'; end $$;
create trigger digital_dhr_manifest_immutable before update or delete on public.digital_dhr_manifests for each row execute function public.reject_digital_dhr_history_mutation();
create trigger digital_dhr_instance_immutable before update or delete on public.digital_dhr_instances for each row execute function public.reject_digital_dhr_history_mutation();
create trigger digital_dhr_event_immutable before update or delete on public.digital_dhr_consumption_events for each row execute function public.reject_digital_dhr_history_mutation();

create function public.assert_digital_dhr_enabled() returns void language plpgsql stable set search_path=public,pg_temp as $$
begin if not exists(select 1 from public.settings where key='digitalDhrEnabled' and value='true') then raise exception 'digital_dhr_disabled'; end if; end $$;
create function public.digital_dhr_text(p_value jsonb,p_max integer) returns boolean language sql immutable set search_path=public,pg_temp as $$
 select coalesce(jsonb_typeof(p_value)='string' and length(p_value#>>'{}') between 1 and p_max and (p_value#>>'{}')=btrim(p_value#>>'{}') and (p_value#>>'{}') !~ '[[:cntrl:]]',false)
$$;
create function public.validate_digital_dhr_manifest(p_manifest jsonb) returns void language plpgsql set search_path=public,pg_temp as $$
declare b jsonb; seen text[]:='{}'; expected public.dhr_expected_parts; n integer;
begin
 if p_manifest is null or jsonb_typeof(p_manifest)<>'object' or octet_length(p_manifest::text)>300000 or (p_manifest - array['schemaVersion','templateId','documentRevision','analyzerModel','artifactSha256','bindings'])<>'{}'::jsonb or p_manifest->'schemaVersion' is distinct from '1'::jsonb or not public.digital_dhr_text(p_manifest->'templateId',160) or not public.digital_dhr_text(p_manifest->'documentRevision',40) or not public.digital_dhr_text(p_manifest->'analyzerModel',40) or jsonb_typeof(p_manifest->'artifactSha256') is distinct from 'string' or coalesce(p_manifest->>'artifactSha256','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_manifest->'bindings') is distinct from 'array' then raise exception 'digital_dhr_validation'; end if;
 if jsonb_array_length(p_manifest->'bindings') not between 1 and 500 then raise exception 'digital_dhr_validation'; end if;
 for b in select value from jsonb_array_elements(p_manifest->'bindings') loop
  if jsonb_typeof(b)<>'object' or (b-array['fieldId','sectionId','partNumber','kind','quantityMode','stepReference'])<>'{}'::jsonb or not public.digital_dhr_text(b->'fieldId',160) or not public.digital_dhr_text(b->'sectionId',80) or not public.digital_dhr_text(b->'partNumber',120) or b->>'partNumber'<>upper(b->>'partNumber') or coalesce(b->>'kind','') not in ('consumable_part','tool') or b->>'quantityMode' is distinct from 'integer' or (b?'stepReference' and not public.digital_dhr_text(b->'stepReference',160)) or b->>'fieldId'=any(seen) then raise exception 'digital_dhr_validation'; end if;
  seen:=array_append(seen,b->>'fieldId');
  select count(*) into n from public.dhr_expected_parts where analyzer_model=p_manifest->>'analyzerModel' and section_id=b->>'sectionId' and upper(btrim(part_number))=b->>'partNumber';
  if n<>1 then raise exception 'digital_dhr_binding_not_configured'; end if;
  select * into expected from public.dhr_expected_parts where analyzer_model=p_manifest->>'analyzerModel' and section_id=b->>'sectionId' and upper(btrim(part_number))=b->>'partNumber';
  if expected.bom_qty is null or expected.bom_qty<0 or coalesce(lower(btrim(expected.category)),'') not in ('required','optional','additional','tool') or (b->>'kind'='tool') is distinct from (lower(btrim(expected.category))='tool') then raise exception 'digital_dhr_binding_not_configured'; end if;
 end loop;
end $$;

-- Privileged deployment operation only. Registration requires a reviewed source
-- reference and exact artifact hash; it is never exposed as a browser action.
create function public.register_digital_dhr_manifest(p_manifest jsonb,p_registered_by text,p_review_reference text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare old_manifest jsonb;
begin
 perform public.validate_digital_dhr_manifest(p_manifest);
 if not public.digital_dhr_text(to_jsonb(p_registered_by),200) or not public.digital_dhr_text(to_jsonb(p_review_reference),400) then raise exception 'digital_dhr_validation'; end if;
 perform pg_advisory_xact_lock(hashtextextended('digital-dhr-manifest|'||(p_manifest->>'templateId')||'|'||(p_manifest->>'documentRevision'),0));
 select manifest into old_manifest from public.digital_dhr_manifests where template_id=p_manifest->>'templateId' and document_revision=p_manifest->>'documentRevision';
 if found then if old_manifest is distinct from p_manifest then raise exception 'digital_dhr_conflict'; end if; return old_manifest; end if;
 insert into public.digital_dhr_manifests(template_id,document_revision,analyzer_model,manifest,registered_by,review_reference) values(p_manifest->>'templateId',p_manifest->>'documentRevision',p_manifest->>'analyzerModel',p_manifest,p_registered_by,p_review_reference);
 return p_manifest;
end $$;

create function public.get_digital_dhr_document(p_instance_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d public.digital_dhr_instances; s public.dhr_scan_sessions; m jsonb; fields jsonb;
begin
 perform public.assert_digital_dhr_enabled();
 select * into d from public.digital_dhr_instances where id=p_instance_id;
 if not found then raise exception 'digital_dhr_not_found'; end if;
 select * into s from public.dhr_scan_sessions where id=d.session_id;
 select manifest into m from public.digital_dhr_manifests where template_id=d.template_id and document_revision=d.document_revision;
 select jsonb_agg(jsonb_build_object('fieldId',f.field_id,'fieldVersion',f.field_version,'quantity',f.quantity,'conflict',t.quantity is distinct from coalesce(r.scanned_qty,0) or t.scanner_revision is distinct from coalesce(r.revision,0) or e.analyzer_model is distinct from s.analyzer_model or e.section_id is distinct from f.section_id or upper(btrim(e.part_number)) is distinct from f.part_number or (case when lower(btrim(e.category))='tool' then null else upper(btrim(coalesce(nullif(e.inventory_part_number,''),e.part_number))) end) is distinct from t.inventory_part_number or (t.stock_id is not null and upper(btrim(stock.part_number)) is distinct from t.inventory_part_number)) order by f.field_id) into fields
 from public.digital_dhr_field_state f join public.digital_dhr_part_totals t on t.instance_id=f.instance_id and t.section_id=f.section_id and t.part_number=f.part_number
 left join public.dhr_expected_parts e on e.id=t.expected_part_id
 left join public.stock on stock.id=t.stock_id
 left join public.dhr_scan_results r on r.session_id=d.session_id and r.section_id=f.section_id and upper(btrim(r.part_number))=f.part_number where f.instance_id=d.id;
 return jsonb_build_object('documentInstanceId',d.id,'sessionId',d.session_id,'documentTemplateId',d.template_id,'documentRevision',d.document_revision,'instrumentSn',s.instrument_sn,'woNumber',nullif(btrim(s.wo_number),''),'status',s.status,'manifest',m,'fields',coalesce(fields,'[]'::jsonb));
end $$;

create function public.create_digital_dhr_document(p_instance_id uuid,p_session_id uuid,p_template_id text,p_document_revision text,p_operator_id text,p_employee_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.dhr_scan_sessions; m public.digital_dhr_manifests; d public.digital_dhr_instances; locked_expected_ids uuid[]; v_state jsonb;
begin
 perform public.assert_digital_dhr_enabled();
 if p_instance_id is null or p_session_id is null or not public.digital_dhr_text(to_jsonb(p_operator_id),200) then raise exception 'digital_dhr_validation'; end if;
 if not exists(select 1 from public.convex_employees where id=p_employee_id and active=true and nullif(btrim(name),'') is not null and nullif(btrim(initials),'') is not null) then raise exception 'digital_dhr_identity_unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended('digital-dhr-instance|'||p_instance_id::text,0));
 select * into d from public.digital_dhr_instances where id=p_instance_id;
 if found then
  if d.session_id is distinct from p_session_id or d.template_id is distinct from p_template_id or d.document_revision is distinct from p_document_revision or d.created_by is distinct from p_operator_id or d.employee_id is distinct from p_employee_id then raise exception 'digital_dhr_conflict'; end if;
  return public.get_digital_dhr_document(d.id);
 end if;
 select * into s from public.dhr_scan_sessions where id=p_session_id for update;
 if not found then raise exception 'digital_dhr_not_found'; end if;
 if s.status is distinct from 'in_progress' or exists(select 1 from public.dhr_scan_results where session_id=s.id) or exists(select 1 from public.digital_dhr_instances where session_id=s.id) then raise exception 'digital_dhr_fresh_session_required'; end if;
 select * into m from public.digital_dhr_manifests where template_id=p_template_id and document_revision=p_document_revision;
 if not found then raise exception 'digital_dhr_not_found'; end if;
 if m.analyzer_model is distinct from s.analyzer_model then raise exception 'digital_dhr_validation'; end if;
 perform public.validate_digital_dhr_manifest(m.manifest);
 -- Pin the resolved expected-part identity and inventory alias at attachment.
 -- Lock these rows while taking the snapshot; later changes cannot silently
 -- redirect a return to a different stock item.
 select coalesce(array_agg(locked.id),'{}'::uuid[]) into locked_expected_ids from (
  select e.id from public.dhr_expected_parts e where e.analyzer_model=s.analyzer_model and exists(select 1 from jsonb_array_elements(m.manifest->'bindings') b where b->>'sectionId'=e.section_id and b->>'partNumber'=upper(btrim(e.part_number))) order by e.id for share
 ) locked;
 -- READ COMMITTED may wait for a changed/deleted row while taking its lock.
 -- Recheck the latest category and key only after locks are held; never derive
 -- totals from a new row that appeared after the locked snapshot.
 perform public.validate_digital_dhr_manifest(m.manifest);
 insert into public.digital_dhr_instances(id,session_id,template_id,document_revision,created_by,employee_id) values(p_instance_id,p_session_id,p_template_id,p_document_revision,p_operator_id,p_employee_id);
 insert into public.digital_dhr_field_state(instance_id,field_id,section_id,part_number) select p_instance_id,b->>'fieldId',b->>'sectionId',b->>'partNumber' from jsonb_array_elements(m.manifest->'bindings') b;
 insert into public.digital_dhr_part_totals(instance_id,section_id,part_number,expected_part_id,inventory_part_number,stock_id)
 select distinct p_instance_id,b->>'sectionId',b->>'partNumber',e.id,
  case when b->>'kind'='tool' then null else upper(btrim(coalesce(nullif(e.inventory_part_number,''),e.part_number))) end,
  case when b->>'kind'='tool' then null else stock.id end
 from jsonb_array_elements(m.manifest->'bindings') b join public.dhr_expected_parts e on e.id=any(locked_expected_ids) and e.analyzer_model=s.analyzer_model and e.section_id=b->>'sectionId' and upper(btrim(e.part_number))=b->>'partNumber'
 left join public.stock on upper(btrim(stock.part_number))=upper(btrim(coalesce(nullif(e.inventory_part_number,''),e.part_number)));
 if exists(
  select 1 from jsonb_array_elements(m.manifest->'bindings') b
  left join public.digital_dhr_field_state f on f.instance_id=p_instance_id and f.field_id=b->>'fieldId' and f.section_id=b->>'sectionId' and f.part_number=b->>'partNumber'
  left join public.digital_dhr_part_totals t on t.instance_id=p_instance_id and t.section_id=f.section_id and t.part_number=f.part_number
  where f.field_id is null or t.expected_part_id is null
 ) or (select count(*) from public.digital_dhr_field_state where instance_id=p_instance_id)<>jsonb_array_length(m.manifest->'bindings') then raise exception 'digital_dhr_conflict'; end if;
 v_state:=public.get_digital_dhr_document(p_instance_id);
 if jsonb_array_length(v_state->'fields')<>jsonb_array_length(m.manifest->'bindings') then raise exception 'digital_dhr_conflict'; end if;
 return v_state;
end $$;

create function public.apply_digital_dhr_field_event(p_event jsonb,p_operator_id text,p_employee_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.digital_dhr_instances; s public.dhr_scan_sessions; f public.digital_dhr_field_state; total public.digital_dhr_part_totals; prior public.digital_dhr_consumption_events;
 employee public.convex_employees; expected public.dhr_expected_parts; current_result public.dhr_scan_results; binding jsonb; m jsonb; k text; number_value numeric;
 v_event_id uuid; idem uuid; instance_id uuid; next_qty integer; next_version integer; aggregate_qty integer; old_qty integer; delta integer; primitive jsonb; receipt jsonb; correlation text; actor text; n integer; stock_count integer; stock_qty integer; v_stock_id uuid;
begin
 perform public.assert_digital_dhr_enabled();
 if p_event is null or jsonb_typeof(p_event)<>'object' or octet_length(p_event::text)>8000 or (p_event-array['eventId','idempotencyKey','documentInstanceId','documentTemplateId','documentRevision','fieldId','fieldVersion','sectionId','partNumber','previousQuantity','quantity','instrumentSn','woNumber','occurredAt'])<>'{}'::jsonb then raise exception 'digital_dhr_validation'; end if;
 foreach k in array array['eventId','idempotencyKey','documentInstanceId'] loop if coalesce(p_event->>k,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'digital_dhr_validation'; end if; end loop;
 foreach k in array array['documentTemplateId','documentRevision','fieldId','sectionId','partNumber','instrumentSn','occurredAt'] loop if not public.digital_dhr_text(p_event->k,case k when 'documentRevision' then 40 when 'sectionId' then 80 when 'instrumentSn' then 80 when 'occurredAt' then 40 when 'partNumber' then 120 else 160 end) then raise exception 'digital_dhr_validation'; end if; end loop;
 if (p_event?'woNumber' and not public.digital_dhr_text(p_event->'woNumber',120)) or p_event->>'partNumber'<>upper(p_event->>'partNumber') or (p_event->>'occurredAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'digital_dhr_validation'; end if;
 if substring(p_event->>'occurredAt',12,2)::integer>23 or substring(p_event->>'occurredAt',15,2)::integer>59 or substring(p_event->>'occurredAt',18,2)::integer>59 then raise exception 'digital_dhr_validation'; end if;
 perform (p_event->>'occurredAt')::timestamptz;
 foreach k in array array['fieldVersion','previousQuantity','quantity'] loop
  if jsonb_typeof(p_event->k) is distinct from 'number' then raise exception 'digital_dhr_validation'; end if;
  number_value:=(p_event->>k)::numeric;
  if number_value<>trunc(number_value) or number_value not between (case when k='fieldVersion' then 1 else 0 end) and 1000000 then raise exception 'digital_dhr_validation'; end if;
 end loop;
 if not public.digital_dhr_text(to_jsonb(p_operator_id),200) then raise exception 'digital_dhr_identity_unavailable'; end if;
 select * into employee from public.convex_employees where id=p_employee_id and active=true;
 if not found or not public.digital_dhr_text(to_jsonb(employee.name),200) or not public.digital_dhr_text(to_jsonb(employee.initials),40) then raise exception 'digital_dhr_identity_unavailable'; end if;
 actor:=btrim(employee.name)||' ('||upper(btrim(employee.initials))||')';
 v_event_id:=(p_event->>'eventId')::uuid; idem:=(p_event->>'idempotencyKey')::uuid; instance_id:=(p_event->>'documentInstanceId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('digital-dhr-idempotency|'||idem::text,0));
 perform pg_advisory_xact_lock(hashtextextended('digital-dhr-event|'||v_event_id::text,0));
 select * into prior from public.digital_dhr_consumption_events e where e.event_id=v_event_id or e.idempotency_key=idem;
 if found then
  if prior.event_id is distinct from v_event_id or prior.idempotency_key is distinct from idem or prior.request is distinct from p_event or prior.operator_id is distinct from p_operator_id or prior.employee_id is distinct from p_employee_id then raise exception 'digital_dhr_conflict'; end if;
  return prior.receipt||jsonb_build_object('duplicate',true);
 end if;
 select * into d from public.digital_dhr_instances where id=instance_id for update;
 if not found then raise exception 'digital_dhr_not_found'; end if;
 if d.template_id is distinct from p_event->>'documentTemplateId' or d.document_revision is distinct from p_event->>'documentRevision' then raise exception 'digital_dhr_conflict'; end if;
 select manifest into m from public.digital_dhr_manifests where template_id=d.template_id and document_revision=d.document_revision;
 select value into binding from jsonb_array_elements(m->'bindings') where value->>'fieldId'=p_event->>'fieldId';
 if not found or binding->>'partNumber' is distinct from p_event->>'partNumber' or binding->>'sectionId' is distinct from p_event->>'sectionId' then raise exception 'digital_dhr_validation'; end if;
 correlation:='digital-dhr:'||idem::text;
 -- Match the existing primitive's lock order before taking its session row lock.
 perform pg_advisory_xact_lock(hashtextextended('dhr-correlation|'||correlation,0));
 perform pg_advisory_xact_lock(hashtextextended('dhr-field|'||d.session_id::text||'|'||(binding->>'sectionId')||'|'||(binding->>'partNumber'),0));
 select * into s from public.dhr_scan_sessions where id=d.session_id for update;
 if s.instrument_sn is distinct from p_event->>'instrumentSn' or nullif(btrim(s.wo_number),'') is distinct from p_event->>'woNumber' then raise exception 'digital_dhr_conflict'; end if;
 if s.status is distinct from 'in_progress' then raise exception 'digital_dhr_conflict'; end if;
 select * into f from public.digital_dhr_field_state where digital_dhr_field_state.instance_id=d.id and field_id=binding->>'fieldId';
 next_version:=(p_event->>'fieldVersion')::integer; next_qty:=(p_event->>'quantity')::integer; old_qty:=f.quantity; delta:=next_qty-old_qty;
 if next_version<>f.field_version+1 or (p_event->>'previousQuantity')::integer<>old_qty then raise exception 'digital_dhr_conflict'; end if;
 select * into total from public.digital_dhr_part_totals where digital_dhr_part_totals.instance_id=d.id and section_id=f.section_id and part_number=f.part_number;
 select count(*) into n from public.dhr_scan_results where session_id=d.session_id and section_id=f.section_id and upper(btrim(part_number))=f.part_number;
 if n>1 then raise exception 'digital_dhr_conflict'; end if;
 select * into current_result from public.dhr_scan_results where session_id=d.session_id and section_id=f.section_id and upper(btrim(part_number))=f.part_number;
 if total.quantity is distinct from coalesce(current_result.scanned_qty,0) or total.scanner_revision is distinct from coalesce(current_result.revision,0) then raise exception 'digital_dhr_conflict'; end if;
 aggregate_qty:=total.quantity+delta;
 if aggregate_qty not between 0 and 1000000 then raise exception 'digital_dhr_validation'; end if;
 select count(*) into n from public.dhr_expected_parts where analyzer_model=s.analyzer_model and section_id=f.section_id and upper(btrim(part_number))=f.part_number;
 if n<>1 then raise exception 'digital_dhr_binding_not_configured'; end if;
 select * into expected from public.dhr_expected_parts where analyzer_model=s.analyzer_model and section_id=f.section_id and upper(btrim(part_number))=f.part_number for share;
 if expected.id is distinct from total.expected_part_id or (case when binding->>'kind'='tool' then null else upper(btrim(coalesce(nullif(expected.inventory_part_number,''),expected.part_number))) end) is distinct from total.inventory_part_number then raise exception 'digital_dhr_conflict'; end if;
 if (binding->>'kind'='tool') is distinct from (lower(btrim(expected.category))='tool') then raise exception 'digital_dhr_binding_not_configured'; end if;
 if binding->>'kind'<>'tool' then
  select count(*) into stock_count from public.stock where upper(btrim(part_number))=upper(btrim(coalesce(nullif(expected.inventory_part_number,''),expected.part_number)));
  if stock_count=0 then raise exception 'digital_dhr_not_found'; elsif stock_count<>1 then raise exception 'digital_dhr_conflict'; end if;
  select id,coalesce(qty_on_hand,0) into v_stock_id,stock_qty from public.stock where upper(btrim(part_number))=upper(btrim(coalesce(nullif(expected.inventory_part_number,''),expected.part_number))) for update;
  if total.stock_id is not null and total.stock_id is distinct from v_stock_id then raise exception 'digital_dhr_conflict'; end if;
  if delta>stock_qty then raise exception 'digital_dhr_insufficient_stock'; end if;
 end if;
 -- Never perform inventory writes separately from its existing immutable event,
 -- audit and pending-SAP transaction. This wrapper adds only linked field state.
 primitive:=public.apply_dhr_scan_transition(d.session_id,f.section_id,f.part_number,expected.bom_qty,aggregate_qty,expected.category,coalesce(expected.description,''),actor,correlation,total.scanner_revision,s.instrument_sn);
 if primitive->>'delta' is distinct from delta::text or primitive->>'revisionAfter' is distinct from (total.scanner_revision+1)::text or primitive->>'duplicate' is distinct from 'false' then raise exception 'digital_dhr_conflict'; end if;
 receipt:=p_event||jsonb_build_object('woNumber',nullif(btrim(s.wo_number),''),'status',case when binding->>'kind'='tool' then 'ignored' when delta>0 then 'consumed' when delta<0 then 'returned' else 'unchanged' end,'duplicate',false,'delta',case when binding->>'kind'='tool' then 0 else delta end,'inventoryPartNumber',total.inventory_part_number,'stockId',v_stock_id,'stockBefore',primitive->'stockBefore','stockAfter',primitive->'stockAfter','auditId',primitive->'auditId','sapStagingId',primitive->'sapId','correlationId',correlation,'operatorId',p_operator_id,'operatorInitials',upper(btrim(employee.initials)),'actor',actor,'processedAt',primitive->'processedAt');
 update public.digital_dhr_field_state set quantity=next_qty,field_version=next_version where digital_dhr_field_state.instance_id=d.id and field_id=f.field_id;
 update public.digital_dhr_part_totals set quantity=aggregate_qty,scanner_revision=total.scanner_revision+1,stock_id=v_stock_id where digital_dhr_part_totals.instance_id=d.id and section_id=f.section_id and part_number=f.part_number;
 insert into public.digital_dhr_consumption_events(event_id,idempotency_key,instance_id,field_id,field_version,operator_id,employee_id,request,receipt) values(v_event_id,idem,d.id,f.field_id,next_version,p_operator_id,p_employee_id,p_event,receipt);
 return receipt;
end $$;

alter table public.digital_dhr_manifests enable row level security;
alter table public.digital_dhr_instances enable row level security;
alter table public.digital_dhr_field_state enable row level security;
alter table public.digital_dhr_part_totals enable row level security;
alter table public.digital_dhr_consumption_events enable row level security;
revoke all on table public.digital_dhr_manifests,public.digital_dhr_instances,public.digital_dhr_field_state,public.digital_dhr_part_totals,public.digital_dhr_consumption_events from public,anon,authenticated,service_role;
grant select on table public.digital_dhr_manifests,public.digital_dhr_instances,public.digital_dhr_field_state,public.digital_dhr_part_totals,public.digital_dhr_consumption_events to service_role;
revoke all on function public.reject_digital_dhr_history_mutation(),public.assert_digital_dhr_enabled(),public.digital_dhr_text(jsonb,integer),public.validate_digital_dhr_manifest(jsonb),public.register_digital_dhr_manifest(jsonb,text,text),public.get_digital_dhr_document(uuid),public.create_digital_dhr_document(uuid,uuid,text,text,text,uuid),public.apply_digital_dhr_field_event(jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.register_digital_dhr_manifest(jsonb,text,text),public.get_digital_dhr_document(uuid),public.create_digital_dhr_document(uuid,uuid,text,text,text,uuid),public.apply_digital_dhr_field_event(jsonb,text,uuid) to service_role;

create function public.get_digital_dhr_bridge_status() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.settings where key='digitalDhrEnabled' and value='true')
$$;
revoke all on function public.get_digital_dhr_bridge_status() from public,anon,authenticated;
grant execute on function public.get_digital_dhr_bridge_status() to service_role;
