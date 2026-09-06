-- Least-privilege containment for DHR and REM base tables.
--
-- Browser clients must traverse the authenticated Convex/server boundary. These
-- base tables intentionally have RLS enabled with no browser policies; remove
-- legacy table ACLs as defense in depth so a future policy change cannot silently
-- turn dormant grants into a browser data/mutation path.
--
-- This migration does not create policies, change rows, alter business logic, or
-- change service_role grants.

alter table public.dhr_checklist_sections enable row level security;
alter table public.dhr_expected_parts enable row level security;
alter table public.dhr_folders enable row level security;
alter table public.dhr_scan_sessions enable row level security;
alter table public.dhr_scan_results enable row level security;
alter table public.dhr_scan_result_events enable row level security;

alter table public.rem_analyzers enable row level security;
alter table public.rem_build_plan enable row level security;
alter table public.rem_import_runs enable row level security;
alter table public.rem_lvcc enable row level security;
alter table public.rem_staff enable row level security;
alter table public.rem_targets enable row level security;
alter table public.rem_tracker_weekly enable row level security;
alter table public.rem_weekly_notes enable row level security;

revoke all privileges on table public.dhr_checklist_sections from anon, authenticated;
revoke all privileges on table public.dhr_expected_parts from anon, authenticated;
revoke all privileges on table public.dhr_folders from anon, authenticated;
revoke all privileges on table public.dhr_scan_sessions from anon, authenticated;
revoke all privileges on table public.dhr_scan_results from anon, authenticated;
revoke all privileges on table public.dhr_scan_result_events from anon, authenticated;

revoke all privileges on table public.rem_analyzers from anon, authenticated;
revoke all privileges on table public.rem_build_plan from anon, authenticated;
revoke all privileges on table public.rem_import_runs from anon, authenticated;
revoke all privileges on table public.rem_lvcc from anon, authenticated;
revoke all privileges on table public.rem_staff from anon, authenticated;
revoke all privileges on table public.rem_targets from anon, authenticated;
revoke all privileges on table public.rem_tracker_weekly from anon, authenticated;
revoke all privileges on table public.rem_weekly_notes from anon, authenticated;
