# Phase 1B Runtime Review — Why PR #4 Was Not Safe

## PR #4 Context

PR #4 (`oc/issue-3-vitros-recovery-phase-1-secure-data-boundary-and-sta`) attempted to establish a secure data boundary by moving Supabase access server-side. While it made progress on secret removal and CI, it introduced several runtime-blocking defects.

## Blocking Defects Found

### A. Convex External Fetch Semantics

**PR #4 problem**: `convex/supabaseGateway.ts` defined functions like `listStock`, `listAuditLog` etc. as Convex `query` handlers that called external `fetch()` to Supabase.

**Why it fails**: Convex queries and mutations are deterministic functions that run in a sandboxed environment. They cannot make external HTTP calls. Only `action` handlers can call external APIs.

**Fix applied**: All Supabase HTTP access now occurs in `action` handlers in `convex/supabaseGateway.ts`. The action handlers call `requireCapability()` for authorization, then perform the external fetch.

### B. Action Authorization Cannot Use ctx.db

**PR #4 problem**: `convex/authGuard.ts` defined `requireCapability` that accepted a generic `Ctx` type (including `ActionCtx`) and called `ctx.db.get(userId)`. In Convex, action contexts do not have a `ctx.db` property — this would fail at runtime with a TypeError.

**Why it fails**: Convex actions have no direct database access. They can only call `ctx.runQuery()` (which delegates to a query function that does have `ctx.db`) or `ctx.runMutation()`.

**Fix applied**: `authGuard.ts` now has separate `requireCapability()` (for queries/mutations, uses `ctx.db` directly) and `requireCapabilityAction()` (for actions, uses `ctx.runQuery()` to delegate to an internal query). No `as any` bridge is used.

### C. Convex Auth Provider Must Wrap the SPA

**PR #4 problem**: `src/main.tsx` added a plain `ConvexReactClient` but did not wrap the app with `ConvexAuthProvider` from `@convex-dev/auth/react`. Components using `useConvexAuth()` and `useAuthActions()` would fail at runtime with context errors.

**Why it fails**: `useConvexAuth()` and `useAuthActions()` require a `ConvexAuthProvider` in the React component tree. Without it, these hooks return undefined/null.

**Fix applied**: `src/main.tsx` now uses `<ConvexAuthProvider client={convex}>` to wrap the entire app, enabling all auth-related hooks.

### D. Server Identity Must Be Authoritative

**PR #4 problem**: The existing `RoleLogin` with localStorage role remained the authorization mechanism. No server-side role verification was implemented.

**Why it fails**: Any user can modify localStorage to escalate their role. Client-side role checks are trivially bypassable.

**Fix applied**: 
- `useRole.tsx` now queries `api.auth.currentUser` from Convex to get the server-authoritative role
- `App.tsx` uses `useConvexAuth()` to gate access (unauthenticated users see sign-in)
- Local localStorage role is preserved only as a presentation mirror for UI compatibility
- New accounts default to `viewer` (least privilege)

### E. Primary Inventory Reads Must Not Bypass Server

**PR #4 problem**: `useConvexData.tsx` used `sbAnonQuery` with the anon key for reads, and hardcoded `SERVICE_KEY` for writes in DhrScanner/IncomingStock.

**Why it fails**: The anon key with RLS was not verified. More critically, the service_role key was still hardcoded in browser code, exposing it to anyone who views source.

**Fix applied**:
- All inventory reads now route through Convex actions (server-side, authenticated)
- Anon key fallback exists only for backward compatibility when auth is not yet ready
- All hardcoded service_role keys removed from DhrScanner, IncomingStock, and useConvexData
- Service_role key is only used in Convex actions (server-side)

### F. Generic v.any() Mutations

**PR #4 problem**: Supabase mutations used `v.any()` for data parameters, allowing arbitrary row payloads.

**Why it fails**: No input validation means any client can write arbitrary data to any column, bypassing business rules.

**Fix applied**: `convex/inventoryActions.ts` implements domain-specific validated actions:
- `scanStockTransition`: Validates mode, qty, computes before/after server-side, writes audit+SAP
- `createStockItem`: Validates partNumber, description, type, numeric fields
- `updateStockItem`: Validates each field type
- `deleteStockItem`: Requires `inventory.admin` capability
- `updateSapStatus`: Validates status enum

### G. Environment Configuration

**PR #4 problem**: `.env.example` mixed client and server variables without clear distinction.

**Fix applied**: `.env.example` now clearly separates client-safe (`VITE_*`) from server-only variables, with documentation about the compromised credential.

## Validation

- TypeScript compilation passes (no `ctx.db` in action type signatures)
- No external fetch in query/mutation handlers (verified by inspection)
- ConvexAuthProvider present in component tree
- No hardcoded secrets in frontend source (verified by secret scanner)
- All inventory writes go through validated domain actions
- Role lookup is server-authoritative via Convex user record
