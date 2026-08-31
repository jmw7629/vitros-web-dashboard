-- REM Module: Authoritative Supabase tables
-- Issue #44: Replace parallel Convex REM business-state with Supabase source of truth
-- All tables use RLS enabled, revoked from anon/authenticated (server-only via service_role)

-- 1. rem_analyzers — tracks each analyzer build/service lifecycle
CREATE TABLE IF NOT EXISTS rem_analyzers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number text NOT NULL,
  analyzer_type text,
  type text,
  stage text,
  progress numeric,
  status text,
  year_number text,
  production_order text,
  current_stage text,
  overall_pct numeric DEFAULT 0,
  procurement_pct numeric DEFAULT 0,
  cleaning_pct numeric DEFAULT 0,
  service_pct numeric DEFAULT 0,
  service_cell text,
  final_line_pct numeric DEFAULT 0,
  release_testing_pct numeric DEFAULT 0,
  packaging_pct numeric DEFAULT 0,
  sap_release_pct numeric DEFAULT 0,
  qa_release_pct numeric DEFAULT 0,
  current_pct numeric DEFAULT 0,
  sla_days numeric DEFAULT 0,
  days_in_stage numeric DEFAULT 0,
  days_elapsed numeric DEFAULT 0,
  start_date text,
  end_date text,
  done_week text,
  is_complete boolean DEFAULT false,
  install_date text,
  install_country text,
  install_status text,
  install_cost numeric,
  fpy_percentage numeric,
  release_fpy numeric,
  field_status text,
  country text,
  fpy numeric,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rem_analyzers_serial ON rem_analyzers (serial_number);

-- 2. rem_build_plan — weekly build plan data
CREATE TABLE IF NOT EXISTS rem_build_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of text NOT NULL,
  planned numeric DEFAULT 0,
  actual numeric DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. rem_lvcc — level of completion tracker for LVCC items
CREATE TABLE IF NOT EXISTS rem_lvcc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number text,
  item_id text,
  item_type text,
  category text,
  batch_number text,
  quantity numeric,
  current_stage text,
  build_pct numeric DEFAULT 0,
  test_pct numeric DEFAULT 0,
  packaging_pct numeric DEFAULT 0,
  sap_release_pct numeric DEFAULT 0,
  qa_release_pct numeric DEFAULT 0,
  start_date text,
  end_date text,
  is_complete boolean DEFAULT false,
  status text,
  progress numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. rem_staff — staff/certification data
CREATE TABLE IF NOT EXISTS rem_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text NOT NULL,
  fte numeric,
  certifications jsonb,
  skills jsonb,
  is_lead boolean DEFAULT false,
  in_training boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 5. rem_targets — annual production targets by analyzer type
CREATE TABLE IF NOT EXISTS rem_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  target numeric NOT NULL,
  completed numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rem_targets_type ON rem_targets (type);

-- 6. rem_tracker_weekly — weekly tracker metrics per stage
CREATE TABLE IF NOT EXISTS rem_tracker_weekly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of text NOT NULL,
  teardown numeric DEFAULT 0,
  cleaning numeric DEFAULT 0,
  rebuild numeric DEFAULT 0,
  testing numeric DEFAULT 0,
  qa numeric DEFAULT 0,
  shipping numeric DEFAULT 0,
  complete numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 7. rem_weekly_notes — weekly production notes by product
CREATE TABLE IF NOT EXISTS rem_weekly_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_number numeric,
  week_start text,
  quarter text,
  notes jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 8. audit_rem — audit trail for all REM business-state mutations
CREATE TABLE IF NOT EXISTS audit_rem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  operation text NOT NULL, -- INSERT, UPDATE, DELETE
  actor_id text NOT NULL,  -- server-authenticated user identity
  actor_role text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_rem_table ON audit_rem (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_rem_actor ON audit_rem (actor_id);

-- RLS: Enable but revoke from all roles (server-only via service_role)
ALTER TABLE rem_analyzers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rem_build_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE rem_lvcc ENABLE ROW LEVEL SECURITY;
ALTER TABLE rem_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE rem_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rem_tracker_weekly ENABLE ROW LEVEL SECURITY;
ALTER TABLE rem_weekly_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_rem ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON rem_analyzers FROM anon, authenticated;
REVOKE ALL ON rem_build_plan FROM anon, authenticated;
REVOKE ALL ON rem_lvcc FROM anon, authenticated;
REVOKE ALL ON rem_staff FROM anon, authenticated;
REVOKE ALL ON rem_targets FROM anon, authenticated;
REVOKE ALL ON rem_tracker_weekly FROM anon, authenticated;
REVOKE ALL ON rem_weekly_notes FROM anon, authenticated;
REVOKE ALL ON audit_rem FROM anon, authenticated;
