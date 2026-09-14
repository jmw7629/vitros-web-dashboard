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
