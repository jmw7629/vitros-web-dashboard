# VITROS Rebuild Audit

Updated: 2026-09-05

## Current stack and deployment

- Browser: React + Vite + TypeScript.
- Server boundary: Convex actions with server-only Supabase service-role access.
- Authoritative production data: Supabase project `vitros-ios` (`oykqiiydpwngasvzdthh`).
- Browser deployment: Vercel project `vitros-web-dashboard`, linked to `jmw7629/vitros-web-dashboard`.
- Current audited Git base for this change: `main` at `3f8b41f759a5ef84ae95e51e0b57e675f4f9491d`.

## Security / architecture invariants observed

- Inventory quantity transitions route through server-authoritative actions/RPCs; browser direct stock quantity patches are blocked.
- `sap_staging` has RLS enabled in production.
- Production `sap_staging` already contains authoritative workflow fields including `export_status`, `exported_at`, `exported_by`, and `correlation_id`.
- Production currently contains 195 SAP staging records, all with `export_status = 'pending'` at the time of this audit.
- SAP browser export must remain file/staging-only. No browser control in this work may post to production SAP.

## Confirmed defect for this slice

`src/pages/inventory/SapStaging.tsx` keeps Ready/Exported workflow state in React `Set` objects. That state disappears on reload or another browser and therefore is not enterprise-authoritative. The existing shared data mapper also does not consume production `export_status` directly. The synchronized sticky table/header layout from merged PR #110 is working code and must be preserved.

## Active workstream coordination

This SAP slice intentionally avoids `src/hooks/useConvexData.tsx` because open PR #186 owns shared refresh/concurrency scheduling. It also avoids REM, DHR, Incoming Stock, Settings, and generated Convex API files touched by active PRs.

## Required gate for this slice

- Persist Ready/Exported state through authenticated server-authoritative actions.
- Derive actor server-side.
- Make batch status transition atomic and idempotent.
- Preserve immutable status history.
- Preserve the existing SAP staging visual identity and synchronized table behavior.
- Do not post to SAP.
- Exact-head CI/preview and independent exact-head verifier are required before merge.
