# VITROS Implementation Status — Phase 1B

## Completed in This Branch

### Convex Backend
- [x] `convex/authGuard.ts` — Role/capability system with `requireCapability()` for queries/mutations and `requireCapabilityAction()` for actions
- [x] `convex/supabaseGateway.ts` — Server-side Supabase data gateway (all reads/writes through Convex actions with server-side credentials)
- [x] `convex/aiGateway.ts` — Server-side OpenAI/OCR gateway (validates inputs, retries, sanitizes errors)
- [x] `convex/inventoryActions.ts` — Validated domain-specific inventory transitions (scanStockTransition, createStockItem, updateStockItem, deleteStockItem, SAP status mutations)
- [x] `convex/users.ts` — Extended with `getUserRole`, `getMyProfile`, `updateMyProfile` queries/mutations
- [x] `convex/auth.ts` — Updated currentUser to return role field
- [x] `convex/schema.ts` — authTables preserved, existing schema preserved

### Frontend
- [x] `src/main.tsx` — Uses `ConvexAuthProvider` from `@convex-dev/auth/react` (fixes Defect C)
- [x] `src/App.tsx` — Auth gating: unauthenticated → sign-in; authenticated → main app
- [x] `src/hooks/useConvexData.tsx` — All reads/writes routed through Convex actions; hardcoded secrets removed
- [x] `src/hooks/useRole.tsx` — Server-authoritative role from Convex user record; localStorage is presentation-only mirror
- [x] `src/pages/inventory/DhrScanner.tsx` — Hardcoded Supabase keys removed; reads use anon key
- [x] `src/pages/inventory/IncomingStock.tsx` — Hardcoded Supabase keys removed; OCR learning routed server-side
- [x] `src/vite-env.d.ts` — Added VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

### Infrastructure
- [x] `.env.example` — Corrected to distinguish client/server variables
- [x] `.github/workflows/ci.yml` — CI pipeline: install, typecheck, build, secret scan, lint, git diff check
- [x] `scripts/check-secrets.mjs` — Secret pattern regression scanner

### Documentation
- [x] `docs/SECURITY_MODEL.md` — Client/server secret split, data flow, authorization model
- [x] `docs/RUNBOOK.md` — Staging deployment sequence, verification, rollback
- [x] `docs/IMPLEMENTATION_STATUS.md` — This file

## Blocking Defects Corrected

| Defect | PR #4 Problem | Fix Applied |
|--------|--------------|-------------|
| A. External fetch in queries | `supabaseGateway` queries called `fetch()` | All external fetch in actions only |
| B. `ctx.db` in actions | `authGuard.ts` cast ActionCtx and called `ctx.db` | Actions use `ctx.runQuery()` via internal query |
| C. Missing ConvexAuthProvider | Plain `ConvexProvider` or none | `ConvexAuthProvider` from `@convex-dev/auth/react` |
| D. Client-side role authority | localStorage role authorized operations | Server role from Convex user record is authoritative |
| E. Inventory reads bypass server | Browser-side Supabase with service_role key | Routed through Convex actions with server-side credentials |
| F. Arbitrary v.any() mutations | Generic row mutations for privileged ops | Domain-specific validated actions (scanStockTransition, etc.) |
| G. Environment mismatch | Secrets in frontend, wrong variable names | Corrected .env.example, secrets server-only |

## Remaining Risks

1. **Supabase RLS not verified**: Anon key fallback reads assume RLS is configured correctly. If RLS is not enforced, anon reads could expose data.
2. **Multi-request atomicity**: Inventory transitions span multiple Supabase requests (stock update + audit + SAP staging). Partial failure is documented per-operation but not transactional.
3. **Convex deploy validation**: `npx convex dev --once` cannot be run without deploy credentials. TypeScript compilation verifies types but not runtime correctness.
4. **REM data gap**: REM tracker reads bypass the auth gateway (served from Convex production backend directly).
5. **Credential rotation**: The old Supabase service-role key is compromised. Rotation is an external prerequisite before production.

## Out of Scope (Phase 1B)

- Dashboard redesign, navigation changes, card/chart styling
- REM module completion
- Analytics/reporting improvements
- Universal editability/configuration control plane
- PWA/mobile hardening, accessibility, full E2E tests
