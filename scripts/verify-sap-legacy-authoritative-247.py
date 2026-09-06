#!/usr/bin/env python3
"""Independent deterministic verifier for PR #247 exact implementation head."""
from __future__ import annotations

import re
import subprocess
import sys

TARGET = "1b4a0c369313309bcb4cc64e21fec8973c50acf4"
BASE = "1b03899da6397f00ecb334f7bf7525f43f7294d6"
EXPECTED_TARGET_FILES = {
    ".github/workflows/legacy-sap-authoritative-security.yml",
    "convex/inventoryActions.ts",
    "scripts/legacy-sap-authoritative-security-check.mjs",
}
EXPECTED_VERIFIER_FILES = {
    ".github/workflows/verify-sap-legacy-authoritative-247.yml",
    "scripts/verify-sap-legacy-authoritative-247.py",
}


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def show(commit: str, path: str) -> str:
    return git("show", f"{commit}:{path}")


def require(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def require_all(text: str, needles: list[str], label: str) -> None:
    missing = [needle for needle in needles if needle not in text]
    require(not missing, f"{label} missing invariants: {missing}")


def main() -> int:
    require(git("cat-file", "-t", TARGET) == "commit", "exact PR #247 target SHA missing")
    require(git("cat-file", "-t", BASE) == "commit", "current reviewed main base SHA missing")

    target_files = set(filter(None, git("diff", "--name-only", BASE, TARGET).splitlines()))
    require(target_files == EXPECTED_TARGET_FILES, f"unexpected PR #247 target diff: {sorted(target_files)}")
    verifier_files = set(filter(None, git("diff", "--name-only", TARGET, "HEAD").splitlines()))
    require(verifier_files == EXPECTED_VERIFIER_FILES, f"verifier branch scope drift: {sorted(verifier_files)}")

    source = show(TARGET, "convex/inventoryActions.ts")
    gate = show(TARGET, "scripts/legacy-sap-authoritative-security-check.mjs")
    parent_rpc = show(BASE, "database/migrations/20260905_sap_staging_authoritative_workflow.sql")

    require_all(source, [
        'requireCapability(ctx, "inventory.write")',
        'rpc/apply_sap_staging_status_transition',
        'p_actor: actorId',
        'p_target_status: targetStatus',
        'p_correlation_id: correlationId',
        'crypto.subtle.digest("SHA-256"',
        'normalized.length === 0 || normalized.length > 250',
        'new Set(normalized).size !== normalized.length',
        'UUID_RE.test(id)',
        'status === "posted" ? "exported" : "ready"',
        'status !== "ready" && status !== "posted"',
    ], "legacy SAP server compatibility path")

    require("sap_staging?id=eq." not in source, "legacy SAP action still directly PATCHes sap_staging")
    require(not re.search(r"Promise\.all\(ids\.map[\s\S]*sap_staging", source), "legacy batch still mutates SAP staging per-row")
    require(not re.search(r"args\s*:\s*\{[^}]*actor\s*:", source, re.DOTALL), "browser can supply authoritative SAP actor")

    failure = re.search(r"if \(!res\.ok\) \{([\s\S]*?)\n  \}", source)
    require(failure is not None, "Supabase failure boundary missing")
    require(not re.search(r"res\.(json|text)\(", failure.group(1)), "provider error body may be reflected to browser")

    require_all(parent_rpc, [
        "apply_sap_staging_status_transition",
        "security definer",
        "pg_advisory_xact_lock",
        "for update",
        "sap_staging_status_events",
        "Only pending SAP staging rows can be marked ready",
        "Only ready SAP staging rows can be marked exported",
        "grant execute on function public.apply_sap_staging_status_transition(uuid[], text, text, text) to service_role",
    ], "merged parent authoritative SAP RPC")

    require_all(gate, [
        "LEGACY_SAP_AUTHORITATIVE_RPC=PASS",
        "LEGACY_SAP_DIRECT_PATCH=BLOCKED",
        "SAP_SERVER_ACTOR=PASS",
        "SAP_BATCH_ATOMICITY=PASS",
        "SAP_RETRY_CORRELATION=PASS",
        "SAP_PROVIDER_ERROR_CONTAINMENT=PASS",
        "PRODUCTION_SAP_POST=NO",
    ], "dedicated legacy SAP gate")

    require("fetch(`http" not in source and "fetch(\"http" not in source, "unexpected direct external SAP network endpoint")

    print(f"VERIFY=PASS SHA={TARGET}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"VERIFY=FAIL SHA={TARGET} REASON={exc}", file=sys.stderr)
        raise
