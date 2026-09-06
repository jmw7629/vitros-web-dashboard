#!/usr/bin/env python3
"""Independent deterministic verifier for PR #193 exact implementation head."""
from __future__ import annotations

import re
import subprocess
import sys

TARGET = "73d1808502ea286fd37241ee0fe49b0991a9d064"
BASE = "8f8d16bc48779b25937efc6444acdcf5a33c374f"
EXPECTED_TARGET_FILES = {
    "convex/adminSettingsActions.ts",
    "convex/authGuard.ts",
    "database/migrations/20260904_enterprise_admin_settings_registry.sql",
    "package.json",
    "scripts/admin-settings-security-check.mjs",
}
EXPECTED_VERIFIER_FILES = {
    "scripts/verify-admin-settings-193.py",
    ".github/workflows/verify-admin-settings-193.yml",
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
    require(target_files == EXPECTED_TARGET_FILES, f"unexpected PR #193 target diff: {sorted(target_files)}")
    verifier_files = set(filter(None, git("diff", "--name-only", TARGET, "HEAD").splitlines()))
    require(verifier_files == EXPECTED_VERIFIER_FILES, f"verifier branch scope drift: {sorted(verifier_files)}")

    auth = show("convex/authGuard.ts")
    action = show("convex/adminSettingsActions.ts")
    migration = show("database/migrations/20260904_enterprise_admin_settings_registry.sql")
    package = show("package.json")
    gate = show("scripts/admin-settings-security-check.mjs")

    require_all(auth, ['"admin.system_settings.manage"', "superuser:"], "granular admin capability")
    engineer = re.search(r"engineer:\s*\[([\s\S]*?)\],\s*viewer:", auth)
    require(engineer is not None and "admin.system_settings.manage" not in engineer.group(1), "engineer has admin settings capability")
    viewer = re.search(r"viewer:\s*\[([^\]]*)\]", auth)
    require(viewer is not None and "admin.system_settings.manage" not in viewer.group(1), "viewer has admin settings capability")

    require_all(action, [
        'requireCapability(ctx, "admin.system_settings.manage")',
        "const actorId = await requireCapability",
        '"rpc/apply_admin_setting_change"',
        "p_actor: String(actorId)",
        "expectedVersion",
        "correlationId",
        "normalizeSettingValue",
    ], "server admin settings actions")
    require("VITE_" not in action, "browser VITE secret reference introduced")
    require(not re.search(r"args\s*:\s*\{[^}]*\b(actor|role)\s*:", action, re.DOTALL), "caller can supply actor or role")
    for key in ["sapPlantCode", "sapStorageLocation", "sapMovementIN", "sapMovementOUT", "sapMovementADJUST", "sapHeaderText"]:
        require(key in action and f"'{key}'" in migration, f"editable setting allowlist missing {key}")

    require_all(migration, [
        "ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1",
        "CREATE TABLE IF NOT EXISTS public.admin_setting_events",
        "ENABLE ROW LEVEL SECURITY",
        "REVOKE ALL ON TABLE public.admin_setting_events FROM PUBLIC, anon, authenticated",
        "BEFORE UPDATE OR DELETE ON public.admin_setting_events",
        "correlation_id text NOT NULL UNIQUE",
        "SECURITY DEFINER",
        "SET search_path = pg_catalog",
        "pg_advisory_xact_lock",
        "FOR UPDATE",
        "TO service_role",
    ], "admin settings migration")
    upper = migration.upper()
    require("DROP TABLE" not in upper and "TRUNCATE" not in upper, "destructive migration token present")
    require(not re.search(r"UPDATE\s+PUBLIC\.SETTINGS\s+SET[\s\S]*WHERE\s+TRUE", upper), "broad settings rewrite present")

    require('"pretypecheck": "node scripts/admin-settings-security-check.mjs"' in package, "admin gate is not wired before typecheck")
    require_all(gate, [
        "ENTERPRISE_ADMIN_SERVER_RBAC=PASS",
        "ENTERPRISE_ADMIN_VALIDATION=PASS",
        "ENTERPRISE_ADMIN_CONCURRENCY=PASS",
        "ENTERPRISE_ADMIN_AUDIT=PASS",
        "ENTERPRISE_ADMIN_SECRET_BOUNDARY=PASS",
    ], "admin settings security gate")

    print(f"VERIFY=PASS SHA={TARGET}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"VERIFY=FAIL SHA={TARGET} REASON={exc}", file=sys.stderr)
        raise
