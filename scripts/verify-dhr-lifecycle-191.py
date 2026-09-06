#!/usr/bin/env python3
from __future__ import annotations
import subprocess, sys
TARGET='b7fe14ceb8bacde4727512e7c3734c8c6d01bc40'
BASE='3f8b41f759a5ef84ae95e51e0b57e675f4f9491d'
EXPECTED={'.github/workflows/ci.yml','convex/dhrInventoryActions.ts','database/migrations/20260904_dhr_session_lifecycle_revisions.sql','scripts/dhr-session-lifecycle-security-check.mjs'}
VERIFIER={'scripts/verify-dhr-lifecycle-191.py','.github/workflows/verify-dhr-lifecycle-191.yml'}
def git(*a): return subprocess.check_output(['git',*a],text=True).strip()
def show(p): return git('show',f'{TARGET}:{p}')
def req(x,m):
    if not x: raise AssertionError(m)
def allin(s, xs, label):
    miss=[x for x in xs if x not in s]; req(not miss,f'{label} missing {miss}')
def main():
    req(set(filter(None,git('diff','--name-only',BASE,TARGET).splitlines()))==EXPECTED,'target scope drift')
    req(set(filter(None,git('diff','--name-only',TARGET,'HEAD').splitlines()))==VERIFIER,'verifier scope drift')
    m=show('database/migrations/20260904_dhr_session_lifecycle_revisions.sql'); a=show('convex/dhrInventoryActions.ts')
    allin(m,['ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0','CREATE TABLE IF NOT EXISTS public.dhr_scan_session_events','correlation_id text NOT NULL UNIQUE','ON DELETE RESTRICT','DHR session lifecycle history is immutable','CREATE OR REPLACE FUNCTION public.apply_dhr_session_lifecycle','SECURITY DEFINER','SET search_path = public, pg_temp','pg_advisory_xact_lock','FOR UPDATE','DHR session revision conflict','revision = v_session.revision + 1','FROM PUBLIC, anon, authenticated','TO service_role'],'migration')
    for bad in ['UPDATE public.stock','INSERT INTO public.audit_log','INSERT INTO public.sap_staging']:
        req(bad not in m,f'lifecycle improperly moves inventory/audit/SAP: {bad}')
    allin(a,['requireCapability(ctx, "inventory.write")','resolveAuditActor(ctx, userId, serviceKey, url)','/rest/v1/rpc/apply_dhr_session_lifecycle','dhr_scan_sessions?select=id,status,revision','if (currentStatus === args.status)','dhr_scan_session_events?select=id,session_id,from_status,to_status,revision_before,revision_after,actor,created_at','return { ...events[0], duplicate: true }','p_expected_revision: revision'],'server action')
    req('p_actor: args.' not in a,'caller actor authority found')
    print(f'VERIFY=PASS SHA={TARGET}')
if __name__=='__main__':
    try: main()
    except Exception as e:
        print(f'VERIFY=FAIL SHA={TARGET} REASON={e}',file=sys.stderr); raise
