# REBUILD_AUDIT.md — REM Module (Issue #44)

## Current Stack (pre-implementation)

- **Frontend**: React 19 + Vite 7 + TypeScript 5.9 + Tailwind 4 + Radix UI
- **Backend**: Convex 1.31 (serverless functions) + Supabase (PostgreSQL)
- **Auth**: @convex-dev/auth with email-based provider
- **Deployment**: Vercel (frontend), Convex cloud (backend), Supabase (database)

## REM Module State

### Data Architecture (BEFORE)

| Layer | Source | Tables |
|-------|--------|--------|
| Supabase (authoritative per issue) | `rem_analyzers`, `rem_build_plan`, `rem_lvcc`, `rem_staff`, `rem_targets`, `rem_tracker_weekly`, `rem_weekly_notes` | **DO NOT EXIST YET** — must be created |
| Convex (parallel, to be retired) | `remAnalyzers`, `lvccItems`, `annualTargets`, `staffMembers`, `weeklyNotes` | 5 tables in `convex/schema.ts` |
| Convex stubs | `remTracker`, `remBuildPlan` | Return empty arrays |

### Frontend Data Flow (BEFORE)

```
Browser → HTTP POST to convex.cloud/api/query → Convex queries → Convex DB
```

- `useConvexData.tsx` fetches REM data via direct HTTP to `https://accurate-newt-938.convex.cloud`
- No authenticated Convex actions used for REM reads
- No REM mutations wired in frontend
- EngineerKiosk "Update" button is non-functional (no onClick handler)

### Security (BEFORE)

- `rem.read` and `rem.write` capabilities defined in `authGuard.ts`
- No RBAC enforcement on REM queries (direct HTTP queries bypass auth)
- No audit logging for REM mutations
- `v.any()` used in `bulkImport.ts` for REM tables

### Issues to Fix

1. No Supabase REM tables exist — must create migration
2. REM reads bypass authentication (direct HTTP to Convex cloud)
3. No REM write mutations exist in production path
4. No audit logging for REM changes
5. `updateAnalyzer.notes` not wired to any backend
6. No typed validation for REM payloads
7. No real tests for REM production path
8. Two stub endpoints return empty arrays

## Implementation Plan

1. Create Supabase migration for 7 REM tables + audit_rem table
2. Create `convex/remSupabase.ts` with authenticated Convex actions
3. Update `useConvexData.tsx` to use Convex actions for REM
4. Wire EngineerKiosk with mutation + audit
5. Add typed validation (eliminate v.any() for REM)
6. Create `scripts/rem-production-path-test.ts` with real tests
7. Run lint + typecheck
