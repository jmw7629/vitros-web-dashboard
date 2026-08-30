# VITROS Runbook

## Staging Deployment Sequence

### Prerequisites
1. Convex project created and linked
2. Supabase project with service_role key generated
3. OpenAI API key generated
4. Environment variables set in Convex dashboard

### Environment Variables Required

**Convex dashboard (Settings → Environment Variables):**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-key
OPENAI_API_KEY=sk-...your-key
```

**Vercel/hosting (Environment Variables):**
```
VITE_CONVEX_URL=https://your-deployment.convex.cloud
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key
```

### Steps
1. Set server-side environment variables in Convex dashboard
2. Set client-side environment variables in hosting platform
3. Run `npx convex dev --once` to sync schema
4. Run `npm run build` to verify build
5. Deploy to staging

### Post-Deployment Verification
- [ ] Login works
- [ ] Inventory dashboard loads data
- [ ] Scan Kiosk works
- [ ] Incoming Stock OCR works
- [ ] DHR Scanner works
- [ ] REM tracker loads
- [ ] No secrets visible in browser DevTools Network tab

## Rollback Sequence
1. Revert to previous Git commit/branch
2. Redeploy previous build
3. No data migration needed (Supabase data unchanged)

## Required Manual Actions After Merge
1. **Rotate Supabase service_role key** — old key was exposed in client source
2. **Rotate OpenAI API key** — if it was ever used in client code
3. **Verify Supabase RLS policies** — ensure anon key reads are appropriately restricted
4. **Set Convex environment variables** — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`
5. **Set hosting environment variables** — `VITE_CONVEX_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Troubleshooting

### "Not authenticated" errors
- Check Convex Auth is properly configured
- Verify `AUTH_PRIVATE_KEY` and `JWT_PRIVATE_KEY` are set in Convex

### "Missing capability" errors
- User role may not have required permissions
- Check user's role in Convex `users` table

### Supabase reads return empty
- Check `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set
- Verify RLS policies allow anon reads

### OCR fails
- Check `OPENAI_API_KEY` is set in Convex dashboard
- Verify key is valid and has API credits
