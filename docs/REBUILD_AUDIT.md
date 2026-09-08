# VITROS Rebuild Audit

Updated: 2026-09-07

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
- Verifier control root isolated from builder/live runtime BRIDGE_ROOT (issue #337).

## Verifier-control isolation (issue #337)

**Problem**: The verifier service was using the live VITROS builder checkout (`BRIDGE_ROOT=/home/joevps/vitros-web-dashboard`) as its control root. Since the live checkout had unreviewed working-tree changes (`.gitignore` adds `.env*`), the verifier correctly refused to operate on a dirty checkout, stalling verification.

**Architecture**: The installer now creates a dedicated, clean verifier control clone at `$HOME/.local/share/joeos-opencode-bridge/vitros-verifier-control` when `BRIDGE_ROOT` from the builder env points to the same directory as the builder control root. The verifier runner (`verifier_runner.py:main()`) gives `--root` precedence over `BRIDGE_ROOT` environment variable, so the systemd service's `ExecStart python3 --root <dedicated-path> ...` overrides the env-file `BRIDGE_ROOT`. The live builder checkout is never mutated, reset, stashed, or cleaned.

**Recovery rule**: If `BRIDGE_ROOT` in `~/.config/joeos-opencode-bridge/vitros.env` equals the builder control root, the installer provisions a dedicated clean clone and redirects the verifier to it. The original live checkout remains untouched. The systemd drop-in `20-isolated-control.conf` is no longer needed as a workaround, since the installer embeds this topology.

**Acceptance criteria**:
- `VERIFIER_CONTROL_ISOLATED`: Dedicated control root is independent from builder/live runtime
- `BUILDER_ROOT_CANNOT_REDIRECT_VERIFIER`: Builder env `BRIDGE_ROOT` cannot redirect verifier back to live checkout
- `LIVE_DIRTY_CHECKOUT_PRESERVED`: Live checkout retains its original state without modification
- `VERIFIER_DIRTY_FAIL_CLOSED`: Verifier refuses to run if its own control root is dirty
- `VERIFIER_TESTS`: All verifier unit tests pass (24/24)
- `EXACT_HEAD_VERIFIER`: Exact-head CI + independent verifier pass required
- `BLOCKERS`: none
