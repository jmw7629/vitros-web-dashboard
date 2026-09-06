#!/usr/bin/env python3
"""Independent deterministic verifier for PR #186 exact implementation head."""
from __future__ import annotations

import re
import subprocess
import sys

TARGET = "076aac2a04c1ed3127ed3e2a7215816726e3dd4f"
BASE = "b3d49203ca3a15640eb8abd2c31df9909887bc24"
EXPECTED_TARGET_FILES = {
    ".github/workflows/ci.yml",
    "scripts/refresh-coordinator-check.mjs",
    "src/hooks/useConvexData.tsx",
    "src/lib/refreshCoordinator.d.mts",
    "src/lib/refreshCoordinator.mjs",
}
EXPECTED_VERIFIER_FILES = {
    "scripts/verify-refresh-storm-186.py",
    ".github/workflows/verify-refresh-storm-186.yml",
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
    require(target_files == EXPECTED_TARGET_FILES, f"unexpected PR #186 target diff: {sorted(target_files)}")
    verifier_files = set(filter(None, git("diff", "--name-only", TARGET, "HEAD").splitlines()))
    require(verifier_files == EXPECTED_VERIFIER_FILES, f"verifier branch scope drift: {sorted(verifier_files)}")

    ci = show(".github/workflows/ci.yml")
    provider = show("src/hooks/useConvexData.tsx")
    coord = show("src/lib/refreshCoordinator.mjs")
    check = show("scripts/refresh-coordinator-check.mjs")

    require_all(ci, [
        "REM workbook import security check",
        "DHR atomic scanner security check",
        "DHR lifecycle revision security check",
        "Incoming Stock PDF security check",
        "30-user refresh storm check",
        "refresh-coordinator-check.mjs",
    ], "CI preservation")
    require_all(coord, [
        "DEFAULT_REFRESH_MIN_MS = 10_000",
        "DEFAULT_REFRESH_MAX_MS = 15_000",
        "createCoalescedRefreshRunner",
        "if (inFlight)",
        "queued = true",
        "while (queued && isActive())",
        "createRefreshScheduler",
        "if (disposed || !isVisible()) return",
        "handleVisibilityChange",
        "handleOnline",
        "dispose",
    ], "refresh coordinator")
    require("Math.min(1, Math.max(0, raw))" in coord, "jitter boundary is not clamped")

    require_all(provider, [
        "createCoalescedRefreshRunner",
        "createRefreshScheduler",
        'document.addEventListener("visibilitychange"',
        'window.addEventListener("online"',
        "mutationRefreshTimerRef",
        "mountedRef.current",
    ], "provider wiring")
    require(not re.search(r"setInterval\s*\(\s*loadAll\s*,\s*15000\s*\)", provider), "fixed synchronized 15s interval remains")
    require("(debouncedLoadAll as any)._t" not in provider, "function-property debounce timer remains")

    require_all(check, [
        "testCoalescing",
        "testVisibilityReconnectAndCleanup",
        "testThirtyClientJitter",
        "Array.from({ length: 30 }",
        "REFRESH_INFLIGHT_DEDUPE=PASS",
        "REFRESH_COALESCING=PASS",
        "VISIBILITY_PAUSE_RESUME=PASS",
        "RECONNECT_RECONCILIATION=PASS",
        "JITTERED_FALLBACK=PASS",
        "THIRTY_CLIENT_STORM_TEST=PASS",
    ], "deterministic refresh regression")

    print(f"VERIFY=PASS SHA={TARGET}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"VERIFY=FAIL SHA={TARGET} REASON={exc}", file=sys.stderr)
        raise
