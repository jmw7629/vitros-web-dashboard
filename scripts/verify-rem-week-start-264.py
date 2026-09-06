#!/usr/bin/env python3
"""Independent deterministic verifier for PR #264 exact implementation head."""
from __future__ import annotations

import re
import subprocess
import sys

TARGET = "8c37922d13d750ee0769f308a32b1736228370e4"
BASE = "3caf67a3cf448d14017e5712cd4036b17fc04fba"
EXPECTED_TARGET_FILES = {
    ".github/workflows/rem-week-start-integrity.yml",
    "scripts/rem-week-start-integrity-check.mjs",
    "supabase/migrations/20260906020000_rem_week_start_iso_integrity.sql",
}
EXPECTED_VERIFIER_FILES = {
    ".github/workflows/verify-rem-week-start-264.yml",
    "scripts/verify-rem-week-start-264.py",
}


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def show(path: str) -> str:
    return git("show", f"{TARGET}:{path}")


def require(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def require_all(text: str, needles: list[str], label: str) -> None:
    missing = [needle for needle in needles if needle.lower() not in text.lower()]
    require(not missing, f"{label} missing invariants: {missing}")


def main() -> int:
    require(git("cat-file", "-t", TARGET) == "commit", "exact target SHA missing")
    target_files = set(filter(None, git("diff", "--name-only", BASE, TARGET).splitlines()))
    require(target_files == EXPECTED_TARGET_FILES, f"unexpected PR #264 target diff: {sorted(target_files)}")
    verifier_files = set(filter(None, git("diff", "--name-only", TARGET, "HEAD").splitlines()))
    require(verifier_files == EXPECTED_VERIFIER_FILES, f"verifier branch scope drift: {sorted(verifier_files)}")

    migration = show("supabase/migrations/20260906020000_rem_week_start_iso_integrity.sql")
    gate = show("scripts/rem-week-start-integrity-check.mjs")

    require_all(migration, [
        "create or replace function public.enforce_rem_iso_week_start()",
        "set search_path = public, pg_temp",
        "new.plan_year is null",
        "new.week_number is null",
        "new.week_start is null",
        "btrim(new.week_start) = ''",
        "v_week_number <> trunc(v_week_number)",
        "v_week_number < 1",
        "v_week_number > 53",
        "extract(isoyear from v_week_start)::integer <> new.plan_year",
        "extract(week from v_week_start)::integer <> v_week_number::integer",
        "revoke all on function public.enforce_rem_iso_week_start() from public, anon, authenticated",
        "grant execute on function public.enforce_rem_iso_week_start() to service_role",
    ], "REM ISO week migration")

    for table in ("rem_tracker_weekly", "rem_build_plan", "rem_weekly_notes"):
        pattern = rf"before\s+insert\s+or\s+update\s+of\s+plan_year,\s*week_number,\s*week_start\s+on\s+public\.{table}\s+for\s+each\s+row\s+execute\s+function\s+public\.enforce_rem_iso_week_start\(\)"
        require(re.search(pattern, migration, re.IGNORECASE | re.DOTALL) is not None, f"missing trigger coverage for {table}")

    require(re.search(r"\b(delete\s+from|truncate|drop\s+table|update\s+public\.rem_|insert\s+into\s+public\.rem_)\b", migration, re.IGNORECASE) is None,
            "integrity migration rewrites REM business data")
    require("security definer" not in migration.lower(), "trigger guard unexpectedly elevates privileges")

    require_all(gate, [
        "REM_WEEK_START_ISO_YEAR_WEEK_GUARD=PASS",
        "REM_WEEK_START_BROWSER_BYPASS=CLOSED",
        "REM_WEEK_START_NO_BUSINESS_DATA_REWRITE=PASS",
    ], "dedicated regression gate")

    print(f"VERIFY=PASS SHA={TARGET}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"VERIFY=FAIL SHA={TARGET} REASON={exc}", file=sys.stderr)
        raise
