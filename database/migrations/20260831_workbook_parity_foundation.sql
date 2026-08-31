-- VITROS workbook parity foundation.
-- Additive only: preserves existing live stock quantities and immutable audit history.
-- Server-only posture is retained: RLS enabled with no public policies.

create extension if not exists pgcrypto;

alter table public.stock
  add column if not exists barcode text,
  add column if not exists prime boolean,
  add column if not exists expense boolean,
  add column if not exists obsolete boolean,
  add column if not exists stocking_plan_helper text,
  add column if not exists suggested_reorder_qty integer;

create unique index if not exists stock_barcode_unique
  on public.stock (barcode) where barcode is not null and barcode <> '';

alter table public.kits
  add column if not exists kit_barcode_value text,
  add column if not exists analyzer_type text,
  add column if not exists active boolean not null default true,
  add column if not exists notes text;

create unique index if not exists kits_kit_id_unique on public.kits (kit_id);
create unique index if not exists kits_barcode_unique
  on public.kits (kit_barcode_value) where kit_barcode_value is not null and kit_barcode_value <> '';

create table if not exists public.stocking_plan (
  id uuid primary key default gen_random_uuid(),
  plant_sloc text not null,
  part_number text not null references public.stock(part_number) on update cascade on delete restrict,
  product_name text,
  reorder_point integer check (reorder_point is null or reorder_point >= 0),
  reorder_qty integer check (reorder_qty is null or reorder_qty >= 0),
  prime boolean,
  expense boolean,
  obsolete boolean,
  duplicate_flag boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plant_sloc, part_number)
);

create table if not exists public.kit_components (
  id uuid primary key default gen_random_uuid(),
  kit_id text not null references public.kits(kit_id) on update cascade on delete restrict,
  part_number text not null references public.stock(part_number) on update cascade on delete restrict,
  qty_per_kit integer not null check (qty_per_kit > 0),
  component_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kit_id, part_number)
);

create table if not exists public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null unique,
  mode text not null check (mode in ('IN','OUT','ADJUST','KIT_CONSUME','RECONCILE')),
  status text not null default 'OPEN' check (status in ('OPEN','COMMITTED','REVERSED','CANCELLED','ERROR')),
  user_id text,
  initials text,
  instrument_serial text,
  notes text,
  correlation_id text unique,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_batch_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null references public.inventory_batches(batch_id) on update cascade on delete restrict,
  part_number text not null references public.stock(part_number) on update cascade on delete restrict,
  requested_qty integer not null check (requested_qty > 0),
  issued_qty integer check (issued_qty is null or issued_qty >= 0),
  shortage_qty integer not null default 0 check (shortage_qty >= 0),
  qty_before integer,
  qty_after integer,
  local_transaction_id text,
  created_at timestamptz not null default now(),
  unique (batch_id, part_number)
);

create table if not exists public.shortages (
  id uuid primary key default gen_random_uuid(),
  shortage_key text not null unique,
  batch_id text,
  kit_id text,
  kit_name text,
  part_number text not null references public.stock(part_number) on update cascade on delete restrict,
  need_qty integer not null check (need_qty > 0),
  issued_qty integer not null default 0 check (issued_qty >= 0),
  short_qty integer generated always as (greatest(need_qty - issued_qty, 0)) stored,
  instrument_serial text,
  notes text,
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED','VOID')),
  created_by text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.transaction_reversals (
  id uuid primary key default gen_random_uuid(),
  original_correlation_id text not null,
  reversal_correlation_id text not null unique,
  original_audit_id uuid references public.audit_log(id) on delete restrict,
  reversal_audit_id uuid references public.audit_log(id) on delete restrict,
  reason text not null,
  reversed_by text not null,
  created_at timestamptz not null default now(),
  unique (original_correlation_id)
);

create table if not exists public.sap_mapping (
  mapping_key text primary key,
  mapping_value text not null,
  description text,
  updated_at timestamptz not null default now()
);

insert into public.sap_mapping(mapping_key, mapping_value, description) values
  ('DefaultPlant','US08','Default SAP plant'),
  ('DefaultStorageLocation','MAIN','Default storage location'),
  ('OUT_MovementType','261','OUT movement type'),
  ('IN_MovementType','101','IN movement type'),
  ('ADJUST_MovementType','711','ADJUST movement type'),
  ('HeaderText_Default','VITROS Analyzer Consumption','Default SAP header text'),
  ('PostingMode','POST ONLY FINALIZED ROWS','Only finalized rows are eligible for SAP staging')
on conflict (mapping_key) do nothing;

create table if not exists public.sap_post_log (
  id uuid primary key default gen_random_uuid(),
  staging_id uuid references public.sap_staging(id) on delete restrict,
  local_transaction_id text,
  batch_id text,
  post_status text not null,
  material_document text,
  document_year text,
  response_text text,
  attempted_by text,
  attempted_at timestamptz not null default now(),
  correlation_id text unique
);

create table if not exists public.error_queue (
  id uuid primary key default gen_random_uuid(),
  error_key text not null unique,
  source text not null,
  correlation_id text,
  batch_id text,
  part_number text,
  mode text,
  quantity integer,
  instrument_serial text,
  sap_status text,
  reconciliation_flag text,
  recommended_action text,
  error_message text,
  status text not null default 'OPEN' check (status in ('OPEN','RETRYING','RESOLVED','VOID')),
  created_by text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.workbook_import_runs (
  id uuid primary key default gen_random_uuid(),
  import_key text not null unique,
  workbook_name text not null,
  workbook_sha256 text,
  mode text not null default 'METADATA_ONLY' check (mode in ('DRY_RUN','METADATA_ONLY','ADMIN_QOH_MIGRATION')),
  requested_by text,
  inserted_count integer not null default 0,
  metadata_updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  skipped_quantity_count integer not null default 0,
  invalid_count integer not null default 0,
  duplicate_key_count integer not null default 0,
  report jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

-- No table above is browser-readable directly. Convex/service-role remains the boundary.
alter table public.stocking_plan enable row level security;
alter table public.kit_components enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.inventory_batch_lines enable row level security;
alter table public.shortages enable row level security;
alter table public.transaction_reversals enable row level security;
alter table public.sap_mapping enable row level security;
alter table public.sap_post_log enable row level security;
alter table public.error_queue enable row level security;
alter table public.workbook_import_runs enable row level security;

-- Explicitly revoke direct browser-role access; service_role bypasses RLS.
revoke all on public.stocking_plan from anon, authenticated;
revoke all on public.kit_components from anon, authenticated;
revoke all on public.inventory_batches from anon, authenticated;
revoke all on public.inventory_batch_lines from anon, authenticated;
revoke all on public.shortages from anon, authenticated;
revoke all on public.transaction_reversals from anon, authenticated;
revoke all on public.sap_mapping from anon, authenticated;
revoke all on public.sap_post_log from anon, authenticated;
revoke all on public.error_queue from anon, authenticated;
revoke all on public.workbook_import_runs from anon, authenticated;
