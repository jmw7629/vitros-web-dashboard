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
