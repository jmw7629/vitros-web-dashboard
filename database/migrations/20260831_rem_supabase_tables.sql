-- REM Module: Authoritative Supabase tables
-- Issue #48 correction: genuinely additive, data-preserving for existing tables
-- Uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS for tables that may already exist
-- Does NOT drop/recreate or bulk overwrite live data

-- 1. rem_analyzers — tracks each analyzer build/service lifecycle
-- Live table may already exist with core fields; add missing columns safely
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rem_analyzers') THEN
    CREATE TABLE rem_analyzers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      serial_number text NOT NULL,
      created_at timestamptz DEFAULT now()
    );
  END IF;
END $$;

ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS analyzer_type text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS progress numeric;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS year_number text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS production_order text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS current_stage text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS overall_pct numeric DEFAULT 0;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS procurement_pct numeric DEFAULT 0;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS cleaning_pct numeric DEFAULT 0;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS service_pct numeric DEFAULT 0;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS service_cell text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS final_line_pct numeric DEFAULT 0;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS release_testing_pct numeric DEFAULT 0;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS packaging_pct numeric DEFAULT 0;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS sap_release_pct numeric DEFAULT 0;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS qa_release_pct numeric DEFAULT 0;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS current_pct numeric DEFAULT 0;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS sla_days numeric DEFAULT 0;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS days_in_stage numeric DEFAULT 0;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS days_elapsed numeric DEFAULT 0;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS start_date text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS end_date text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS done_week text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS is_complete boolean DEFAULT false;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS install_date text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS install_country text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS install_status text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS install_cost numeric;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS fpy_percentage numeric;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS release_fpy numeric;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS field_status text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS fpy numeric;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE rem_analyzers ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_rem_analyzers_serial ON rem_analyzers (serial_number);

-- 2. rem_build_plan — weekly build plan data
-- Live table may exist with id,data,created_at; add missing columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rem_build_plan') THEN
    CREATE TABLE rem_build_plan (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz DEFAULT now()
    );
  END IF;
END $$;

ALTER TABLE rem_build_plan ADD COLUMN IF NOT EXISTS week_of text NOT NULL DEFAULT '';
ALTER TABLE rem_build_plan ADD COLUMN IF NOT EXISTS planned numeric DEFAULT 0;
ALTER TABLE rem_build_plan ADD COLUMN IF NOT EXISTS actual numeric DEFAULT 0;
ALTER TABLE rem_build_plan ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE rem_build_plan ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 3. rem_lvcc — level of completion tracker for LVCC items
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rem_lvcc') THEN
    CREATE TABLE rem_lvcc (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz DEFAULT now()
    );
  END IF;
END $$;

ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS serial_number text;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS item_id text;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS item_type text;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS batch_number text;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS quantity numeric;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS current_stage text;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS build_pct numeric DEFAULT 0;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS test_pct numeric DEFAULT 0;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS packaging_pct numeric DEFAULT 0;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS sap_release_pct numeric DEFAULT 0;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS qa_release_pct numeric DEFAULT 0;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS start_date text;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS end_date text;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS is_complete boolean DEFAULT false;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS progress numeric DEFAULT 0;
ALTER TABLE rem_lvcc ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 4. rem_staff — staff/certification data
-- Live table may exist but without fte, is_lead, in_training, updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rem_staff') THEN
    CREATE TABLE rem_staff (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      role text NOT NULL,
      created_at timestamptz DEFAULT now()
    );
  END IF;
END $$;

ALTER TABLE rem_staff ADD COLUMN IF NOT EXISTS fte numeric;
ALTER TABLE rem_staff ADD COLUMN IF NOT EXISTS certifications jsonb;
ALTER TABLE rem_staff ADD COLUMN IF NOT EXISTS skills jsonb;
ALTER TABLE rem_staff ADD COLUMN IF NOT EXISTS is_lead boolean DEFAULT false;
ALTER TABLE rem_staff ADD COLUMN IF NOT EXISTS in_training boolean DEFAULT false;
ALTER TABLE rem_staff ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 5. rem_targets — annual production targets by analyzer type
-- Live table has year,target_type,target_value,actual_value,data,created_at
-- Add columns for our Convex fields (type,target,completed) alongside existing ones
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rem_targets') THEN
    CREATE TABLE rem_targets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz DEFAULT now()
    );
  END IF;
END $$;

ALTER TABLE rem_targets ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE rem_targets ADD COLUMN IF NOT EXISTS target numeric NOT NULL DEFAULT 0;
ALTER TABLE rem_targets ADD COLUMN IF NOT EXISTS completed numeric NOT NULL DEFAULT 0;
ALTER TABLE rem_targets ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_rem_targets_type ON rem_targets (type);

-- 6. rem_tracker_weekly — weekly tracker metrics per stage
-- Live table may exist with id,data,created_at; add missing columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rem_tracker_weekly') THEN
    CREATE TABLE rem_tracker_weekly (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz DEFAULT now()
    );
  END IF;
END $$;

ALTER TABLE rem_tracker_weekly ADD COLUMN IF NOT EXISTS week_of text NOT NULL DEFAULT '';
ALTER TABLE rem_tracker_weekly ADD COLUMN IF NOT EXISTS teardown numeric DEFAULT 0;
ALTER TABLE rem_tracker_weekly ADD COLUMN IF NOT EXISTS cleaning numeric DEFAULT 0;
ALTER TABLE rem_tracker_weekly ADD COLUMN IF NOT EXISTS rebuild numeric DEFAULT 0;
ALTER TABLE rem_tracker_weekly ADD COLUMN IF NOT EXISTS testing numeric DEFAULT 0;
ALTER TABLE rem_tracker_weekly ADD COLUMN IF NOT EXISTS qa numeric DEFAULT 0;
ALTER TABLE rem_tracker_weekly ADD COLUMN IF NOT EXISTS shipping numeric DEFAULT 0;
ALTER TABLE rem_tracker_weekly ADD COLUMN IF NOT EXISTS complete numeric DEFAULT 0;
ALTER TABLE rem_tracker_weekly ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 7. rem_weekly_notes — weekly production notes by product
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rem_weekly_notes') THEN
    CREATE TABLE rem_weekly_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz DEFAULT now()
    );
  END IF;
END $$;

ALTER TABLE rem_weekly_notes ADD COLUMN IF NOT EXISTS week_number numeric;
ALTER TABLE rem_weekly_notes ADD COLUMN IF NOT EXISTS week_start text;
ALTER TABLE rem_weekly_notes ADD COLUMN IF NOT EXISTS quarter text;
ALTER TABLE rem_weekly_notes ADD COLUMN IF NOT EXISTS notes jsonb;
ALTER TABLE rem_weekly_notes ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 8. audit_rem — audit trail for all REM business-state mutations (new table, safe to CREATE)
CREATE TABLE IF NOT EXISTS audit_rem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  operation text NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_rem_table ON audit_rem (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_rem_actor ON audit_rem (actor_id);

-- Auto-update updated_at timestamp on row changes
CREATE OR REPLACE FUNCTION update_rem_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_rem_analyzers_updated_at') THEN
    CREATE TRIGGER set_rem_analyzers_updated_at
      BEFORE UPDATE ON rem_analyzers
      FOR EACH ROW EXECUTE FUNCTION update_rem_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_rem_build_plan_updated_at') THEN
    CREATE TRIGGER set_rem_build_plan_updated_at
      BEFORE UPDATE ON rem_build_plan
      FOR EACH ROW EXECUTE FUNCTION update_rem_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_rem_lvcc_updated_at') THEN
    CREATE TRIGGER set_rem_lvcc_updated_at
      BEFORE UPDATE ON rem_lvcc
      FOR EACH ROW EXECUTE FUNCTION update_rem_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_rem_staff_updated_at') THEN
    CREATE TRIGGER set_rem_staff_updated_at
      BEFORE UPDATE ON rem_staff
      FOR EACH ROW EXECUTE FUNCTION update_rem_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_rem_targets_updated_at') THEN
    CREATE TRIGGER set_rem_targets_updated_at
      BEFORE UPDATE ON rem_targets
      FOR EACH ROW EXECUTE FUNCTION update_rem_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_rem_tracker_weekly_updated_at') THEN
    CREATE TRIGGER set_rem_tracker_weekly_updated_at
      BEFORE UPDATE ON rem_tracker_weekly
      FOR EACH ROW EXECUTE FUNCTION update_rem_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_rem_weekly_notes_updated_at') THEN
    CREATE TRIGGER set_rem_weekly_notes_updated_at
      BEFORE UPDATE ON rem_weekly_notes
      FOR EACH ROW EXECUTE FUNCTION update_rem_updated_at();
  END IF;
END $$;

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
