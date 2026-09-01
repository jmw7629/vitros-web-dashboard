# VITROS Rebuild Audit — 2026-08-31

## Current stack
- **Frontend**: React 19 + Vite 7 + TypeScript 5.9 + TailwindCSS 4 + Radix UI
- **Backend**: Convex (schema-driven) + Supabase (RLS-locked, server-only via service_role)
- **Auth**: @convex-dev/auth with role-based capabilities (superuser/engineer/viewer)
- **Linting**: Biome 2.3.10
- **Testing**: Playwright + custom Bun scripts
- **Deploy**: Vercel (staging)

## REM module status (Issue #48 scope)
- PR #46 (commit f5656d1) introduced `convex/remSupabase.ts` and `database/migrations/20260831_rem_supabase_tables.sql`
- **Blocker identified**: Migration used `CREATE TABLE IF NOT EXISTS` which does not add missing columns to already-existing live tables
- Live Supabase tables exist with minimal columns (id, data, created_at only for some tables)
- `convex/remSupabase.ts` expects columns absent from live production (stage, progress, status, notes, etc.)
- JSONB fields (certifications, skills) written via `JSON.stringify()` — produces JSON strings not native JSONB objects
- No business validation on numeric fields (0-100 percentages, FTE bounds, days >= 0)
- `v.any()` used for certifications/skills in schema and Convex validation

## Files changed in this correction
- `database/migrations/20260831_rem_supabase_tables.sql` — rewritten to use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for existing tables
- `convex/remSupabase.ts` — strict validation, bounded structures, native JSONB persistence
- `convex/schema.ts` — replace `v.any()` with bounded validators for certifications/skills
- `scripts/rem-live-schema-compat-test.ts` — new: live schema compatibility test
- `docs/REBUILD_AUDIT.md` — this file

## Checks run
- `npx tsc --noEmit` — PASS (0 errors)
- `npx biome check` — PASS on all changed files (pre-existing issues in unrelated files excluded)
- `node scripts/check-secrets.mjs` — PASS (no hardcoded credentials)
- `git diff --check` — PASS (no whitespace errors)
- `npx biome check --write --unsafe` — applied safe auto-fixes to all changed files
