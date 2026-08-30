# VITROS Implementation Status

**Date:** 2026-08-30
**Phase:** 0 — Recovery baseline

---

## Status Legend

- **Implemented** — Code exists and compiles
- **Wired** — Connected to a real data source (Supabase or Convex)
- **Tested** — Has runnable test coverage (Playwright or unit)
- **Production-ready** — Secure, audited, deployable
- **Blocker** — What prevents this from being production-ready

---

## Inventory Module

| Module | Implemented | Wired to Persistence | Tested | Production-ready | Blocker/Evidence |
|--------|:-----------:|:-------------------:|:------:|:----------------:|------------------|
| Executive Dashboard | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests; client-side only |
| User Dashboard | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests; hardcoded role check |
| Scan Kiosk | ✓ | ✓ (Supabase) | ✗ | ✗ | ZXing WASM barcode; no tests |
| Stock Summary | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests |
| Incoming Stock | ✓ | ✓ (Supabase) | ✗ | ✗ | OpenAI key in client; OCR learning table |
| Reorder/Stockout | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests |
| Transaction Search | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests; unused imports |
| Aged Inventory | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests |
| WIP & Cycle Time | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests |
| Inventory Turnover | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests |
| Inventory Accuracy | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests |
| Analyzer Analysis | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests |
| ABC Analysis | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests |
| Kit Analysis | ✓ | ✓ (Convex) | ✗ | ✗ | Read-only; no mutations |
| SAP Staging | ✓ | ✓ (Supabase) | ✗ | ✗ | No actual SAP connection |
| SAP Analytics | ✓ | ✓ (Supabase) | ✗ | ✗ | No actual SAP connection |
| Cycle Count | ✓ | ✓ (Convex dev) | ✗ | ✗ | Hardcoded Convex URL; requires bun for tests |
| DHR Scanner | ✓ | ✓ (Supabase) | ✗ | ✗ | Service role key in client; 1732 lines |
| Health Heatmap | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests |
| E-Connectivity | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests |

---

## REM Module

| Module | Implemented | Wired to Persistence | Tested | Production-ready | Blocker/Evidence |
|--------|:-----------:|:-------------------:|:------:|:----------------:|------------------|
| REM Dashboard | ✓ | ✓ (Convex) | ✗ | ✗ | No tests |
| Morning Snapshot | ✓ | ✓ (Convex) | ✗ | ✗ | No tests |
| Kanban Board | ✓ | ✓ (Convex) | ✗ | ✗ | No tests |
| Gantt Timeline | ✓ | ✓ (Convex) | ✗ | ✗ | No tests |
| Engineer Kiosk | ✓ | ✓ (Convex) | ✗ | ✗ | No tests; label without htmlFor |
| Analyzers | ✓ | ✓ (Convex) | ✗ | ✗ | No tests |
| LVCC Tracker | ✓ | ✓ (Convex) | ✗ | ✗ | No tests |
| Production Plan | ✓ | ✓ (Convex) | ✗ | ✗ | No tests |
| Field Status | ✓ | ✓ (Convex) | ✗ | ✗ | No tests; unused import |
| Staff & Training | ✓ | ✓ (Convex) | ✗ | ✗ | No tests |
| Weekly Notes | ✓ | ✓ (Convex) | ✗ | ✗ | No tests |
| REM Reports | ✓ | ✓ (Convex) | ✗ | ✗ | No tests |
| Bulk Import | ✓ | ✓ (Convex) | ✗ | ✗ | No validation/RBAC on imports |
| Build Plan | ✓ | ✗ (Stub) | ✗ | ✗ | Returns empty array `[]` |
| REM Tracker | ✓ | ✗ (Stub) | ✗ | ✗ | Returns empty array `[]` |

---

## Reports Module

| Module | Implemented | Wired to Persistence | Tested | Production-ready | Blocker/Evidence |
|--------|:-----------:|:-------------------:|:------:|:----------------:|------------------|
| Executive Report | ✓ | ✓ (Supabase) | ✗ | ✗ | SVG accessibility issue |
| Mobile Quick View | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests |
| Report Preview | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests |
| Upload/Refresh | ✓ | ✓ (Supabase) | ✗ | ✗ | Unused state variables |

---

## Core Infrastructure

| Module | Implemented | Wired to Persistence | Tested | Production-ready | Blocker/Evidence |
|--------|:-----------:|:-------------------:|:------:|:----------------:|------------------|
| Auth (RoleLogin) | ✓ | ✗ (localStorage) | ✗ | ✗ | Client-only; hardcoded password "12345" |
| Auth (Convex) | ✓ | ✓ (Convex) | ✗ | ✗ | ViktorSpaces email provider; no test coverage |
| Theme System | ✓ | ✓ (localStorage) | ✗ | ✓ | 5 palettes; works locally |
| Navigation | ✓ | N/A | ✗ | ✗ | Hardcoded routes; no RBAC filtering |
| Error Boundary | ✓ | N/A | ✗ | ✓ | Class component; catches render errors |
| Settings | ✓ | ✓ (Supabase) | ✗ | ✗ | No tests |
| Landing/Login/Signup | ✓ | ✓ (Convex Auth) | ✗ | ✗ | Not routed in main app |

---

## Backend (Convex)

| Function File | Implemented | Has RBAC | Has Audit | Production-ready | Blocker/Evidence |
|---------------|:-----------:|:--------:|:---------:|:----------------:|------------------|
| auth.ts | ✓ | ✓ (Convex Auth) | ✗ | ✓ | Working auth provider |
| transactions.ts | ✓ | ✗ | ✗ | ✗ | No authorization; no idempotency |
| parts.ts | ✓ | ✗ | ✗ | ✗ | Backward compat; no auth |
| cycleCount.ts | ✓ | ✗ | ✗ | ✗ | Complete logic; no auth |
| dhr.ts | ✓ | ✗ | ✗ | ✗ | Complete logic; no auth |
| bulkImport.ts | ✓ | ✗ | ✗ | ✗ | v.any() — no validation |
| rem.ts | ✓ | ✗ | ✗ | ✗ | Functional; no auth |
| kits.ts | ✓ | ✗ | ✗ | ✗ | Read-only |
| employees.ts | ✓ | ✗ | ✗ | ✗ | Minimal |
| users.ts | ✓ | ✓ (self) | ✗ | ✓ | Only deleteAccount with auth check |
| seed.ts | ✓ (no-op) | N/A | N/A | N/A | Placeholder |
| seedTestUser.ts | ✓ | N/A | N/A | ✗ | Hardcoded test credentials |

---

## Testing

| Category | Status | Evidence |
|----------|--------|----------|
| Unit tests | ✗ None | No test files found |
| E2E scripts | ✓ (Playwright) | `scripts/test.ts`, `scripts/auth.ts`, `scripts/demo-test.ts` |
| E2E runnable | ✗ | Requires bun (`bun run --bun scripts/test.ts`) |
| CI/CD | ✗ None | No GitHub Actions, no CI config |
| Lint | ✓ | Biome — 85 errors, 70 warnings (all existing code) |
| Typecheck | ✓ | `tsc --noEmit` passes |
| Build | ✓ | `npm run build` succeeds |

---

## Security Summary

| Issue | Severity | Status |
|-------|----------|--------|
| Supabase service_role key in client bundle | P0 | **Open** — needs env var migration |
| Supabase anon key in client bundle | P0 | **Open** — needs env var migration |
| OpenAI key exposed to client | P0 | **Open** — needs proxy/Edge function |
| Hardcoded superuser password | P1 | **Open** — needs server-side auth |
| No RBAC on mutations | P1 | **Open** — needs Convex auth middleware |
| Bulk import accepts any data | P1 | **Open** — needs validation |
| Client-only role system | P1 | **Open** — needs server-side verification |
| 12 npm vulnerabilities | P2 | **Open** — `npm audit fix` available |

---

## Summary

| Metric | Value |
|--------|-------|
| Total frontend files | 127 (.ts/.tsx) |
| Total convex files | 29 (.ts) |
| Frontend LOC (main files) | ~28,000 |
| Convex LOC | ~1,400 |
| Route count | 37 routes (20 inventory + 13 REM + 4 reports + settings) |
| Build status | ✓ Passes |
| Typecheck status | ✓ Passes |
| Lint status | ✗ 85 errors (existing) |
| Test status | ✗ Cannot run (requires bun) |
| Deployment status | ✗ Not configured |
| Security status | ✗ P0 issues open |
