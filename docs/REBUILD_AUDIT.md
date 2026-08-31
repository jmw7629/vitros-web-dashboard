# VITROS Rebuild Audit — Phase 2B2 (Issue #30)

**Generated:** 2026-08-31
**Worktree:** issue-30
**Base commit:** ca64edf8d6d05c3e8c09b3b732172f1c7f6f6be9

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19.2, Vite 7.2, TypeScript 5.9, Tailwind CSS 4.x |
| UI library | shadcn/ui (30+ components), Radix UI, Lucide icons |
| Routing | react-router-dom v7.11 |
| Forms | react-hook-form 7.64, Zod 4.1 |
| Backend | Convex 1.31.2 (auth, actions, server functions) |
| Production DB | Supabase PostgreSQL (service_role server-side) |
| Auth | @convex-dev/auth 0.0.90, capability-based RBAC |
| Excel | xlsx 0.18.5 (currently export-only) |
| Testing | Playwright 1.57 (E2E only, no unit tests) |
| Linting | Biome 2.3 |

## Architecture

- Dual-database: Supabase (production inventory) + Convex (auth, REM, server gateway)
- All writes route through Convex server-side actions → Supabase REST API (service_role)
- Client reads via Convex actions or Supabase anon key (RLS-protected)
- Data polling: 15-second interval with debounced refresh
- RLS locked down: all new tables are service_role only, no public policies

## Current Routes

- `/dashboard` — Executive dashboard
- `/stock-summary` — Stock list
- `/incoming-stock` — OCR/CSV receiving
- `/scan-kiosk` — Barcode scan
- `/cycle-count` — Cycle count
- `/kit-analysis`, `/sap-staging`, `/sap-analytics`
- `/rem/*` — REM module (12 pages)
- `/upload-refresh` — Placeholder (not functional)
- `/rem/import` — Placeholder (not functional)

## Schema (Supabase)

### Existing tables (pre-Phase 2B2)
- `stock` — Inventory parts (part_number PK)
- `audit_log` — Immutable audit ledger
- `sap_staging` — SAP posting queue
- `kits` — Kit definitions (kit_id unique)
- `dhr_*` — DHR scan data
- `users`, `settings`

### Tables added by workbook_parity_foundation.sql
- `stock` extended: barcode, prime, expense, obsolete, stocking_plan_helper, suggested_reorder_qty
- `kits` extended: kit_barcode_value, analyzer_type, active, notes
- `stocking_plan` — Plant/SLOC stocking data (unique: plant_sloc, part_number)
- `kit_components` — Kit BOM lines (unique: kit_id, part_number)
- `inventory_batches` / `inventory_batch_lines` — Batch tracking
- `shortages` — Shortage tracking
- `transaction_reversals` — Reversal audit
- `sap_mapping` — SAP key-value config
- `sap_post_log` — SAP posting log
- `error_queue` — Error tracking
- `workbook_import_runs` — Import run tracking

## Auth/RBAC

| Role | Capabilities |
|------|-------------|
| superuser | inventory.read/write/admin, ai.ocr, rem.read/write |
| engineer | inventory.read/write, ai.ocr, rem.read/write |
| viewer | inventory.read, rem.read |

## Tests

- E2E: Playwright (scripts/demo-test.ts) — tests /dashboard, /settings, /
- Unit tests: None exist
- CI: GitHub Actions (check-secrets.mjs, biome check, tsc, vite build)

## Build Status

- `tsc --noEmit`: Passes (verified)
- `biome check .`: Passes (verified)
- `vite build`: Passes (verified)

## Defects / Risks

1. No unit test framework configured (Vitest not installed)
2. bulkImport.ts mutations are blind inserts with no validation or idempotency
3. No import engine exists for workbook data
4. Placeholder UI pages (BulkImport, UploadRefresh) are non-functional

## Phase 2B2 Scope

Implement idempotent workbook import engine with:
- Server-side Excel parsing for 5 sheet types
- Natural-key upserts (no blind inserts)
- DRY_RUN/METADATA_ONLY default (no QOH modification)
- ADMIN_QOH_MIGRATION with server-side auth + audit
- Formula normalization, Excel error rejection
- Import run tracking with row-level reporting
- Focused tests for all invariants
