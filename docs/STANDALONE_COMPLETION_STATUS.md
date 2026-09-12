# Standalone completion status — 2026-09-12

This is a direct Codex pass in `/home/joevps/codex-vitros-standalone`, using only the owned VITROS repository and deployment/database resources. Historical bridge/project-manager instructions do not govern this pass.

## Production gate

The latest main production attempt inspected was `dpl_8j3tGoB8awwUsSGUpw1pd8TodTEB`, for main `a7e51cdbc7a6146b0c9a6453cda43e1a5cb5f24d`. Its build log fails at `CONVEX_RUNTIME_ENV_SYNC=FAIL missing SUPABASE_SERVICE_ROLE_KEY`. The `CONVEX_DEPLOY_KEY` presence check precedes that failure and passed; this does not independently prove key validity. Historical issue #333 also identifies `OPENAI_API_KEY` as requiring valid Production configuration. Neither secret is present in this session's environment. No credential value was read, printed or copied to the browser. Restore valid Sensitive/server-only values in the existing Vercel project before one reviewed-main deployment; preserve the Convex deployment gate.

The public VITROS URL returns HTTP 200 and title VITROS, but reachability does not establish the current reviewed main is deployed. PR #391's original head `6a7a059d88bfd3723cc2bd84d4d731b80e0f7d9a` had green CI and READY preview. Independent review rejected that head for employee deactivation and legacy identity/receipt defects. Repairs require fresh exact-head review and gates.

## Source and functional completion gaps

- The actual `2026 Production Plan(1).xlsx`, controlled Rev J 90-page PDF and packing-list images are absent from this workspace, including hidden-file search excluding Git/dependencies. Notes are available and preserved; they are insufficient for exact schema or controlled print acceptance. Supply originals to this workspace through an authorized source; renamed workbook acceptance must use internal schema.
- REM currently imports Tracker, Build Plan, Staff, Notes and latest VITROS WIP. Dedicated imports/storage/views for Field Status VITROS/VISION, LVCC DHR Reviews, Install Parts and Certified Parts remain. Summary operational contents are not imported. Existing preview disclosure must not be interpreted as completion.
- DHR implements controlled part consumption paths, but not the complete measurement/calibration/pass-fail/reviewer/sequential checklist or exact printable controlled artifact. The fresh live Supabase query returned zero DHR result events; production consumption proof remains unclaimed.
- Incoming Stock has capture/OCR/canonical matching/confirmation/atomic RECEIVE code. Real-source image/PDF browser acceptance and duplicate-receipt concurrency proof remain pending.
- SAP staging source checks pass and live SAP post count is zero. No production SAP transport was invoked. Browser scrolling and recovery acceptance remain pending.
- Universal configuration/editability, authenticated full route/button regression, physical iPhone/PWA/accessibility, live 30-user concurrency/realtime and observability acceptance are unfinished.

## Evidence from this pass

All public Supabase tables inspected have RLS enabled. No production business rows were changed.

Local locked-dependency build passed. Production-only dependency audit reports zero advisories; the complete dependency installation reports eight development-dependency advisories, not yet triaged.

The exact canonical-login, employee-admin and stale-operation reconciliation migrations plus their SQL fixtures passed in a disposable embedded PostgreSQL instance (PGlite), not production. Native PostgreSQL 17 checks are wired into CI. Behavioral REM parser, Incoming Stock review/identity, employee receipt/login/retry tests pass. Existing CI boundary checks, SAP staging checks and simulated 30-client refresh checks pass. Static checks and simulations do not establish live E2E, latency or device results.

## Next work

Finish and independently verify employee lifecycle recovery changes on PR #391, require fresh CI/preview and exact-head review before merge, then apply only reviewed migrations/deployments. Obtain source artifacts and complete missing REM operational imports and controlled DHR workflow. Once credentials permit reviewed production deployment, run fresh correlated DHR/RECEIVE tests, verify actual stock deltas/audit/staging, and finish authenticated route, concurrency and device acceptance.

Public login smoke was executed in Chromium on desktop (1440×900) and emulated iPhone 13: HTTP 200, expected Superuser/Engineer controls, no horizontal overflow and no page exceptions on initial load. This is not physical-device or authenticated route acceptance. Follow-up keyboard/dialog inspection found the currently served Engineer overlay did not expose a dialog role or restore focus on Escape; do not claim live accessibility completion.
