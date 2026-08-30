# VITROS Implementation Status

## Phase 1: Secure Data Boundary and Staging-Ready Build

### Completed
- [x] Removed hardcoded Supabase service_role key from all frontend files
  - `src/hooks/useConvexData.tsx` — replaced with env var + Convex actions
  - `src/pages/inventory/IncomingStock.tsx` — replaced with Convex actions
  - `src/pages/inventory/DhrScanner.tsx` — replaced with Convex actions
- [x] Removed hardcoded Convex deployment URLs from frontend
  - `src/pages/inventory/CycleCount.tsx` — now uses `VITE_CONVEX_URL`
- [x] Created server-side Supabase gateway (`convex/supabaseGateway.ts`)
  - All inventory reads via anon key (RLS-protected)
  - All writes via Convex actions with service_role key (server-side)
  - DHR Scanner operations via Convex actions
  - Storage operations via Convex actions
- [x] Created server-side AI/OCR gateway (`convex/aiGateway.ts`)
  - OpenAI calls moved to Convex actions
  - Image size/type validation enforced server-side
  - Error sanitization implemented
- [x] Implemented authorization foundation (`convex/authGuard.ts`)
  - Role-based capability system (superuser/engineer/viewer)
  - Server-side auth checks on all privileged operations
  - Authenticated identity required for mutations
- [x] Updated `.env.example` with all required variable names
- [x] Updated TypeScript declarations (`vite-env.d.ts`)
- [x] Added ConvexProvider to app for proper auth context
- [x] Documentation created
  - `docs/SECURITY_MODEL.md`
  - `docs/RUNBOOK.md`
  - `docs/IMPLEMENTATION_STATUS.md` (this file)

### Build Status
- `npm ci` — pending verification
- `npm run typecheck` — pending verification
- `npm run build` — pending verification

### Remaining Risks
1. **RLS policies unverified** — anon-key reads assume RLS is configured on Supabase
2. **Test user credentials** — `seedTestUser.ts` and `scripts/testUser.ts` contain test passwords (lower risk, only active in preview mode)
3. **Convex schema not regenerated** — new gateway functions need `npx convex dev` to regenerate API types
4. **CycleCount.tsx** — uses Convex raw HTTP for cycle count data; if that Convex deployment changes, it needs updating

### Out of Scope (per issue)
- Credential rotation
- Production deployment
- SAP posting
- Supabase data migration
- Universal editability
- Full RBAC system
