# VITROS Staging Deployment Runbook

## Prerequisites

1. **Credential rotation**: The previously exposed Supabase service-role key MUST be rotated before deployment.
2. Convex project configured with auth providers (Password, ViktorSpacesEmail).
3. Supabase project with RLS policies configured.

## Environment Variables

### Convex Dashboard (server-side)
```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<rotated key>
OPENAI_API_KEY=<key for OCR>
VIKTOR_SPACES_API_URL=<configured>
VIKTOR_SPACES_PROJECT_NAME=<configured>
VIKTOR_SPACES_PROJECT_SECRET=<configured>
```

### Hosting Platform (client-side)
```
VITE_CONVEX_URL=https://<project>.convex.cloud
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

## Deployment Steps

1. Ensure all environment variables are set in Convex dashboard and hosting platform.
2. Run `npm ci && npm run build` locally to verify build succeeds.
3. Deploy Convex functions: `npx convex deploy`
4. Deploy frontend to hosting platform.
5. Verify: `node scripts/check-secrets.mjs` passes (no hardcoded secrets).
6. Verify: Sign-in flow works (email/password).
7. Verify: Inventory data loads through server-side actions.
8. Verify: Stock scan transition works with server-side computation.

## Post-Deployment Verification

- [ ] No `SUPABASE_SERVICE_ROLE_KEY` in client bundle
- [ ] Convex Auth sign-in completes successfully
- [ ] Server-side role lookup returns correct role
- [ ] Stock reads load through Convex actions
- [ ] Stock write transitions compute qty server-side
- [ ] Audit records are created with correlation IDs
- [ ] SAP staging records are created
- [ ] OCR pipeline works through server-side AI gateway

## Rollback

1. Revert to previous deployment.
2. If Convex functions were deployed, rollback via Convex dashboard.
3. Ensure Supabase RLS policies are still intact.

## Manual Actions After Merge

1. **Rotate Supabase service-role key** (the old one is compromised).
2. Set new key in Convex dashboard environment variables.
3. Verify all Convex actions can still access Supabase.

## Employee lifecycle access recovery (2026-09-12)

Supabase remains the canonical employee directory. Convex stores a restrictive
access barrier, not another editable copy of employee active status. Every change
to an existing employee installs a pending barrier before its atomic SQL request.
Existing sessions and the final engineer sign-in callback check this barrier.
Missing barriers deny preexisting sessions at rollout; fresh canonical active
login provisions a missing barrier. Login never overwrites blocked/pending state.
Confirmed inactive receipts keep access blocked; only a matching committed active
receipt releases it. Completed correlation replays cannot change newer barriers.

A definitive SQL rejection restores the previous barrier state only after all
known concurrent invocations have rejected. A version conflict also runs the
service-role-only reconciliation RPC under the original correlation/employee
locks: an exact immutable receipt completes the operation; otherwise a current
version strictly above the expected version proves no outstanding invocation can
ever commit and safely resolves even a lost rejection response. Equal/future
versions, missing rows and malformed proofs never release unknown invocations. Network loss, malformed receipts or
an interrupted action leave the operation pending and access suspended. There is
no timeout that silently restores access. Retry the original employee action with
exactly the original arguments and correlation ID. The SQL RPC then returns its
idempotent receipt or safely attempts the original transaction, and Convex finishes
the pending barrier. Identical rejected requests can retry after their cause is
corrected; different requests wait until the pending operation is resolved.
Unknown equal/future-version outcomes still require exact replay or separately
reviewed reconciliation; this bounded recovery is not a general cancellation API.

Browser retry correlations are deterministic for actor, employee, action,
expected version and normalized patch. If a refresh changes the displayed version
before recovery, an administrator must recover the **original** request rather
than submit the new version. Inspect the server-only `employeeAccessOperations`
record named by the pending correlation: `requestKey` contains the original RPC
parameters. Retry the corresponding authenticated employee action with those
original parameters/correlation as the original administrative actor. Do not
manually delete barriers, invent a successful receipt, or change Supabase active
status outside the reviewed transition path. Escalate an unrecoverable original
actor/request for a separately reviewed administrative recovery operation.

Local verification: `node scripts/employee-access-check.mjs` executes the actual
barrier and capability handlers with synthetic state and interleavings;
`node scripts/employee-boundary-check.mjs` checks RPC ordering, nullable legacy
receipts, confirmed rejection and uncertain-response containment. These are not
claims of live deployment or live 30-user concurrency verification.
