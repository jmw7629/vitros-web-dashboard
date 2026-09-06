#!/usr/bin/env python3
"""Deterministic GitHub-hosted verifier for VITROS PR #221 exact head."""
from __future__ import annotations

import re
import subprocess
import sys

TARGET = "52349d8a525a5944190dfbf258a8949da6cf4fed"
BASE = "eafbc119a79ed6e1c117bd1296caca2dc5f1612d"
EXPECTED_TARGET_FILES = {
    ".github/workflows/rem-authoritative-workbook-security.yml",
    "convex/_generated/api.d.ts",
    "convex/remWorkbookActions.ts",
    "scripts/rem-authoritative-workbook-security-check.mjs",
    "scripts/rem-workbook-import-security-check.mjs",
    "src/lib/remWorkbookAuthoritative.ts",
    "src/pages/rem/BulkImport.tsx",
    "supabase/migrations/20260905074500_rem_authoritative_workbook_parity.sql",
}
EXPECTED_VERIFIER_FILES = {
    "scripts/verify-rem-authoritative-workbook-221.py",
    ".github/workflows/verify-rem-authoritative-workbook-221.yml",
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
    require(target_files == EXPECTED_TARGET_FILES, f"unexpected PR #221 target diff: {sorted(target_files)}")
    verifier_files = set(filter(None, git("diff", "--name-only", TARGET, "HEAD").splitlines()))
    require(verifier_files == EXPECTED_VERIFIER_FILES, f"verifier branch scope drift: {sorted(verifier_files)}")

    parser = show("src/lib/remWorkbookAuthoritative.ts")
    ui = show("src/pages/rem/BulkImport.tsx")
    action = show("convex/remWorkbookActions.ts")
    migration = show("supabase/migrations/20260905074500_rem_authoritative_workbook_parity.sql")

    require_all(parser, [
        "function inferPlanYear(workbook",
        "function latestVitrosWip(workbook",
        "function parseAnalyzers(",
        "function parseTracker(",
        "function parseBuildPlan(",
        "function parseStaff(",
        "function parseWeeklyNotes(",
        "trackerWeekly",
        "buildPlan",
        "weeklyNotes",
        "targets",
        "recognizedSheets",
        "REM workbook year could not be established from its internal summary sheet",
    ], "REM workbook parser")
    for signature in ('"tracker"', '"build plan"', '"staff"', '"notes - issues"'):
        require(signature in parser, f"missing internal workbook signature {signature}")
    require(not re.search(r"fileName[^\n]{0,120}(includes|match|startsWith|endsWith)", parser), "filename is being used as workbook identity")

    require_all(ui, [
        'type="file"',
        'accept=".xlsx,.xls',
        "inputRef.current?.click()",
        "parseAuthoritativeRemWorkbook",
        "api.remWorkbookActions.applyAuthoritativeWorkbookImport",
        "Tracker rows",
        "Build-plan rows",
        "Staff rows",
        "Weekly notes",
        "Annual targets",
        "Apply Authoritative REM Update",
        "Internal workbook structure is authoritative; the filename may change.",
    ], "REM upload UI")

    require_all(action, [
        'requireCapability(ctx, "rem.write")',
        "const userId = await requireCapability",
        "p_actor: String(userId)",
        "apply_rem_authoritative_workbook_import",
        "SUPABASE_SERVICE_ROLE_KEY",
    ], "REM server action")
    require("VITE_" not in action, "REM authoritative action must not consume browser VITE credentials")

    lower = migration.lower()
    require_all(lower, [
        "security definer",
        "set search_path = public, pg_temp",
        "pg_advisory_xact_lock",
        "rem_authoritative_import_runs",
        "reject_rem_authoritative_import_run_mutation",
        "insert into public.audit_log",
        "revoke all on function public.apply_rem_authoritative_workbook_import",
        "from public, anon, authenticated",
        "grant execute on function public.apply_rem_authoritative_workbook_import",
        "to service_role",
    ], "REM authoritative migration")
    require(not re.search(r"\bdelete\s+from\s+public\.rem_", lower), "REM import contains destructive delete")
    require(not re.search(r"\btruncate\s+(table\s+)?public\.rem_", lower), "REM import contains destructive truncate")

    print(f"VERIFY=PASS SHA={TARGET}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"VERIFY=FAIL SHA={TARGET} REASON={exc}", file=sys.stderr)
        raise
