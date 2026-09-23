# VITROS Rebuild Audit

## REM source recovery and operational import implementation — 2026-09-13

This local continuation starts from reviewed main `97dc7158505bd36a6d46536a1161238288719bfb`. GitHub build and behavioral/database checks pass and no implementation PR remains open. The existing standalone VPS worker retains its workspace; its latest result reports a bubblewrap loopback permission failure before commands execute. This continuation uses disjoint local work to complete the missing REM operational import. It does not restart workers or change VPS ownership.

Both supplied recurring workbook copies were recovered privately from original conversation attachments, outside Git. They produce 25,388 operational records: 80 field-status batches, 79 installation-part lines, 25,155 certified-part lines, 58 LVCC review weeks, and 16 quarterly Summary targets. The Certified Parts Total footer is explicitly excluded and its control totals reconcile. Eighty-four certified lines have no source month; VISION has a TBD posting date. Existing production parser/actions have no persistence or reader for these sources; Field Status currently substitutes completed WIP analyzers. Certified equipment/part join keys repeat and cannot identify individual service lines. Source Summary LVCC targets differ from Tracker operating plans; recorded review counts can differ from listed identifiers. These distinct measures must be retained with provenance.

The reviewed main production attempt `dpl_DaZbokZDMu6zPTbM7kk9uFtEkacN` still fails at missing server-only `SUPABASE_SERVICE_ROLE_KEY`. OPENAI_API_KEY readiness remains unverified. No deployment gate is bypassed. No production business data or SAP transport is changed by this implementation. Production acceptance remains pending until reviewed deployment and real authenticated browser flows succeed.

The original Rev J DHR DOCX was recovered; the exact fillable PDF and field manifest were not. Historical page-count claims conflict (90 versus 102). This REM slice does not invent controlled field IDs or reconstruct the DHR template.

Full core-then-operational parsing of both original workbooks is blocked at `Tracker!AD24`, whose formula contains a literal broken Build Plan reference. There are 38 cached Tracker errors and adjacent week references are also misaligned. The parser now handles exact SCRAP exclusions explicitly; it still rejects corrupt formula values. A corrected source workbook is required. See [source integrity evidence](REM_WORKBOOK_SOURCE_INTEGRITY.md) and [implementation status](REM_OPERATIONAL_IMPLEMENTATION_20260913.md) for the distinction between passing component/transaction checks and pending production acceptance.

Updated: 2026-09-09

## Current stack and deployment

- Browser: React + Vite + TypeScript.
- Server boundary: Convex actions with server-only Supabase service-role access.
- Authoritative production data: Supabase project `vitros-ios` (`oykqiiydpwngasvzdthh`).
- Browser deployment: Vercel project `vitros-web-dashboard`, linked to `jmw7629/vitros-web-dashboard`.
- Current audited Git base for this change: `main` at `f64780874645400d95de4161a0c5e3bf821a3f4a`.

## Security / architecture invariants observed

- Inventory quantity transitions route through server-authoritative actions/RPCs; browser direct stock quantity patches are blocked.
- `sap_staging` has RLS enabled in production.
- Production `sap_staging` already contains authoritative workflow fields including `export_status`, `exported_at`, `exported_by`, and `correlation_id`.
- Production currently contains 195 SAP staging records, all with `export_status = 'pending'` at the time of this audit.
- SAP browser export must remain file/staging-only. No browser control in this work may post to production SAP.

## Confirmed SAP defect for the earlier slice

`src/pages/inventory/SapStaging.tsx` previously kept Ready/Exported workflow state in React `Set` objects. That state disappeared on reload or another browser and therefore was not enterprise-authoritative. The synchronized sticky table/header layout from merged PR #110 is working code and must be preserved.

## J32133 canonical duplicate reconciliation evidence — 2026-09-07

Production still contains the one intentionally quarantined canonical collision covered by #74/#86:

- raw `J32133`: description `Z ASSEMBLY`, QOH 2, min/max 1/1, on stocking plan, bin `Rack to right / F076`;
- raw `J32133 ` (trailing space): description `Z-Assembly`, QOH 0, min/max 0/0, not on plan, no bin.

Both rows were created at the same original import timestamp. Current immutable `audit_log` history shows seven historical records across the two raw keys: the two original INSERT snapshots and system-triggered metadata/activity UPDATE snapshots. No distinct inventory movement is recorded for the trailing-space row.

A production read-only reference inventory found zero `J32133`/`J32133 ` references in `consume_stock_log`, `incoming_stock_log`, `inventory_batch_lines`, `kit_components`, `shortages`, `stocking_plan`, `dhr_expected_parts`, `dhr_scan_results`, `dhr_scan_result_events`, `inventory_operations`, `sap_staging`, and `error_queue`; the trailing-space stock UUID is also not referenced by `dhr_scan_results.stock_id`. Historical `audit_log` rows are intentionally preserved unchanged.

The existing production containment index remains `stock_part_number_canonical_unique_except_legacy_j32133`, with canonical rule `UPPER(BTRIM(part_number))`; the canonical guard trigger rejects any new canonical duplicate. The #86 reconciliation migration therefore may safely choose the raw `J32133` row as survivor only if the trailing duplicate is still zero-QOH and all active references remain absent at transaction time. Any changed evidence must abort the migration rather than guess.

## Active workstream coordination

The J32133 reconciliation slice is database-only plus focused regression evidence. It does not modify browser UI, DHR/REM/Incoming Stock behavior, SAP posting, Convex authorization, or the shared refresh/concurrency provider. It removes the last intentional exception from canonical stock uniqueness only after transaction-time assertions pass.

## Required gates for J32133 reconciliation

- Exact-head normal CI and focused canonical-reconciliation security check.
- Transactional forced-rollback verification against current production schema/data; no persisted business change during pre-merge verification.
- Exact-head READY Vercel preview when quota permits.
- Independent exact-head verifier PASS before merge.
- Only after merge/review: apply the migration once, confirm one canonical J32133 row remains with unchanged physical QOH, immutable history remains queryable, and unconditional canonical uniqueness is active.
- No production SAP posting.

## Incoming stock material request completion — issue #377 (2026-09-09)

Factual evidence for completing the incoming-stock review/material-request slice. All statements describe repository state at this worktree; nothing below claims live-DB concurrency passes.

- The purely deterministic packing-list review behavior (parse/validate/match/aggregate/provenance) previously embedded in `convex/incomingStockActions.ts` is extracted into the side-effect-free production module `convex/incomingStockReview.ts` (exports `parseOcrArray`, `asString`, `asFiniteNumber`, `indexStockByCanonical`, `reviewOcrLines`, `computeSummary`, `computeAggregateSummary`, `MAX_OCR_JSON_CHARS`, `MAX_LINES`). It imports only `convex/incomingStockDeterministicIdentity.ts`; no auth, DB, network or environment access.
- `convex/incomingStockActions.ts` now calls that exact module after `requireCapability` + Supabase `stock` lookup; the module owns all match/aggregate/qty behavior and the action owns auth/DB/pulse side effects only. No review behavior is reimplemented in `incomingStockActions.ts`.
- `scripts/incoming-stock-acceptance.mjs` transpiles and executes the exact exported production functions (identity + review modules) in a sandbox against synthetic stock rows and OCR input. It no longer duplicates aggregate or qty validation; fixtures exercise exact PN + description mismatch, description-only/wrong-PN rejection, whitespace/case, unknown part, repeated same-PN lines kept distinct plus aggregate, 0/negative/non-integer/non-numeric qty rejection, multi-page provenance, same-input/re-review stability, and the SQL conflict ordering.
- The commit boundary keeps the user/display `documentRef` as entered/trimmed (`const documentRef = args.documentRef.trim()`) but derives the authoritative material request batch reference with the production `normalizeDocumentRef` (`const normalizedBatchRef = normalizeDocumentRef(args.documentRef)`) and sends `batchId: normalizedBatchRef` as `p_batch_id`. This matches the migration's `IS DISTINCT FROM` conflict check so differently-cased/whitespace-equivalent refs are idempotent while genuinely changed refs conflict. Acceptance fixture 16 and `incoming-stock-deterministic-identity-check.mjs` prove this.
- `scripts/migration-structural-gate.mjs` is a JS static structural checker run in CI without a disposable Postgres. It inspects the forward migration `database/migrations/20260909_extend_inventory_operations_with_material_request.sql` and fails unless the new columns are added and inserted, all five mismatch checks precede the duplicate return, batch/analyzer use `IS DISTINCT FROM`, service-role-only grants with SECURITY DEFINER and `search_path public, pg_temp` hold, the stock -> audit -> pending SAP staging chain remains, and no production SAP post exists. Its disclaimer states it is a static gate, not a live DB concurrency test.
- The old applied migrations are untouched; the forward migration stays additive. RBAC/service-role-only, RLS, atomic inventory path, audit, pending-SAP-only behavior and current VITROS UI are preserved.

## Remaining blockers after this worktree

- Production Vercel deployment credentials (deployment secrets/tokens) are not present in this environment; `npm run build` is local evidence only and no Vercel preview has been created for this worktree.
- No real (redacted) packing slips have been run through the browser image/PDF OCR -> review -> confirmed RECEIVE acceptance flow in this environment; browser/PWA acceptance remains unverified here.

## Standalone completion audit — 2026-09-12

- Scope: standalone workspace only; direct GitHub authorization supersedes historical bridge execution rules. Local branch fast-forwarded to PR #391 head `6a7a059d88bfd3723cc2bd84d4d731b80e0f7d9a`; supplied untracked handoffs preserved.
- React/Vite/Convex/Supabase architecture and existing routes remain. PR #391 CI and exact-head Vercel preview are green; independent review found employee lifecycle/legacy-data defects and merge is blocked.
- Latest main production deployment `dpl_8j3tGoB8awwUsSGUpw1pd8TodTEB` fails at `CONVEX_RUNTIME_ENV_SYNC=FAIL missing SUPABASE_SERVICE_ROLE_KEY`. It passes the deploy-key presence check; key validity is not proven by this pre-deploy failure. OPENAI runtime availability remains unverified. No deployment gate was bypassed.
- Live Supabase `oykqiiydpwngasvzdthh` public tables all have RLS enabled. Fresh read reports zero DHR result events and zero SAP post records. DHR production consumption acceptance remains unclaimed.
- No supplied XLSX, controlled PDF or packing-list images exist in this workspace. Notes cannot establish exact workbook mappings or controlled printable fidelity.
- REM import still lacks Field Status, LVCC DHR Reviews, Install Parts and Certified Parts payloads; DHR UI lacks full controlled non-part step fields/print representation. Incoming Stock capture/review/atomic RECEIVE exists but real-source browser acceptance is pending.
- Confirmed PR defects: canonical legacy initials do not match exact login filter; preserved null employee creation timestamps cause successful SQL writes to be reported as receipt failures; employee deactivation does not revoke existing Convex capabilities.
- Locked dependencies installed locally; npm reports eight dependency advisories (one low, one moderate, six high), not yet triaged. Local production build passed.

Standalone verification follow-up: canonical login/admin/reconciliation SQL and rollback fixtures pass in disposable embedded PostgreSQL; no production rows changed. Public login initial render passes desktop/emulated-iPhone smoke, while the currently served Engineer overlay fails dialog-role/Escape-focus inspection. Production-only dependency audit has zero findings (the eight installation advisories are development dependencies). See `docs/STANDALONE_COMPLETION_STATUS.md` for remaining source, credential and acceptance gates.
## 2026-09-14 — requested role-entry changes

The user confirmed that Superuser keeps password/PIN verification with a newly supplied value, while Engineer opens directly without entering credentials. The supplied secret belongs only in the server Scrypt-hash configuration; it must not be committed or embedded in the browser.

At baseline `34c6b1dd087aa6b2c685dd6715b0153f9afdded7`, `RoleLogin.tsx` requires an active employee's initials for Engineer and invokes Convex Auth's `vitros-role` provider for both roles. `auth.ts` resolves canonical employees through the service-only Supabase resolver and verifies Superuser against `VITROS_SUPERUSER_PASSWORD_HASH`. `useRole` reads the server's current user; local storage is a presentation hint. `authGuard.ts` grants Engineer inventory/REM read/write and OCR, but no inventory administration or system/user management. Named employee accounts are subject to the existing active/pending access barriers; the retired generic account is explicitly blocked.

The implementation will add explicit server-issued shared Engineer access without assigning a fictional employee identity or changing named employee lifecycle barriers. Material operations retain the existing authenticated server identity, immutable audit and atomic inventory path. Digital DHR still requires a canonical active employee and remains disabled pending the controlled artifact. The current source tree matches reviewed main; REM/DHR migrations are already applied and must not be replayed. Production configuration was updated by the user; its next deployment and login behavior require fresh verification.

Login implementation verification: the role-entry component now waits for a completed Convex Auth sign-in before navigation and prevents duplicate submissions. The distinct server-issued shared Engineer account is clamped to Engineer capability and shared attribution even if its mutable user profile is altered. Named employee access barriers and retired-account denial still apply. The custom Scrypt path now reserves one of six hourly attempts atomically before verification, retains failed/crashed attempts until expiry, and refunds only its own successful reservation. The built-in Password provider limiter does not cover this custom verifier.

Read-only Convex code generation, complete TypeScript checking and the production Vite build passed in the isolated VPS verification checkout. Eleven focused role/employee/security scripts passed, including eight actual React role-entry scenarios and eight server-handler scenarios. These tests use synthetic auth/database boundaries and do not establish production credential configuration or live sign-in success. PIN/hash values are absent from source and fixtures. Production release and live acceptance remain pending.

Credential ownership follow-up: the existing authenticated Convex administration connection permits the authorized PIN rotation without exposing its hash. Authentication credentials are now managed directly in Convex, as documented in `.env.example`; the Vercel runtime synchronization allowlist contains only the three integration settings. This prevents a stale Vercel hash from reverting a later PIN rotation. The integration-secret presence gate and coupled Convex/production build remain intact. The actual sync script passes behavioral checks for preview isolation, all missing-key failures before writes, exact integration allowlisting, private stdin, and fail-closed child errors; the static regression gate passes.

## 2026-09-14 — Universal customization implementation (issue #81)

Starting from the role-entry changes above. The goal is a server-authoritative enterprise configuration layer so the browser deployment functions as enterprise software.

### Admin capability/control inventory (REAL / PARTIAL / PLACEHOLDER)

| Control Area | Status | Notes |
|---|---|---|
| SAP Operational Settings (6 keys) | REAL | Versioned, audited, Supabase-backed, server RBAC |
| Employee Management | REAL | Cross-store lifecycle, versioned, Convex+Supabase |
| Part Master Management | REAL | Versioned, audited, Supabase-backed |
| Navigation / Sidebar | PLACEHOLDER | Hardcoded arrays in AppSidebar.tsx, not configurable |
| Route Labels | PLACEHOLDER | Hardcoded record in VitrosLayout.tsx |
| Dashboard Modules | PLACEHOLDER | No configurability |
| Theme / Colors | PARTIAL | 5 palettes in ThemeContext.tsx, user-selectable via localStorage but not admin-editable |
| Roles / Capabilities | PLACEHOLDER | Hardcoded in authGuard.ts (3 roles, 8 capabilities) |
| Feature Flags | PLACEHOLDER | No runtime feature flag system |
| Table Columns / Layouts | PLACEHOLDER | No configurable column definitions |
| Chart Definitions | PLACEHOLDER | Hardcoded per page |
| Report Definitions | PLACEHOLDER | No admin-editable report config |
| Kit Configuration | REAL (via Part Master) | Managed through part master and kits table |
| REM Configuration | PARTIAL | REM data is in Convex; config surface incomplete |
| DHR Binding Configuration | PLACEHOLDER | Controlled-document prerequisites not met; disabled per #73 |
| SAP Export Configuration | REAL | Movement types, plant, storage location versioned |
| Import Mappings | PARTIAL | REM import exists; production-plan mapping incomplete |
| Archive / Retention | PLACEHOLDER | No configurable retention |
| System Defaults | PLACEHOLDER | No configurable defaults system |

### Architecture decisions for this implementation

1. **Config storage**: Convex tables (configDrafts, configPublished, configAuditLog) — keeps config server-authoritative with Convex's transactional guarantees.
2. **Config registry**: Typed TypeScript registry (`src/lib/configRegistry.ts`) defining all configurable keys, types, defaults, validation, and RBAC requirements.
3. **Rendering integration**: `AppSidebar.tsx` and `VitrosLayout.tsx` read from config registry + published values to render navigation.
4. **Preview/publish**: Draft → review → publish flow with optimistic concurrency (version checks).
5. **Rollback**: Creates a new audited version from a previous published state.
6. **Import/export**: Versioned JSON schema with dry-run preview and rejection reporting.
7. **Secret boundary**: Registry explicitly marks sensitive keys; export excludes them; validation rejects secret mutations through the config API.

### What this implementation does NOT change

- Inventory quantity transitions, ledger, or audit authority
- SAP posting semantics
- Employee lifecycle barriers
- Digital DHR (remains disabled pending controlled-source prerequisites)
- Existing visual design system (VITROS blue dark theme, gradient icons, card-based layout)
- Existing route paths or page components
- Login/auth flow

### Implementation status — 2026-09-14

**Files created:**
- `src/lib/configRegistry.ts` — 43-entry typed configuration registry with categories, validation, defaults, and RBAC requirements
- `convex/configActions.ts` — Server-authoritative config CRUD: public queries, admin mutations, import/export actions with RBAC, audit, and optimistic concurrency
- `convex/configMutations.ts` — Internal mutations for cross-function calls from actions
- `src/hooks/useConfig.tsx` — React hooks for reading published config values with resolved defaults
- `src/components/ConfigProvider.tsx` — React context provider bridging Convex config queries to the component tree
- `src/components/ConfigEditor.tsx` — Full admin config editor with category grouping, draft/publish/rollback, audit log, import/export UI
- `scripts/config-registry-check.mjs` — 17 assertions (1,711 checks) for registry integrity
- `scripts/config-validation-check.mjs` — 18 assertions (121 checks) for value validation
- `scripts/config-security-check.mjs` — 16 assertions (1,126 checks) for security boundaries
- `scripts/config-import-export-check.mjs` — 18 assertions (134 checks) for import/export

**Files modified:**
- `convex/schema.ts` — Added `configPublished`, `configDrafts`, `configAuditLog` tables with indexes
- `src/components/AppSidebar.tsx` — Now reads nav items and branding from config registry
- `src/components/VitrosLayout.tsx` — Now reads route labels from config registry
- `src/main.tsx` — Wrapped app with ConfigProvider
- `src/pages/Settings.tsx` — Integrated ConfigEditor component
- `docs/REBUILD_AUDIT.md` — Updated with implementation evidence

**Verification:**
- TypeScript check: PASS (`tsc --noEmit` clean)
- Vite build: PASS (`npm run build` succeeds, output: 1,507 KB JS, 197 KB CSS)
- Config registry check: PASS (1,711 checks)
- Config validation check: PASS (121 checks)
- Config security check: PASS (1,126 checks)
- Config import/export check: PASS (134 checks)
- Total assertions: 2,092

**Configuration categories implemented:**
1. Branding & Titles (4 keys) — app title, subtitle, sidebar title/subtitle
2. Navigation & Sidebar (5 keys) — inventory/REM/report nav items, route labels, section order
3. Dashboard Modules (1 key) — configurable dashboard module layout
4. Theme & Appearance (2 keys) — default theme, available themes
5. Table Columns (2 keys) — stock summary and transaction search column config
6. Chart Configuration (3 keys) — inventory turnover, ABC analysis, REM progress
7. Report Definitions (1 key) — configurable report definitions
8. Alerts & Thresholds (4 keys) — reorder, low stock, aged inventory, SLA warning
9. Feature Flags (5 keys) — DHR, REM import, cycle count, kit analysis, SAP export
10. System Defaults (4 keys) — part type, currency, date format, timezone
11. SAP Configuration (6 keys) — plant, storage, movement types, header text
12. REM Configuration (4 keys) — default view, kanban/gantt/field status visibility
13. Form Configuration (2 keys) — reorder and incoming stock form fields

**Remaining items for follow-up:**
- Production Vercel deployment (pending Vercel access)
- Production Convex deployment (codegen succeeded locally)
- Browser acceptance testing in production
- Dashboard page components wired to read from config (currently hardcoded per-page)
- Table components wired to read column config (currently hardcoded per-page)
- Chart components wired to read chart config (currently hardcoded per-page)
- Form components wired to read field config (currently hardcoded per-page)
- DHR feature flag integration (remains disabled per controlled-document prerequisites)
- Independent verification issue creation

## 2026-09-14 — Mid-review correction pass (issue #81, second pass)

The first-pass snapshot was rejected by actual-handler testing. Every correction was
reconciled against this worktree's source before editing; all were confirmed:

1. **Audit forgery / open reads** — `createAuditEntry` was a PUBLIC mutation accepting
   caller-supplied actor/capability (convex/configActions.ts:746); `listDrafts`,
   `getDraft`, `getAuditLog` had no capability check (configActions.ts:199-278).
2. **Divergent validation** — three hand-copied key unions (configActions.ts:8,
   configMutations.ts:4, src/lib/configRegistry.ts) already disagreed; structured
   values (nav/table/dashboard/report/form) passed with only a `JSON.parse` round-trip,
   so `nav.inventoryItems='not an array'` and empty required form fields were accepted.
3. **Draft races** — `createDraft` silently overwrote the single global draft by key
   and reset its version (configActions.ts:315-334); no draft identity/revision
   precondition existed, so two Superuser tabs could publish each other's unseen edits.
4. **Broken rollback** — `rollbackToVersion` ignored `targetVersion` and took the
   latest audit `newValue` (configActions.ts:464-485); a handler test requesting v1
   returned v2 while reporting v3.
5. **Non-atomic import** — `importConfig` applied per-entry `runMutation`s (partial
   writes on failure), deleted unrelated drafts, and appended an invented
   representative-key audit event under `brand.appTitle`; no idempotency receipt.
6. **Preview not wired** — `useConfig` held its own Convex subscription independent of
   `ConfigProvider`; the provider had no preview state; `nav.routeLabels` was computed
   in VitrosLayout.tsx but the variable was never used.
7. **Duplicate SAP source of truth** — editable `sap.*` entries persisted to Convex
   `configPublished` while real SAP operations read the audited Supabase settings
   managed by `convex/adminSettingsActions.ts` / Settings.
8. **No role-policy configuration** — no registry key and no authGuard integration.
9. **Unconsumed values** — `dashboard.modules`, `tables.*`, `charts.*`,
   `reports.definitions`, `forms.*`, `thresholds.*`, `theme.defaultMode`, `rem.*`,
   `defaults.*`, `features.*` had no consumers; several defaults described invented UI
   (dashboard KPI set, table column sets, form field lists, chart colors) that does not
   match the shipped pages.
10. **Static-only tests** — scripts/config-*-check.mjs inspected source text/regex and
    could not detect any of the above.
11. **Build/codegen** — `convex/_generated/api.d.ts` already references the
    `configActions`/`configMutations` modules and infers signatures via
    `typeof import(...)`, and `dataModel.d.ts` imports `schema.ts`; changes inside
    existing modules and schema table additions therefore typecheck without new
    codegen. Only brand-new registered-function modules would require it.
12. **No-backend fallback** — src/main.tsx still mounted `ConvexDataProvider` and
    `ConfigProvider` (useQuery consumers) without a Convex provider when
    `VITE_CONVEX_URL` is absent.

### Corrective architecture (this pass)

- Single shared pure contract `convex/configContract.ts` (no Convex imports;
  browser-safe) is the only key/validator/default source. `src/lib/configRegistry.ts`
  becomes a re-export shim. Backend and frontend can no longer diverge.
- Delegated/excluded controls (documented, not duplicated): SAP operational settings
  remain the existing audited Supabase settings surface; employee/part-master/kit/REM/
  DHR authorities are reused as-is; DHR enablement stays the deploy-time
  `DIGITAL_DHR_ENABLED` env gate (no competing config flag); `forms.reorderFields` and
  `forms.incomingStockFields` were removed (no such forms exist in the shipped UI and
  the receiving workflow's identity/quantity/documentRef fields are
  business-integrity-critical); `thresholds.reorderAlert`, `thresholds.lowStockWarning`
  (status classification stays canonical: `qoh < minQty`), and `thresholds.slaWarningDays`
  (per-analyzer `slaDays` is REM authority data) were removed as invented; form
  configuration is re-scoped to the real part-master add/edit form.
- New server lifecycle: draft identity (`draftId`) + owner + monotonic revision +
  expected-revision preconditions; publish names the exact reviewed draft revision and
  expected published version; immutable `configVersions` snapshots make rollback exact;
  import preview/apply are separate, apply is one atomic authorized mutation with a
  bounded idempotency receipt; audit append is a private helper inside the same
  transaction; published reads expose only non-secret presentation values without
  actor metadata; role policy (`roles.policy`) is enforced inside
  `requireCapability` within immutable ceilings, fail-closed.
- Feature gates: `features.remImportEnabled`/`features.cycleCountEnabled` gate their
  server write paths; `features.sapExportEnabled` gates the export transition;
  `features.kitAnalysisEnabled` is labeled visibility (read-only analysis page).
- Enterprise writes remain default OFF in production until the reviewed deployment and
  authenticated acceptance gates pass (process gate owned by the coordinator).

## 2026-09-15 — Customization completion and reporting implementation

### Issues addressed from handler/component test failures

**Fixed failures in `/tmp/vitros-resume-20260915/handlers.log`:**
1. `configContract.ts:103` — `TypeError: base.filter is not a function` in `effectiveRoleCapabilities` for prototype-pollution keys (`toString`, `constructor`, `__proto__`). Fixed by using `Object.prototype.hasOwnProperty.call()` for all role lookups.
2. `configActions.ts` — Unbounded `.collect()` reads in `createDraft` (line 374) and `exportConfig` (line 724). Replaced with bounded `.take()` using registry size limits.
3. `validateImportEnvelope` — Missing validation for `exportedAt` (must be positive integer timestamp) and entry `version` (must be non-negative integer). Added strict checks.
4. `nav.remItems` / `nav.inventoryReports` default validation — New routes `/rem/reports-v2`, `/engineer-dashboard`, `/enterprise-dashboard`, `/inventory-reports` added to `KNOWN_ROUTES`; missing gradient `from-blue-500 to-blue-700` added to `NAV_GRADIENTS`.

**Fixed failures in `/tmp/vitros-resume-20260915/components.log`:**
1. `ThemeProvider` — Configured default mode not applied on initial render. Fixed by reading config values in `useState` initializer and validating `setThemeMode` against `availableModes`.
2. `ThemeProvider` — Personal choice preservation and unavailable mode rejection. Fixed by validating `setThemeMode` input against `availableModes`.
3. `StockSummary` — Header/body `gridTemplateColumns` misalignment (missing Actions column width in header). Added `+ " 65px"` to header grid template.

**Fixed `diff.log`:** Trailing whitespace in `src/components/vitros/SharedComponents.tsx` (lines 266-277).

### Reporting implementation (issue scope from `/tmp/vitros-reporting-role-scope-20260914.md`)

**New pure period helper:** `src/lib/periodHelper.ts` — 27 behavioral tests passing. Provides:
- `PeriodType`: `"weekly" | "monthly" | "quarterly" | "annual"`
- `createPeriodRange`, `getPreviousPeriod`, `getNextPeriod`, `createPeriodNavigator`
- `filterByPeriod`, `isInPeriod`, `getAvailablePeriods`
- ISO week boundaries, explicit calendar rules, no fiscal assumptions

**Inventory Reports page:** `src/pages/reports/InventoryReports.tsx`
- Period selector (weekly/monthly/quarterly/annual) with previous/next/today navigation
- Date-range banner showing exact period bounds
- KPI strip: total SKUs, health %, stock-outs, period activity
- Inventory status breakdown with progress bars
- Transaction activity by mode (IN/OUT/RECEIVE/ADJUST)
- Reorder alerts with part numbers
- Top moving parts by volume
- CSV export with period metadata
- Print support

**REM Reports page (v2):** `src/pages/rem/RemReports.tsx`
- Same period selector and navigation
- Cross-period analyzer completion rates, stage breakdown, SLA breaches
- LVCC item counts per period
- CSV and XLSX export with period metadata
- Honest unavailable-source banner when Supabase REM data fails

**Role-based dashboards:**
- `DashboardPage.tsx` — Redirects by role: Superuser → `/dashboard` (configurable ExecutiveDashboard), Engineer → `/engineer-dashboard`, Viewer → `/dashboard`
- `src/pages/inventory/EngineerDashboard.tsx` — Simplified operational view (7 KPIs, quick actions: Scan Kiosk, Incoming Stock, Transaction Search, Reorder/Stock-Out, recent transactions, inventory status). No admin metrics (SAP, system settings).
- `src/pages/inventory/EnterpriseDashboard.tsx` — Cross-module status with period selector: Inventory (health, stock-outs, reorder, activity), REM (completion, stages, SLA), DHR (disabled with honest reason), SAP (staging counts, errors). Data source status footer showing live/unavailable per module.

**Navigation & config updates:**
- Added `/engineer-dashboard`, `/enterprise-dashboard`, `/inventory-reports`, `/rem/reports-v2` routes
- Updated `KNOWN_ROUTES`, `NAV_DEFAULTS`, `routeLabels` in `configDefaults.ts`
- Configurable nav items for new report pages

### Verification results

- TypeScript: `tsc --noEmit` — PASS (clean)
- Handler tests: `scripts/customization-handler-test.mjs` — 14/14 PASS
- Component tests: `scripts/config-editor-behavior-check.mjs` — 14/14 PASS
- Period helper tests: `scripts/period-helper-test.mjs` — 27/27 PASS
- `git diff --check` — PASS (no whitespace errors)
- Vite build: `npm run build` — PASS (1,507 KB JS, 197 KB CSS)

### Remaining items for follow-up

- Production Vercel deployment (pending Vercel access)
- Production Convex deployment (codegen succeeded locally)
- Browser acceptance testing in production
- DHR feature flag integration (remains disabled per controlled-document prerequisites)
- Independent verification issue creation
- Real-source REM workbook import (corrected workbook still required)
- Employee lifecycle fixes (canonical legacy initials, null creation timestamps, deactivation revocation)


## Dashboard-first release priority 2026-09-15
User explicitly prioritizes complete VITROS Inventory/REM dashboards and reporting before enterprise expansion, and authorizes Codex implementation alongside parallel OpenCode sessions. Coordinator now owns source edits. Three native freeZen/default sessions provide independent read-only reporting, role/config and browser checks. Existing login release remains production; no new release yet. TypeScript/build previously pass, functional checks under review. Preserve business data, authorization, existing design and source provenance.


## September 15 dashboard-first release review
Scope: authenticated configuration draft/preview/publish/history/rollback and role capability ceilings;35validated registry keys; role landing routes; limited Engineer dashboard; weekly/monthly/quarterly/annual inventory and REM reports.
REM uses source quarter/year, ISOweek and labeled Thursday wholeweek monthly allocation. Missing activity dates/actuals remain distinct. Current snapshots labeled separately. Export disabled on core/planning error/loading. Inventory reports paginate explicit movement audit events, with fixed period/as-of boundary; partmaster insertion audits do not become fake inventory receipts.
/rem/reports canonical; /rem/reports-v2 alias. Unreleased EnterpriseDashboard archived outside repository for later enterprise scope. Source workbook d22317dbf18187ad00e3e73d62d1aaed88bb1415594a6530f042b5d6c8ddf299,67sheets/40hidden. Authorized imports live: stock596 including182newOptional/QOH0/min1/max1; allprior414rows unchanged. REM125analyzers/28active,212trackerweekly,53buildweeks,19staff,3notes,4targets,LVCCactive0. Operational history27096records/27096immutableevents,import8311a2ce-97d9-4c18-ab3b-9c4a62979531. Authenticated Engineer APIread verified counts September15 13:43UTC. Source exception metadata retained; original workbook unchanged. No DHR consumption/SAP posting inferred from history.
Fixed preexisting ambiguous PL/pgSQL create_part_master identifiers, complete function migration included. Failed transactions rolled back before successful verified insertion.
True npm run typecheck checks frontend+Convex; bare npx tsc --noEmit is insufficient. Full typecheck/buildPASS. Actual confighandlers14/14,components14/14,parser20,calendar31,rolehelper45,REMreport28,renderedApp/report10 andinventoryactionpagination checksPASS. Newtests included in CompletionRegression. ExactheadCI andproductionbrowser acceptance follow before completion claim.
OpenCode sessions freeZen/default only, noGo use. Root reviewed and fixed actual quarter grouping,partialexports,CSVformulas,routeguard mounting andfullbuild failures. Readonlyreview claims against valid epoch comparisons/local boundaries and max-minus-QOH reorder policy rejected as incorrect.
Runtime sync no longer copies a different provider credential from OPENAI_API_KEY. OCR provider unresolved. DigitalDHR staysOFF pending controlleddocument/approvedconsumptionmapping. Enterprise deferred per user. Noenterprise/OCR/DHRcompletion claim. Backend bindings regenerated for explicitexistingproductionselector; noconvexdev/configure. Code remainsunmerged/unreleased atthis checkpoint.

Final verification correction: the worker REM test copied some implementation functions and depended on Node26 native TypeScript. Replaced entirely with14 checks loading actual remReportData and periodHelper through TypeScript transpilation. Tests prove source Q1 week14, Q4 week53, ISOyear boundary, Thursday month allocation, unknown dates, missing/zero actuals, cumulative forecast preservation, CSVescaping and metadata. PASS with native type stripping disabled. Prior28worker checks are not accepted production-module evidence. ActualRoleLogin9checks now load actual role-route config and prove publishedSuperuserdefault, credential-freeEngineer and auth-before-navigation. Removed unused legacyhookimport fromRemDashboard; its actual authoritativehook remains unchanged. IncomingStock staticguard recognizes reviewed component nested in RoleGuard. Runtime staticgate now verifies AIprovidercredentials are not overwritten. First CI failures corrected without changing productionauthorization behavior.


## September 15 production sign-in readiness follow-up
PR395 merged as13f935345ad01e006b877e39f848932432c025ab after exact-head CI passed. Vercel deployment dpl_5hSpjJw4fauL8Qxeb3xkb4vaKSsr READY. Live Chromium14 checks passed for credential-free Engineer, SuperuserPIN, StockSummary, customization and both modules' four reporting periods. No page exceptions. Initial unauthenticated ConvexDataProvider polling produced four action console errors per fresh login (stock/audit/SAP/settings). Provider wraps sign-in and its scheduler starts before currentUser resolves. Follow-up will gate reads on server identity, refresh immediately on identity readiness, clear client snapshots on identity changes and discard stale responses. No database or authorization policy changes.

Follow-up verification: eight actual-provider tests PASS, six refresh coordinator groups PASS, full frontend/Convex typecheck and production-configured Vite build PASS. No database or auth policy changes. Live verification follows exact-head CI and deployment.


## Active DHR deletion September 15
User requests ability to delete active DHRs. Existing DhrScanner has active/completed sessions, server-authenticated bootstrap and atomic scanner/lifecycle RPCs, but no delete UI. Production has one in_progress session; no production DHR is selected for deletion by this task. Physical deletion conflicts with immutable lifecycle/consumption history. Implement Superuser inventory.admin deletion as terminal deleted status plus revision-checked immutable event and reason, retaining stock/SAP history. Existing scan/document functions lock the session and require in_progress; existing lifecycle refuses unsupported status, so deleted records cannot resume. UI confirmation on list/detail; synthetic transaction/action/component tests and live non-mutating UI verification planned.

Verification: actual action7 and actual Scanner/dialog5 behavior groups PASS; true frontend/Convex typecheck and production-configured build PASS. Disposable PostgreSQL reached migration application successfully but test fixture ID collision was corrected; a later local Docker permission failure prevented completion. CI Postgres17 will run the corrected transaction suite; no DB-pass claim yet. Original active DHR untouched. React review: separate dialog component, stable retry identity, pending double-submit guard, accessible Radix focus handling, functional snapshot removal, role visibility plus server authority.

CI Postgres17 proved deletion, audit, replay, stale revision, archived rejection and reopen prevention. The negative scanner test expected SQLSTATE55000 but the existing scanner intentionally uses defaultP0001; corrected the test to assert its exact rejection message. No production function behavior changed.

## 2026-09-15 Engineer view customization
User requested Superuser control over the Engineer view. Investigation found EngineerDashboard ignores the shared module configuration. Implementing role-specific validated settings using existing draft, preview, publication, and rollback infrastructure; preserve defaults and server permissions.

Engineer customization verification: full frontend/Convex typecheck and production frontend build pass; 18 actual React component groups, 16 actual config handler groups, and 8 native Chromium desktop/mobile views pass. Synthetic transports/data are explicitly separated from live acceptance. No production settings or inventory data changed during implementation.

The first CI run exposed an older employee test loader that accepts only the existing contract dependencies. Kept the two Engineer allowlists in the existing pure contract, avoiding an unnecessary new module and preserving all existing loaders. Rechecking affected tests before merge.

## 2026-09-15 Cycle Count behavior audit
User requires saved exit, real 30-second active-session autosave, final audited stock adjustment only on confirm, Required-first alphanumeric W2W, and live active-DHR WIP. Current page posts unauthenticated to a stale Convex deployment; its autosave only updates a timestamp; Save and Exit writes stock; final stock writes loop without shared atomic close; WIP is manual. W2W grouping exists but needs coverage and all-parts verification. Inventory remains authoritative in Supabase.


## 2026-09-15 — REM Command Center naming
User requests dashboard rename from VITROS to REM Command Center. Current production cycle-count release 96a3baadaa13780b87a5e034082f0e32e9cc985c is healthy. Scope: user-visible application branding, login, navigation, install/browser metadata and dashboard customization heading. Preserve VITROS analyzer/product names, database identifiers, URLs and operational records. React/Vite/Convex and Vercel deployment remain unchanged. Inspect all branding consumers before edits, run existing build/checks and verify desktop/mobile live branding.


## 2026-09-15 — OpenCode Zen AI administration
User requests dashboard AI controlled by OpenCode Zen free with Superuser admin/model controls. Existing aiGateway and incomingStockPdfOcr hardcode OpenAI endpoints/models; no AI admin settings or usage ledger. Runtime sync currently copies storage env only; a Go key in an OpenAI-named variable must not be repurposed. Existing VPS credentials contain only opencode-go; requested dedicated Zen key via Vercel environment. Current official Zen catalog offers free text models and a free Muse multimodal model; free-model data policies must be shown accurately. Scope: server-only free-provider routing, live free-model metadata, model selection by text/image/PDF capability, global/feature toggles, bounded quotas/timeouts/output, connection/model tests, usage/failure visibility, auditable revisioned admin settings, runtime Zen env sync and existing OCR consumers. Preserve inventory/DHR/SAP review and mutation boundaries. Existing gateway request model retained rather than introducing unrelated agent threads or another inference service. Tests must cover RBAC, paid-provider exclusion, metadata changes, quota concurrency, failed calls and replay-safe settings, plus native admin UI.

Verification: actual backend handlers pass free-model/modality filtering, default payloads, admin RBAC, settings revision conflicts/exact replay, emergency pause, minute/day limits, usage accounting and sanitized provider failures without retries or paid fallback. Three actual OCR consumers retain authorization and shared routing. Native Chromium at 1440/390/320px verifies draft preservation, review, pending save, lost-response retry, audited restore, model workspace, Engineer exclusion and no page overflow. Frontend/Convex typecheck, production-configured build, receiving acceptance and existing customization checks pass. No production inference verified yet; dedicated Zen key is pending.

## 2026-09-15 Settings layout cleanup
User reports misaligned Settings and requests removal of the full parts catalog and a clear Engineer view customization entry. Current page is 1,067 lines with duplicated part administration and eager part-master reads, narrow horizontal SAP controls, hover-only employee actions, and customization buried below operational fields. Preserve existing versioned configuration/Engineer draft-preview-publish-rollback, employee and SAP handlers, route authorization and inventory administration elsewhere. Group Settings into Dashboard views, People, SAP settings and System; default to Engineer customization, remove duplicate parts UI/fetches, and verify responsive layout and existing behavior.

Verification: frontend/Convex typecheck and production-configured build pass; all 18 existing config component checks pass; native actual Settings plus Engineer editor at 1440/390/320px passes no-part-catalog, draft preservation across sections, save/preview/review/publication, SAP versioned save, visible employee controls and no overflow including expanded card settings. Visual inspection corrected the remaining cramped 320px employee form and name/actions layout. No backend, role policy or production configuration changes.

## 2026-09-15 Stock Summary mobile columns
User screenshot shows Description/Type overlap and following values shifted from headers. Current StockSummary uses independent row/header grids with a 1fr description track and fixed 720px container. Header intrinsic label width and truncated body minimum differ, so tracks resolve differently. Fix shared tracks with explicit minimum widths and computed table minimum width, prevent text spilling, and preserve configured order/visibility. Verify actual geometry for all/default/reordered/hidden columns at phone and desktop sizes with horizontal scroll; inventory values and mutations unchanged.

Verification: the native-browser regression fails against the original component with a Description column width mismatch. The corrected component passes all nine combinations of 320/390/1440px viewports and default/reordered/hidden column configurations, including horizontal scrolling, quantity sorting, and description search. Full frontend/Convex typecheck, all 18 existing configuration behavior groups, production-configured Vite build, and whitespace checks pass. Production verification follows reviewed deployment; this change does not write inventory data or configuration.

## September stocking plan and August usage refresh — 2026-09-16

User supplied two original workbooks and authorized inventory, missing description, required kit, stocking plan and REM tracking updates. Read all visible/hidden sheets and populated cells without modifying originals. September Updates contains 216 unique US36_F076 entries. Hidden reference sheets include 47,705 expense/catalog rows and 79 obsolete rows; Subs2 contains 1,210 hidden rows. Relevant catalog scope is BOM, actual REM usage, supplied stocking plans and existing inventory; global reference catalogs provide enrichment only. The integrated service BOM has 63 5600 lines and 59 7600 lines excluding labels/packing, including two module-specific J30459 lines and lubricant quantity Dab. Existing kits have 60 lines each and 59 unique parts; stock count is 596. Comparison finds 48 missing relevant parts, two empty descriptions, 78 source-supported type changes, 6,934 unique usage records (3,601 new, 3,333 existing with matching quantities/costs; 438 description differences). Usage must remain historical and cannot decrement current stock or create live WIP. Source DHR statuses and other REM datasets remain unchanged. September J22916 and J38373 have positive reorder points with zero reorder quantity; retain those source values and record exceptions.

Kit readiness currently checks duplicate parts separately and stock detail uses only the first matching line. Kiosk expands kit lines directly, so a nonnumeric Dab cannot be coerced into whole-container consumption. Preserve source quantities and require manual quantity for measured consumables. All material data writes require source hashes, before/after audit, stable idempotency and verification. No migration to corporate SQL Server or SAP posting is in this scope.

Verification: full frontend/Convex typecheck, production-configured build, 18 configuration behavior groups, existing nine scanner identity paths and new duplicate-module/measured-quantity paths pass. Historical source import is applied through staged validation with 3,601 new records and 438 description enrichments; all 6,934 records match source, with 4,039 history events and no stock consumption. Kit data publication follows the frontend release so the new measured-quantity metadata cannot be interpreted by the old kiosk.

## 2026-09-16 — Source-backed part identity audit

Baseline main 5f9955431324f63cb55284197b24c4aa82a18528, production Vercel alias and Convex/Supabase path retained. Stock has 645 parts. Seven supplied technical PDFs, September workbook and the user’s 5600 diagram inform part descriptions, supported models and subassembly metadata. Additive stock metadata schema and existing audited part-master RPC preserve quantity/threshold values, versions, server-side authorization and event history. Stock Summary will remove bin location from presentation, add metadata columns/search/detail/export/edit support, and retain explicit unknowns. Existing published configuration remains accepted. No framework, authentication, SAP, secrets or balance changes. User requests Computer and Cabinetry categories for corresponding unassigned items. OpenCode Zen free stalled without edits; stopped with no paid fallback; Codex continues under user authorization. Typecheck, behavior checks, RPC rollback tests, build, exact-head CI, backend/frontend deployment and live verification remain pending at phase start. Private source documents and part datasets stay outside Git.

Verification: frontend/Convex typecheck, production build, configuration handlers and role routing passed. Actual React configuration/consumer/editor checks: 19 passed, including metadata-only save through the audited versioned action without stock adjustment and mixed metadata/quantity edits rejected before writes. Stock geometry passed 9 combinations (320/390/1440px; default/reordered/hidden columns). Database rollback checks passed metadata roundtrip, idempotency, stale version conflict and invalid model/code/side/evidence/quantity rejection; no test events persisted. Audited import verified all 645 exact payloads and events, stock quantity/threshold preservation, and one version increment. Four concurrent type edits were preserved. Description changes: 137; supported models: 199; subassembly/category: 223; photo subcodes: 91. Computer/Cabinetry used where supported; missing mappings remain explicit. RPC execution remains restricted to service_role/postgres. Supabase advisors show informational no-policy records on server-mediated tables; no new warning/error. Final deployed browser verification pending.


## 2026-09-16 Rev J BOM authority
Production is React/Vite with Convex authenticated actions and Supabase stock as authority; PR405 is live. User supplied VITROS_5600_Rev_J_Fillable_Word.docx and directed Required/Optional/Tool classification from it, all other stock Not on BOM. Existing database and server enum lack Tool. Extend the allowlists and stock filter/edit selectors without changing authentication or inventory quantities. Reconcile through audited versioned part-master RPCs; preserve source provenance and dual-use notes. Validate typecheck/build, Tool acceptance and authorization, and live stock/label parity.

## 2026-09-17 Enterprise universal upload audit
Native enterprise app is SwiftUI in vitros-ios; existing authenticated backend is Convex with server-only canonical inventory. User authorizes arbitrary-file intake, AI-assisted inventory/production mapping and additional data fields. Existing import handlers require REM-specific workbook schemas and reject formula errors; native app has no file intake. Add a durable upload/review/publication workflow with source preservation, hidden-sheet/cell evidence, free Zen mapping, recoverable parsing problems, server authorization and revision/idempotency guards. Published uploaded snapshots remain explicitly distinct from operational inventory transactions; no upload automatically changes stock, SAP or live work records. All unknown columns remain available. No paid inference fallback. Source documents are data, never instructions. Validate parser fixtures, real handlers, native builds and end-to-end upload review/publication before claiming delivery.

## REM percentage progress audit — 2026-09-17
- Baseline: main d0327b5; React 19/Vite 7, Convex authenticated actions, Supabase authoritative REM rows. No framework change.
- Existing kiosk writes only stage/notes; analyzer/LVCC cards and Kanban are read-only. LVCC has Build/Test/Packaging/QA/SAP percentages already. Shared active employee directory exists.
- Add per-record revision, server timestamp, selected employee attribution and immutable events with service-only RPC. Maintain canonical rows and preserve imported quantities. Photos supply layout only, by user confirmation.
- Existing web route registry and published permissions retained. Native SwiftUI shares these actions. No SAP posting or inventory balance mutation is part of REM progress editing.
- Validation pending implementation: action types, SQL rollback-only invariants, web build/browser flows, native builds. Do not infer deployment success from source changes.

Validation: all REM TypeScript and the production bundle pass; synthetic desktop (1440px) and mobile (390px) browser flows pass required engineer selection, invalid percentages, stable retries, audit history, Kanban parity, stale revision handling and LVCC registration. SQL invariants executed inside a rolled-back transaction: service-only privileges, active directory checks, idempotent replay/payload conflicts, all-stage completion, before/after audit, revision increments on external writes and analyzer projections. Original production analyzer/LVCC quantities remain unchanged. Local native package: 14 tests, two opt-in checks skipped, zero failures. OpenCode free/default sessions stalled before edits; no paid Go fallback used.

## 2026-09-17 Enterprise upload backend verification — 2026-09-17 20:35 UTC

Branch `codex/enterprise-uploads-20260917` from base `d0327b5`, merged with `origin/main`
`06d82a9` (REM progress/permissions PRs #407–#409; no overlapping source — only the generated
`convex/_generated/api.d.ts` and this audit file needed reconciliation). Additive slice only:
`convex/enterpriseFileParser.ts`, `convex/enterpriseMapping.ts`, `convex/enterpriseUploads.ts`,
`convex/enterpriseUploadActions.ts`, `convex/enterpriseUploadSchema.ts` (+ spread into
`convex/schema.ts` and regenerated `convex/_generated/api.d.ts`); three check scripts;
`docs/ENTERPRISE_UPLOADS.md`; `.github/workflows/enterprise-uploads.yml` (node 22).

Review fixes applied and verified against real SheetJS behavior (no fixture invention):
uncached formulas read back as `t:"z"` with synthetic `v:0` — now flagged and nulled, never
counted as zero; cached zero stays a legitimate zero; real `t:"e"` numeric error codes
(e.g. `0x2A`) flagged with null value (SheetJS write/read strips error cells, so the fixture
ships exact OOXML worksheet XML); empty JSON gets `needs_attention` with a no-data warning;
UTF-16 CJK text parses as legitimate data while control-byte binaries are rejected;
explicit `us`/`eu` number formats parse `1,234.50`/`1.234,50` to 1234.5 while default plain
keeps them null; leading-zero text (`00123`) is never coerced to a quantity.

Evidence (local, this worktree): `enterprise-file-parser-check.mjs` 142 passed / 0 failed;
`enterprise-upload-check.mjs` 88 passed / 0 failed; `enterprise-upload-flow-check.mjs`
37 passed / 0 failed (total 267). `npm run typecheck` clean (tsc -b + convex tsconfig).
`npm run build` succeeds (1939 modules). `git diff --check` clean. Biome reformatted the new
modules; remaining biome lint diagnostics match pre-existing repo parity (CI lint is
non-blocking `|| true`). The `enterprise-upload-flow-check.mjs` loader was fixed to use the
proven transpileModule/vm sandbox with real `xlsx` require and `Blob`/`structuredClone`
globals; Convex ESM imports are never loaded directly.

Open limitations: no Zen app key is configured (`OPENCODE_ZEN_API_KEY` missing from Convex
`youthful-cat-318`), so live AI mapping is unverified; rule-based suggestions and manual
mapping are fully covered instead. No production fixtures were inserted. Native client
(PR5) and macOS packaging are owned elsewhere and untouched. Deployment of the additive
Convex functions/schema follows only after merge and green required checks.

## REM progress rejection fixture — 2026-09-23

- Base inspected: `1e6b216b92f0e81cf13db9ba04e88cb4de6572df`. The REM progress SQL fixture caught its own missing-rejection assertions for idempotency conflicts, stale revisions, and inactive engineers because their messages matched the expected RPC error substrings.
- All six negative cases now record an expected RPC rejection inside the handler and raise the missing-rejection assertion after leaving that handler. Unexpected database errors still propagate. Production functions, grants, RLS, and business records are unchanged.
- Disposable PGlite 0.3.14 executed the full REM operational bootstrap/import/progress migration chain used by the native PostgreSQL CI job, then passed the updated rollback-only progress fixture. The old fixture incorrectly passed three mutations replacing the rejected calls with successful no-ops; the repaired fixture rejected all six no-op mutations and propagated all six unrelated-error mutations.
- Verification is local embedded PostgreSQL evidence, not native PostgreSQL CI, live Supabase, or browser acceptance. The existing `rem-operational-database` CI job executes the updated fixture on PostgreSQL 17. No production connection or fixture was used.

## DHR production conflict error correction — 2026-09-23

- Issue #109 records a production stale-revision rejection on reviewed main `1e6b216b92f0e81cf13db9ba04e88cb4de6572df`: inventory remained safe, but the browser showed a generic Convex server error. The server previously threw arbitrary PostgREST diagnostic messages, and the scanner's fallback displayed raw error text and incorrectly claimed successful reload even when reconciliation failed.
- DHR session creation, quantity transitions, and lifecycle write failures now translate bounded, recognized SQLSTATE/message pairs into structured `ConvexError` codes. Only the fixed public code vocabulary crosses this boundary; database messages, row values, hints, and details are never included. Unknown/malformed provider errors produce `OPERATION_UNCONFIRMED`.
- The scanner reads structured error data and displays fixed messages. Its existing quantity callback still makes one mutation attempt and then reconciles authoritative reads on rejection. Conflict guidance asks the operator to refresh/review without asserting that any read succeeded.
- `scripts/dhr-error-contract-check.mjs` executes the actual server action and client mapper, uses real ConvexError serialization, and executes the actual scanner quantity callback extracted through the TypeScript AST. Nine checks cover auth-before-I/O, one RPC/no pulse on rejection, safe known codes, malformed/unknown diagnostic containment, creation/lifecycle containment, accepted receipts/pulses, client fallback, and rejected/successful UI reconciliation including failed reads. The existing seven deletion action checks and scanner security check also pass. Frontend and Convex TypeScript checks and the Vite production build pass.
- No SQL migration, production write, live deployment, controlled artifact, or inventory/SAP semantics changed. Exact-head independent review, CI, deployment and production stale-revision browser recheck remain release gates; this local evidence is not a new live E2E claim.

## Install shell correction — 2026-09-23

Current reviewed main `8b3808ce508753aedfd16a19d8bb1de3b47623f3` is READY with green CI. Issue #77 remains open. The existing favicon is a 32×32 JPEG named PNG and contains the old viktor placeholder; manifest declared image/png and any size. Viewport maximum-scale=1 restricted zoom. This slice uses screenshots of the existing production login logo at actual 180/192/512 dimensions for Apple/Chromium icons, fixes manifest identity/type/size references and removes the zoom restriction. No framework, business-data, authorization or cache behavior changes. Service worker/offline operation remains deliberately deferred. Automated checks validate PNG signatures and dimensions in both source and built output. Physical iPhone/Android installation and authenticated device workflows are separate acceptance gates.

## 2026-09-23 OCR error contract review
PR 422 head 21fafb4 failed independent review: inherited code-map keys returned non-string values, Incoming Stock OCR catches could reflect malformed provider diagnostics, and internal mutation plain errors lose their exact message across Convex boundaries. Repair is confined to bounded error transport and executable regression coverage; no inventory, SAP, authorization, or provider routing changes. Actual provider/source acceptance remains separate.

## 2026-09-23 historical scan privacy operation
Owned dhr-scans bucket is public with seven historical JPEGs. Current browser has no stored-object read path; OCR uses authenticated actions/base64. Prepared a fixed-project/fixed-bucket API operation with exact object-manifest/hash guards, preserved authenticated retrieval, public denial checks, and no object writes or automatic public rollback. Storage API credential unavailable; no production change claimed. Synthetic transport behavior tests pass. See SCAN_STORAGE_PRIVACY.md.
