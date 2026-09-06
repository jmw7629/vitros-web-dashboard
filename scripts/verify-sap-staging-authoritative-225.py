#!/usr/bin/env python3
"""Independent deterministic verifier for PR #225 exact implementation head."""
from __future__ import annotations

import re
import subprocess
import sys

TARGET = "d1a432c9ad50bc3f8709d54695674ff50b8f8eb9"
BASE = "8f8d16bc48779b25937efc6444acdcf5a33c374f"
EXPECTED_TARGET_FILES = {
    ".github/workflows/sap-staging-authoritative.yml",
    "convex/sapStagingWorkflow.ts",
    "database/migrations/20260905_sap_staging_authoritative_workflow.sql",
    "docs/REBUILD_AUDIT.md",
    "scripts/sap-staging-authoritative-security-check.mjs",
    "src/hooks/useSapStagingWorkflow.ts",
    "src/pages/inventory/SapStaging.tsx",
}
EXPECTED_VERIFIER_FILES = {
    "scripts/verify-sap-staging-authoritative-225.py",
    ".github/workflows/verify-sap-staging-authoritative-225.yml",
}


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def show(path: str) -> str:
    return git("show", f"{TARGET}:{path}")


def require(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def require_all(text: str, needles: list[str], label: str) -> None:
    missing = [needle for needle in needles if needle not in text]
    require(not missing, f"{label} missing invariants: {missing}")


def main() -> int:
    require(git("cat-file", "-t", TARGET) == "commit", "exact target SHA missing")
    target_files = set(filter(None, git("diff", "--name-only", BASE, TARGET).splitlines()))
    require(target_files == EXPECTED_TARGET_FILES, f"unexpected PR #225 target diff: {sorted(target_files)}")
    verifier_files = set(filter(None, git("diff", "--name-only", TARGET, "HEAD").splitlines()))
    require(verifier_files == EXPECTED_VERIFIER_FILES, f"verifier branch scope drift: {sorted(verifier_files)}")

    page = show("src/pages/inventory/SapStaging.tsx")
    hook = show("src/hooks/useSapStagingWorkflow.ts")
    action = show("convex/sapStagingWorkflow.ts")
    migration = show("database/migrations/20260905_sap_staging_authoritative_workflow.sql")
    gate = show("scripts/sap-staging-authoritative-security-check.mjs")

    require_all(page, [
        "useSapStagingWorkflow",
        "workflow.markReady",
        "workflow.markExported",
        "max-h-[55vh] overflow-auto",
        "sticky top-0",
        "gridTemplateColumns",
        "downloadCSV",
    ], "SAP staging page")
    require("useConvexData" not in page, "SAP Staging still uses stale shared SAP mapping")
    require("readyIds" not in page and "exportedIds" not in page and "postedIds" not in page, "workflow truth remains local-only")
    require(not re.search(r"fetch\s*\([^)]*sap", page, re.IGNORECASE), "browser page appears to call SAP directly")

    require_all(hook, [
        "api.supabaseGateway.listSapStaging",
        "sapStagingWorkflow.transition",
        "row.export_status",
        "row.qty_on_hand",
        'crypto.subtle.digest("SHA-256"',
    ], "SAP authoritative hook")
    require("SUPABASE_SERVICE_ROLE_KEY" not in hook, "browser hook contains service-role handling")

    require_all(action, [
        'requireCapability(ctx, "inventory.write")',
        "p_actor: String(actorId)",
        "apply_sap_staging_status_transition",
        "ids.length > 250",
        "Duplicate SAP staging rows are not allowed",
    ], "SAP server transition")
    require(not re.search(r"args\s*:\s*\{[^}]*actor\s*:", action, re.DOTALL), "browser can supply actor")
    require("SUPABASE_SERVICE_ROLE_KEY" in action, "service-role boundary missing from server action")

    require_all(migration, [
        "pending', 'ready', 'exported', 'failed', 'cancelled",
        "sap_staging_status_events",
        "on delete restrict",
        "enable row level security",
        "before update or delete",
        "security definer",
        "set search_path = pg_catalog, public",
        "pg_advisory_xact_lock",
        "for update",
        "Only pending SAP staging rows can be marked ready",
        "Only ready SAP staging rows can be marked exported",
        "revoke all on function public.apply_sap_staging_status_transition(uuid[], text, text, text) from public, anon, authenticated",
        "grant execute on function public.apply_sap_staging_status_transition(uuid[], text, text, text) to service_role",
    ], "SAP migration")
    require(not re.search(r"update\s+public\.sap_staging\s+set[\s\S]*where\s+true", migration, re.IGNORECASE), "migration contains broad business-row rewrite")

    require_all(gate, [
        "SAP_STAGING_AUTHORITATIVE=PASS",
        "SAP_STAGING_SERVER_RBAC=PASS",
        "SAP_STAGING_ATOMIC_BATCH=PASS",
        "SAP_STAGING_IDEMPOTENCY=PASS",
        "SAP_STAGING_IMMUTABLE_HISTORY=PASS",
        "SAP_STAGING_TABLE_SYNC=PASS",
        "PRODUCTION_SAP_POST=NO",
    ], "dedicated SAP gate")

    print(f"VERIFY=PASS SHA={TARGET}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"VERIFY=FAIL SHA={TARGET} REASON={exc}", file=sys.stderr)
        raise
