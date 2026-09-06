#!/usr/bin/env python3
"""Deterministic GitHub-hosted verifier for VITROS PR #231 exact head."""
from __future__ import annotations

import subprocess
import sys

TARGET = "38f2a554412949745a14708f7cc33b9fc69b3162"
BASE = "3f8b41f759a5ef84ae95e51e0b57e675f4f9491d"
EXPECTED_TARGET_FILES = {
    ".github/workflows/dhr-controlled-canonical-security.yml",
    "scripts/dhr-controlled-canonical-security-check.mjs",
    "scripts/dhr-legacy-baseline-security-check.mjs",
    "supabase/migrations/20260905124500_dhr_controlled_canonical_transition.sql",
    "supabase/migrations/20260905191500_dhr_legacy_baseline_guard.sql",
}
EXPECTED_VERIFIER_FILES = {
    "scripts/verify-dhr-controlled-canonical-231.py",
    ".github/workflows/verify-dhr-controlled-canonical-231.yml",
}


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def show(path: str) -> str:
    return git("show", f"{TARGET}:{path}")


def require(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def require_all(text: str, needles: list[str], label: str) -> None:
    missing = [n for n in needles if n not in text]
    require(not missing, f"{label} missing invariants: {missing}")


def main() -> int:
    require(git("cat-file", "-t", TARGET) == "commit", "exact target SHA missing")
    target_files = set(filter(None, git("diff", "--name-only", BASE, TARGET).splitlines()))
    require(target_files == EXPECTED_TARGET_FILES, f"unexpected PR #231 target diff: {sorted(target_files)}")
    verifier_files = set(filter(None, git("diff", "--name-only", TARGET, "HEAD").splitlines()))
    require(verifier_files == EXPECTED_VERIFIER_FILES, f"verifier branch scope drift: {sorted(verifier_files)}")

    transition = show("supabase/migrations/20260905124500_dhr_controlled_canonical_transition.sql")
    baseline = show("supabase/migrations/20260905191500_dhr_legacy_baseline_guard.sql")
    security = show("scripts/dhr-controlled-canonical-security-check.mjs")
    baseline_security = show("scripts/dhr-legacy-baseline-security-check.mjs")

    require_all(transition, [
        "SECURITY DEFINER",
        "SET search_path = public, pg_temp",
        "pg_advisory_xact_lock(hashtextextended('dhr-correlation|'",
        "pg_advisory_xact_lock(hashtextextended(\n    'dhr-field|'",
        "FROM public.dhr_scan_result_events\n  WHERE correlation_id = p_correlation_id",
        "FROM public.dhr_scan_sessions\n  WHERE id = p_session_id\n  FOR UPDATE",
        "lower(btrim(coalesce(v_session.status, ''))) <> 'in_progress'",
        "FROM public.dhr_expected_parts",
        "analyzer_model = v_session.analyzer_model",
        "section_id = p_section_id",
        "upper(btrim(part_number)) = v_canonical_part",
        "v_expected_qty := v_expected.bom_qty",
        "v_category := btrim(v_expected.category)",
        "v_description := v_expected.description",
        "v_session.instrument_sn",
        "DHR revision conflict",
        "FROM public.stock",
        "FOR UPDATE",
        "public.apply_inventory_transition(",
        "INSERT INTO public.dhr_scan_result_events",
        "REVOKE ALL ON FUNCTION public.apply_dhr_scan_transition(",
        "FROM PUBLIC, anon, authenticated",
        "TO service_role",
    ], "controlled transition")

    # Browser-carried compatibility metadata must not be authoritative in the body.
    require(transition.count("p_expected_qty") == 1, "caller expected quantity is still consumed")
    require(transition.count("p_category") == 1, "caller category is still consumed")
    require(transition.count("p_description") == 1, "caller description is still consumed")
    require(transition.count("p_analyzer_serial") == 1, "caller analyzer serial is still consumed")

    # Exact retry must be resolved before lifecycle rejection so a committed request remains replay-safe.
    retry_pos = transition.index("WHERE correlation_id = p_correlation_id")
    lifecycle_pos = transition.index("DHR session is not open for inventory consumption")
    require(retry_pos < lifecycle_pos, "idempotent replay is checked after lifecycle rejection")

    require_all(baseline, [
        "CREATE OR REPLACE FUNCTION public.guard_dhr_legacy_inventory_baseline()",
        "coalesce(OLD.scanned_qty, 0) > 0",
        "NEW.scanned_qty IS DISTINCT FROM OLD.scanned_qty",
        "NEW.revision IS DISTINCT FROM OLD.revision",
        "NOT EXISTS (",
        "FROM public.dhr_scan_result_events AS event",
        "WHERE event.result_id = OLD.id",
        "Legacy DHR result requires inventory reconciliation before scanner mutation",
        "BEFORE UPDATE OF scanned_qty, revision",
        "REVOKE ALL ON FUNCTION public.guard_dhr_legacy_inventory_baseline()",
        "FROM PUBLIC, anon, authenticated",
        "TO service_role",
    ], "legacy baseline quarantine")

    require_all(security, [
        "dhr-controlled-canonical",
        "apply_dhr_scan_transition",
    ], "controlled security regression")
    require_all(baseline_security, [
        "legacy",
        "dhr_scan_result_events",
    ], "legacy quarantine regression")

    print(f"VERIFY=PASS SHA={TARGET}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"VERIFY=FAIL SHA={TARGET} REASON={exc}", file=sys.stderr)
        raise
