# VITROS Supabase RLS Model

## Security boundary

VITROS browser clients do not receive the Supabase service-role credential. Privileged inventory, SAP, user, DHR, cycle-count, kit, and REM operations must cross the authenticated Convex server boundary. Convex server actions use the Supabase service role and are responsible for capability checks and input validation.

## Default policy stance

RLS remains enabled on privileged public tables. Blanket `public` policies with `USING (true)` or `WITH CHECK (true)` are removed. With no direct browser policy, anon/authenticated PostgREST callers cannot read or mutate those tables through RLS. The Supabase service role continues to work server-side.

Any future direct browser policy must be introduced explicitly, be limited to the minimum required command (normally SELECT), and receive separate security review. Do not add anonymous INSERT/UPDATE/DELETE policies for inventory or administration tables.

## Atomic inventory RPC

`public.apply_inventory_transition` is SECURITY DEFINER because it must perform one database transaction spanning stock locking, inventory change, audit ledger insertion, SAP staging, and idempotency bookkeeping. It has a fixed `search_path = public, pg_temp` and EXECUTE is revoked from `public`, `anon`, and `authenticated`; only `service_role` and database owner retain execution.

The RPC rejects non-positive IN/RECEIVE/OUT quantities, rejects OUT quantities above available QOH, supports admin-authorized ADJUST callers, does not stage STOCKOUT as a material movement, and uses a unique correlation key so retries return the original completed result rather than applying stock twice.

## Views and functions

`public.stock_summary` is set to `security_invoker = true` so its underlying table permissions/RLS apply to the caller. Trigger functions `log_stock_change()` and `update_updated_at()` use a fixed `search_path = public, pg_temp`.

## Current live migration state

The live `vitros-ios` Supabase project has the following migrations applied as of 2026-08-30:

- `20260830215202 vitros_atomic_inventory_transition`
- `20260830215426 vitros_lock_down_public_rls`
- `20260830220325 harden_stock_summary_and_trigger_search_path`

The SQL in `database/migrations/` versions those changes in the repository so another environment can reproduce the same boundary.

## Verification

A rollback-only database test on 2026-08-30 verified:

- negative IN rejected;
- OUT above QOH rejected;
- duplicate correlation changed QOH once and produced one audit row plus one SAP staging row;
- ADJUST staged movement type `711`;
- test data was rolled back.

Supabase Security Advisor should be rerun after migration. `RLS Enabled No Policy` informational findings are expected for server-only tables and indicate direct browser access is denied by default. `security_definer_view` and mutable-function-search-path findings should be absent.

## Rollback

Do not restore blanket public ALL policies. If browser access is later required, add narrowly scoped policies after review. Reverting the atomic RPC requires first reverting application callers so inventory writes are never split back into unsafe multi-request stock/audit/SAP operations.
