-- DISPOSABLE TESTS ONLY — NEVER RUN IN PRODUCTION
-- Pristine disposable DB bootstrap for PostgreSQL 17 CI, PostgreSQL 17 synthetic verification.
-- Fails if objects already exist; does not DROP or clean production tables.
-- Creates roles and exact fresh live schema for convex_employees, then inserts clearly synthetic rows.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE TABLE public.convex_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  initials text NOT NULL,
  active boolean DEFAULT true,
  convex_id text,
  created_at timestamptz DEFAULT now()
);

-- Synthetic existing row with fixed id/timestamp for preservation check
INSERT INTO public.convex_employees (id, name, initials, active, convex_id, created_at)
VALUES ('11111111-1111-1111-1111-111111111111'::uuid, 'Synthetic Existing SE', 'SE', true, 'synthetic-convex-001', '2025-01-01 00:00:00+00'::timestamptz);

-- Synthetic nullable-active/null-date row for preservation check (active and created_at remain NULL after migration)
INSERT INTO public.convex_employees (id, name, initials, active, created_at)
VALUES ('22222222-2222-2222-2222-222222222222'::uuid, 'Synthetic Nullable SN', 'SN', NULL, NULL);
