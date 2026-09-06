#!/usr/bin/env python3
"""Deterministic GitHub-hosted verifier for VITROS PR #223 exact implementation head."""
from __future__ import annotations

import re
import subprocess
import sys

TARGET = "d498ea5b39fded7f4fb40b2acbcb45a2fd332a29"
BASE = "a99d17b40b2bd25ec7759e88f2364005228119e5"
EXPECTED_TARGET_FILES = {
    ".github/workflows/rem-planning-read-security.yml",
    "convex/remReadActions.ts",
    "scripts/rem-planning-read-security-check.mjs",
    "src/hooks/useRemPlanningData.ts",
    "src/pages/rem/ProductionPlan.tsx",
    "src/pages/rem/StaffTraining.tsx",
}
EXPECTED_VERIFIER_FILES = {
    "scripts/verify-rem-planning-reads-223.py",
    ".github/workflows/verify-rem-planning-reads-223.yml",
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
    require(target_files == EXPECTED_TARGET_FILES, f"unexpected PR #223 target diff: {sorted(target_files)}")
    verifier_files = set(filter(None, git("diff", "--name-only", TARGET, "HEAD").splitlines()))
    require(verifier_files == EXPECTED_VERIFIER_FILES, f"verifier branch scope drift: {sorted(verifier_files)}")

    action = show("convex/remReadActions.ts")
    hook = show("src/hooks/useRemPlanningData.ts")
    plan = show("src/pages/rem/ProductionPlan.tsx")
    staff = show("src/pages/rem/StaffTraining.tsx")
    gate = show("scripts/rem-planning-read-security-check.mjs")

    marker = "export const listPlanning = action"
    require(marker in action, "listPlanning action missing")
    planning = action[action.index(marker):]
    require_all(planning, [
        'await requireCapability(ctx, "rem.read")',
        '"rem_tracker_weekly"',
        '"rem_build_plan"',
        '"rem_staff"',
        '"rem_targets"',
        'return { trackerWeekly, buildPlan, staff, targets }',
    ], "REM planning action")
    require("SUPABASE_SERVICE_ROLE_KEY" in action, "server-side Supabase service boundary missing")
    require("VITE_" not in action, "server action consumes browser VITE credential")
    for bounded in ["limit=260", "limit=80", "limit=300", "limit=100"]:
        require(bounded in planning, f"bounded read missing: {bounded}")
    require(not re.search(r"\b(insert|update|delete|upsert)\b", planning, re.IGNORECASE), "planning action contains mutation verb")

    require_all(hook, ["api.remReadActions.listPlanning", "setInterval", "clearInterval"], "REM planning hook")
    require("SUPABASE_SERVICE_ROLE_KEY" not in hook and "SUPABASE_URL" not in hook, "browser hook references server Supabase credential")

    require_all(plan, [
        "useRemPlanningData",
        'label="VITROS PLAN"',
        'label="VITROS ACTUAL"',
        'label="ATTAINMENT"',
        'label="REPORTING WEEK"',
        "Recent VITROS Weekly Plan",
        "Forecast",
        "Capacity Delta",
    ], "Production Plan")
    require("useConvexData" not in plan, "Production Plan still uses legacy aggregate")

    require_all(staff, [
        "useRemPlanningData",
        "Staff & Training",
        "FTE",
        "Training",
        "Sourced from the recurring REM production workbook",
    ], "Staff & Training")
    require("useConvexData" not in staff, "Staff & Training still uses legacy employee aggregate")

    for label, source in [("Production Plan", plan), ("Staff & Training", staff)]:
        require(not re.search(r"useMutation|useServerActions|sbUpdate|sbInsert|sbDelete|applyInventory|postSap", source, re.IGNORECASE), f"{label} contains mutation/posting path")

    require_all(gate, [
        'await requireCapability(ctx, "rem.read")',
        '"rem_tracker_weekly"',
        '"rem_build_plan"',
        '"rem_staff"',
        '"rem_targets"',
        "REM_PLANNING_READ_SECURITY=PASS",
    ], "dedicated security gate")

    print(f"VERIFY=PASS SHA={TARGET}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"VERIFY=FAIL SHA={TARGET} REASON={exc}", file=sys.stderr)
        raise
