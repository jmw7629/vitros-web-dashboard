# VITROS Security Model

## Architecture

VITROS uses a dual-data-source architecture:

- **Supabase**: Primary inventory data store (stock, audit_log, sap_staging, users, settings, DHR tables)
- **Convex**: Auth system, REM tracker data, and server-side action gateway

## Secret Containment

### Client-safe (browser)
- `VITE_CONVEX_URL` — Convex deployment URL (public)
- `VITE_SUPABASE_URL` — Supabase project URL (public)
- `VITE_SUPABASE_ANON_KEY` — Supabase anonymous key (RLS-protected, read-only)

### Server-only (NEVER in browser)
- `SUPABASE_SERVICE_ROLE_KEY` — Bypasses RLS, used only in Convex actions
- `OPENAI_API_KEY` — Used only in Convex AI gateway actions
- `AUTH_PRIVATE_KEY` / `JWT_PRIVATE_KEY` — Convex auth signing keys
- `VIKTOR_SPACES_*` — Viktor Spaces integration secrets

### Previously compromised
The Supabase service-role credential that was previously hardcoded in frontend files is **COMPROMISED** and must be rotated. It must never be reused.

## Data Flow

```
Browser → ConvexAuthProvider → Convex Actions (server-side) → Supabase REST API
         ↓
         → Anon key reads (RLS-protected, for backward compat)
         → REM/Kits/CycleCount reads (Convex production backend)
```

### Inventory Reads
- Primary: Routed through Convex actions (`supabaseGateway.*`) using server-side service role key
- Fallback: Anon key reads for backward compatibility (RLS-protected)

### Inventory Writes
- ALL writes go through Convex actions (domain-specific, validated)
- `scanStockTransition`: Server-side computation of qtyBefore/qtyAfter with correlation/idempotency keys
- `createStockItem`, `updateStockItem`, `deleteStockItem`: Validated stock CRUD
- `updateSapStatus`, `markSapBatchReady`, `markSapBatchExported`: SAP staging mutations

### AI/OCR
- All OpenAI calls happen in `aiGateway.ts` actions (server-side)
- Image size validation (10MB max), prompt length limits, error sanitization
- 3-retry logic with exponential backoff

## Authorization

### Role System
- Roles: `superuser`, `engineer`, `viewer`
- Default for new accounts: `viewer` (least privilege)
- Roles stored in Convex `users` table, authoritative server-side
- Local localStorage role is presentation-only mirror

### Capability Matrix
| Capability | superuser | engineer | viewer |
|-----------|-----------|----------|--------|
| inventory.read | ✓ | ✓ | ✓ |
| inventory.write | ✓ | ✓ | |
| inventory.admin | ✓ | | |
| ai.ocr | ✓ | ✓ | |
| rem.read | ✓ | ✓ | ✓ |
| rem.write | ✓ | ✓ | |

### Enforcement
- All gateway functions call `requireCapability(ctx, capability)` before data access
- Actions use `requireCapabilityAction()` which delegates to an internal query via `ctx.runQuery()`
- Queries/mutations use `requireCapability()` directly (has `ctx.db` access)

## Remaining Gaps

1. **RLS verification**: Anon key reads assume RLS policies are correctly configured in Supabase. This has not been verified.
2. **Supabase multi-request transactions**: Writes that span multiple Supabase requests (stock update + audit log + SAP staging) are not atomic. Partial failure is documented per-operation.
3. **REM data**: REM tracker data is still served directly from the Convex production backend via raw HTTP. This bypasses the server-side auth gateway but does not expose secrets.
