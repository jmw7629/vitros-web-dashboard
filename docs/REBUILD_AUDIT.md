# VITROS Rebuild Audit — Phase 0

**Date:** 2026-08-30
**Auditor:** OpenCode (implementation executor)
**Issue:** #1 — [OC] VITROS Recovery Phase 0 — restore build, backend and deployment truth

---

## 1. Current Architecture

```
┌─────────────────────────────────────────────────┐
│                    Browser                       │
│                                                  │
│  React 19 + Vite 7 + Tailwind CSS 4             │
│  React Router 7 (SPA, BrowserRouter)             │
│  ┌───────────────────────────────────────────┐   │
│  │ VitrosLayout → TopNavBar + AppSidebar     │   │
│  │ Content Area (max-w-800px)                │   │
│  │   ├── Inventory Routes (20 pages)         │   │
│  │   ├── REM Routes (13 pages)               │   │
│  │   ├── Report Routes (4 pages)             │   │
│  │   └── Settings (1 page)                   │   │
│  └───────────────────────────────────────────┘   │
│                                                  │
│  Data Layer: useConvexData (React Context)        │
│  ┌───────────────────────────────────────────┐   │
│  │ Supabase REST API (inventory)             │   │
│  │   stock, audit_log, sap_staging,          │   │
│  │   users, settings                         │   │
│  │ Convex HTTP API (REM + kits + employees)  │   │
│  │   accurate-newt-938.convex.cloud          │   │
│  │ Convex HTTP API (cycle count)             │   │
│  │   terrific-snail-972.convex.cloud         │   │
│  └───────────────────────────────────────────┘   │
│                                                  │
│  Auth: Dual system                               │
│  ├── RoleLogin (localStorage role, hardcoded pw) │
│  └── Convex Auth (email/password via Viktor)     │
└─────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌──────────────────┐  ┌──────────────────┐
│   Supabase       │  │   Convex         │
│   PostgreSQL     │  │   Realtime DB    │
│   (inventory)    │  │   (REM, kits,    │
│                  │  │    employees,    │
│                  │  │    cycle count)  │
└──────────────────┘  └──────────────────┘
         │
         ▼
┌──────────────────┐
│  SAP (external)  │
│  Async staging   │
└──────────────────┘
```

### Stack Versions

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | 26.7.0 | VPS runtime |
| npm | 11.19.0 | Package manager (primary) |
| bun | Not installed | Scripts reference `bun run` but bun unavailable |
| TypeScript | ~5.9.3 | Via devDependencies |
| Vite | ^7.2.4 | Build tool |
| React | ^19.2.0 | UI framework |
| React Router | ^7.11.0 | SPA routing |
| Tailwind CSS | ^4.1.18 | Via @tailwindcss/vite plugin |
| Convex | ^1.31.2 | Backend (production client) |
| Convex CLI | 1.31.2 | npx convex |
| Biome | ^2.3.10 | Linter/formatter |
| Playwright | ^1.57.0 | E2E testing |
| shadcn/ui | new-york style | Via components.json |
| Framer Motion | ^12.23.22 | Animations |
| Recharts | ^2.15.2 | Charts |
| ZXing WASM | ^3.0.3 | Barcode scanning |
| xlsx | ^0.18.5 | Excel import/export |
| file-saver | ^2.0.5 | Download helper |
| Zod | ^4.1.12 | Schema validation |
| lucide-react | ^0.562.0 | Icons |

### Package Manager Situation

- **Both `package-lock.json` (3953 lines) and `bun.lock` (856 lines) exist**
- `package-lock.json` was **out of sync** with `package.json` — `npm ci` failed
- Ran `npm install` to regenerate `package-lock.json` (this was the only code change needed)
- `bun.lock` was not updated (bun not installed on VPS)
- Several scripts reference `bun run --bun` and `bunx` — these will fail without bun

### Build Tool and Scripts

| Script | Command | Status |
|--------|---------|--------|
| `dev` | `vite` | Should work |
| `build` | `tsc -b && vite build` | **Passes** |
| `preview` | `vite preview` | Should work |
| `check` | `biome check .` | Works (reports existing issues) |
| `format` | `biome check --write .` | Works |
| `lint` | `biome lint .` | Works (85 errors, 70 warnings in existing code) |
| `typecheck` | `tsc --noEmit` | **Passes** |
| `sync` | `bunx convex dev --once` | **Fails** — requires bun |
| `sync:build` | `bunx convex dev --once && bun run build` | **Fails** — requires bun |
| `logs` | `bunx convex logs` | **Fails** — requires bun |
| `test` | `bun run --bun scripts/test.ts` | **Fails** — requires bun |
| `test:auth` | `bun run --bun scripts/auth.ts` | **Fails** — requires bun |
| `test:demo` | `bun run --bun scripts/demo-test.ts` | **Fails** — requires bun |

---

## 2. Build/Test Results

### Environment Check

```
node --version    → v26.7.0          ✓
npm --version     → 11.19.0          ✓
bun --version     → bun not installed ✗
npx convex --version → 1.45.0       ✓
vercel --version  → not installed    ✗
git status --short → (clean after npm install updated package-lock.json)
```

### npm install (replacing failed npm ci)

```
Result: SUCCESS (after npm install)
added 281 packages, audited 282 packages in 45s
12 vulnerabilities (1 low, 9 high, 2 critical)
```

The `npm ci` failed because `package-lock.json` was out of sync with `package.json` (missing `file-saver`, `xlsx`, `zxing-wasm`, `@types/file-saver`, and updated `lucide-react`/`@tailwindcss` versions). Running `npm install` regenerated the lock file.

### Production Build

```
Command: npm run build
Result: SUCCESS ✓
Output:
  dist/index.html              0.52 kB │ gzip:   0.33 kB
  dist/assets/index-DoP2kdzf.css  193.31 kB │ gzip:  27.04 kB
  dist/assets/index-ilGJpbiw.js   996.03 kB │ gzip: 292.39 kB
Build time: 14.27s
Warning: Chunk exceeds 500 kB (996 kB) — code splitting recommended
```

### TypeScript Typecheck

```
Command: npm run typecheck
Result: PASS ✓ (no errors)
```

### Biome Lint

```
Command: npm run lint
Result: 85 errors, 70 warnings, 49 infos (all in existing code)

Categories of issues:
- lint/style/useTemplate — string concatenation (6 occurrences)
- lint/correctness/noUnusedImports — unused imports (5 files)
- lint/correctness/noUnusedVariables — unused variables (3 files)
- lint/complexity/noBannedTypes — '{}' type in generated file (1)
- lint/a11y/noLabelWithoutControl — accessibility (2)
- lint/a11y/noStaticElementInteractions — accessibility (1)
- lint/a11y/noSvgWithoutTitle — SVG accessibility (1)
- lint/complexity/useOptionalChain — optional chaining (1)

All issues are in existing source files, not new regressions.
```

### Test Scripts

```
Command: npm run test
Result: FAILS — requires bun runtime
Command: npm run test:auth
Result: FAILS — requires bun runtime
Command: npm run test:demo
Result: FAILS — requires bun runtime
```

---

## 3. Convex Status

### Backend Connection

- **Production Convex instance:** `accurate-newt-938.convex.cloud`
  - Used for: REM data, employees, kits
- **Dev Convex instance:** `terrific-snail-972.convex.cloud`
  - Used for: Cycle count schedules/results
- **Convex CLI:** v1.45.0 available via `npx convex`
- **No local `.env` file** — `VITE_CONVEX_URL` is not set locally
- **No local Convex dev session** — the `sync` script requires bun
- **`convex/_generated/`** files exist (api.d.ts, api.js, dataModel.d.ts, server.d.ts, server.js) — these are pre-generated and sufficient for build

### Schema

14 tables defined in `convex/schema.ts`:

| Table | Purpose | Indexes |
|-------|---------|---------|
| `parts` | Inventory parts (backward compat) | `by_partNumber`, `by_type` |
| `transactions` | Inventory transactions (backward compat) | `by_partNumber`, `by_timestamp`, `by_sapStatus` |
| `kits` | Kit definitions | `by_kitId` |
| `employees` | Staff roster | `by_initials` |
| `cycleSchedules` | Cycle count schedules | `by_status`, `by_nextDue` |
| `cycleResults` | Cycle count results | `by_scheduleId`, `by_timestamp` |
| `dhrFolders` | DHR document folders | `by_instrumentSN` |
| `incomingBatches` | Incoming stock batches | `by_status` |
| `remAnalyzers` | REM analyzer tracking | `by_serialNumber` |
| `lvccItems` | LVCC items | (none) |
| `annualTargets` | Annual production targets | `by_type` |
| `staffMembers` | REM staff matrix | (none) |
| `weeklyNotes` | REM weekly notes | (none) |
| `appSettings` | Application settings | `by_key` |

Plus `authTables` from `@convex-dev/auth/server`.

### Important Schema Note

The schema comment states: *"Production data is now in Supabase. This schema is kept for backward compatibility with the dev Convex instance only."* This means the Convex tables in schema.ts are **not the primary source of truth** for inventory — Supabase is.

### Functions Summary

| File | Functions | Quality |
|------|-----------|---------|
| `auth.ts` | convexAuth setup, signIn, signOut, currentUser | Complete |
| `auth.config.ts` | Provider config | Minimal |
| `transactions.ts` | list, getBySapStatus, scanPart, create | Functional |
| `parts.ts` | list, updatePart, deletePart, createPart | Functional (backward compat) |
| `cycleCount.ts` | 8 functions — schedules, results, CRUD, submit | Complete |
| `dhr.ts` | 7 functions — folders, lines, CRUD | Complete |
| `bulkImport.ts` | 7 functions — bulk inserts | **No validation/RBAC** |
| `rem.ts` | 9 queries + 1 mutation | Functional |
| `remAnalyzers.ts` | list (duplicate of rem.ts) | Redundant |
| `remBuildPlan.ts` | list → returns `[]` | **Stub** |
| `remLvcc.ts` | list (duplicate of rem.ts) | Redundant |
| `remStaffing.ts` | getTrainingMatrix (duplicate of rem.ts) | Redundant |
| `remTargets.ts` | list (duplicate of rem.ts) | Redundant |
| `remTracker.ts` | listWeekly → returns `[]` | **Stub** |
| `remWeeklyNotes.ts` | list (duplicate of rem.ts) | Redundant |
| `kits.ts` | list (read-only) | Minimal |
| `employees.ts` | list (minimal) | Minimal |
| `users.ts` | deleteAccount | Minimal |
| `seed.ts` | seedAll (no-op) | Placeholder |
| `seedTestUser.ts` | Creates dev test user | Dev only |
| `testAuth.ts` | Test auth provider | Dev only |
| `constants.ts` | APP_NAME = "My App" | **Wrong name** |
| `viktorTools.ts` | AI search, image gen | External API |
| `ViktorSpacesEmail.ts` | Email OTP provider | External API |

### Auth Setup

- Uses `@convex-dev/auth` with Password provider (ViktorSpacesEmail for verification)
- Test credentials provider conditionally enabled on preview/dev deployments only
- JWT/Private key decoding in `auth.ts` handles base64 and newline formats
- `auth.config.ts` uses `CONVEX_SITE_URL` env var

---

## 4. Vercel/Deployment Status

- **No `.vercel/` directory** — no local Vercel project linkage
- **`vercel.json` exists** with SPA rewrites: `{ "rewrites": [{ "source": "/((?!assets/).*)", "destination": "/index.html" }] }`
- **Vercel CLI not installed** on this VPS
- **No Vercel project or deployment information available** from this environment

---

## 5. Data/Auth/Security Findings

### Data Architecture

The application uses a **dual backend**:

1. **Supabase (PostgreSQL)** — Primary source for inventory data
   - Tables: `stock`, `audit_log`, `sap_staging`, `users`, `settings`, `ocr_learning`
   - Accessed via REST API with hardcoded credentials in client code
   - CRUD operations: `sbQuery`, `sbInsert`, `sbUpdate`, `sbDelete`

2. **Convex** — Secondary/parallel backend for REM + some inventory data
   - Two instances: `accurate-newt-938` (production REM) and `terrific-snail-972` (dev cycle count)
   - Accessed via HTTP API with hardcoded deployment URLs

### Security Issues (P0/P1)

| Severity | Issue | Location |
|----------|-------|----------|
| **P0** | Supabase `service_role` key hardcoded in client bundle | `useConvexData.tsx:6`, `DhrScanner.tsx`, `IncomingStock.tsx` |
| **P0** | Supabase `anon` key hardcoded in client bundle | `useConvexData.tsx:5` |
| **P0** | OpenAI API key exposed to client via `VITE_OPENAI_KEY` | `IncomingStock.tsx` |
| **P1** | Hardcoded superuser password "12345" | `RoleLogin.tsx` |
| **P1** | Hardcoded Convex deployment URLs in multiple files | `useConvexData.tsx`, `CycleCount.tsx` |
| **P1** | No RBAC on bulk import functions (accept `v.any()`) | `bulkImport.ts` |
| **P1** | Test credentials hardcoded in source | `seedTestUser.ts` |

### Auth Model

- **RoleLogin:** Client-side role selection stored in `localStorage`. Two roles: `superuser` (password: "12345") and `engineer` (no password). No server-side enforcement.
- **Convex Auth:** Full email/password auth via `@convex-dev/auth` + ViktorSpacesEmail. Used by SignIn/SignUp components. Only available on Convex-connected routes.
- **No unified auth model** — the two systems coexist. RoleLogin gates the main app, while Convex Auth gates the Convex-connected features.

### Transaction Ledger

The `useConvexData` context implements the transaction flow:
- `scanPart()` creates audit_log entries in Supabase with `old_value`/`new_value` (before/after state)
- Each scan also creates a `sap_staging` record
- The audit_log serves as the transaction ledger (actor, timestamp, before/after)
- **However:** No idempotency keys, no correlation IDs, no server-side authorization checks

### SAP Staging

- Records created in Supabase `sap_staging` table on each scan
- Status flow: `pending` → `ready` → `posted`
- UI allows bulk select and status changes
- **No actual SAP connection** — all SAP operations are client-side status updates in Supabase
- The `sap_staging` table tracks: part_number, description, movement_type, plant_code, storage_location, qty, status

---

## 6. Critical Blockers

### P0 — Must Fix Before Deployment

| # | Blocker | Evidence |
|---|---------|----------|
| 1 | **Supabase service_role key exposed in client bundle** | `useConvexData.tsx:6`, `DhrScanner.tsx`, `IncomingStock.tsx` — anyone can use this key to bypass RLS |
| 2 | **No `.env` file for local development** | Only `.env.example` exists; `VITE_CONVEX_URL` not configured locally |
| 3 | **Hardcoded credentials in source code** | Multiple files contain Supabase keys, Convex URLs, OpenAI keys |

### P1 — Should Fix Soon

| # | Blocker | Evidence |
|---|---------|----------|
| 4 | **Role-based auth is client-only** | `RoleLogin.tsx` stores role in localStorage; no server-side enforcement |
| 5 | **`package-lock.json` was out of sync** | `npm ci` failed; fixed by `npm install` (this change is in working tree) |
| 6 | **Scripts require bun (not installed)** | `sync`, `test`, `test:auth`, `test:demo` scripts all use `bun run` |
| 7 | **Vercel CLI not installed** | Cannot deploy or check deployment status from this VPS |
| 8 | **`constants.ts` exports "My App" not "VITROS"** | `convex/constants.ts:1`, `src/lib/constants.ts:1` |

### P2 — Should Address in Phase 1

| # | Issue | Evidence |
|---|-------|----------|
| 9 | No PWA/service worker | No manifest.json, no SW files, no registration code |
| 10 | Significant code duplication in Convex functions | `rem.ts` duplicates 7 individual `rem*.ts` files |
| 11 | Stub functions returning empty arrays | `remBuildPlan.ts`, `remTracker.ts` |
| 12 | No RBAC on bulk import functions | `bulkImport.ts` accepts `v.any()` arrays |
| 13 | No idempotency/correlation on transactions | `scanPart()` has no idempotency keys |
| 14 | No audit trail for Convex mutations | Most mutations don't log actor/timestamp |
| 15 | Large bundle size (996 kB) | No code splitting configured |
| 16 | Accessibility issues in lint | Labels without controls, static elements without roles |

---

## 7. Shortest Recovery Path to Live Browser Build

The application **already builds successfully**. The shortest path to a live deployment:

1. **Fix the security-critical credential exposure** (move Supabase keys to env vars proxied through a backend or Edge function)
2. **Install bun** on the VPS (or refactor scripts to use npm/npx)
3. **Set up `.env`** with `VITE_CONVEX_URL` pointing to the correct Convex deployment
4. **Create a Vercel project** and connect it to the Git repository
5. **Configure environment variables** in Vercel dashboard (Supabase URL, keys, Convex URL, OpenAI key)
6. **Deploy** — the build already succeeds

**Estimated effort:** 2-4 hours for a minimal deploy, excluding the security hardening (which is a larger task).

---

## 8. Gap Analysis Against VITROS Requirements

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| **Authoritative transaction ledger** | Audit log in Supabase with before/after state | No idempotency keys, no correlation IDs, no server-side validation |
| **Server RBAC** | Client-only role in localStorage | No server-side authorization on any mutation |
| **Audit for all writes** | Supabase audit_log for inventory scans | No audit for Convex mutations (REM, cycle count, DHR) |
| **Idempotent writes** | No idempotency on any mutation | Full gap |
| **Asynchronous SAP** | SAP staging table exists, status flows client-side | No actual SAP connection; purely UI-driven status changes |
| **Mobile scanning** | ZXing WASM barcode scanner implemented | Functional but no PWA/offline support |
| **Deterministic metrics/reports** | 4 report pages exist (Executive, Mobile, Preview, Upload) | Reports read from Supabase; no validated metric definitions |
| **Universal admin editability** | Hard-coded themes, routes, labels, nav structure | No admin configuration system |
| **PWA/service worker** | None | Full gap |
| **Testing** | Playwright scripts exist but require bun | No CI, no tests runnable from this VPS |
| **Server-side audit trail** | Supabase audit_log for inventory only | REM/Cycle/DHR mutations not audited |

---

## 9. Phase 1 Issue Proposal

### Goal: Production Restoration

**Title:** `[OC] Phase 1 — Security hardening, env config, and minimal deployment`

**Objective:** Get VITROS live in a browser with security-critical issues resolved, while preserving all existing functionality.

**Scope:**

1. **Environment variable migration** — Remove all hardcoded credentials from source code. Move Supabase URL/key, Convex URLs, OpenAI key to `import.meta.env.VITE_*` variables. Update `.env.example`.

2. **Server-side role enforcement** — Add Convex-side authorization checks to mutations. The RoleLogin system must be backed by server-side verification (at minimum, validate role against a Convex table).

3. **Script runner fix** — Either install bun on the VPS or convert all `bun run` scripts to use `npx tsx` or `node --loader tsx`.

4. **Constants fix** — Change `APP_NAME` from "My App" to "VITROS" in both `convex/constants.ts` and `src/lib/constants.ts`.

5. **Vercel deployment** — Install Vercel CLI, create project, configure env vars, deploy to staging.

6. **Basic CI** — Set up a GitHub Action that runs `npm ci && npm run build && npm run typecheck` on PR.

**Out of scope (deferred):**
- Full RBAC migration
- SAP integration
- PWA/offline
- Universal editability
- Code splitting/bundle optimization
- Full test suite migration from bun

**Acceptance criteria:**
- All hardcoded credentials removed from source
- `.env.example` documents all required variables
- `npm ci && npm run build && npm run typecheck` passes
- Deployed to Vercel staging with working inventory dashboard
- Role selection requires server-side verification
- No secrets in client bundle (verified via source inspection)
