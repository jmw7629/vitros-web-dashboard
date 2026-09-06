#!/usr/bin/env python3
"""Deterministic GitHub-hosted verifier for VITROS PR #195 exact head."""
from __future__ import annotations

import subprocess
import sys

TARGET = "1bfaf321cb33a1b6cb7e212c48fa873269e4437f"
BASE = "3f8b41f759a5ef84ae95e51e0b57e675f4f9491d"
EXPECTED_TARGET_FILES = {
    ".github/workflows/bridge-verifier.yml",
    "bridge/install_verifier.sh",
    "bridge/test_verifier_runner.py",
    "bridge/uninstall.sh",
    "bridge/verifier_runner.py",
}
EXPECTED_VERIFIER_FILES = {
    "scripts/verify-bridge-verifier-recovery-195.py",
    ".github/workflows/verify-bridge-verifier-recovery-195.yml",
}


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def show(path: str) -> str:
    return git("show", f"{TARGET}:{path}")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def require_all(text: str, needles: list[str], label: str) -> None:
    missing = [needle for needle in needles if needle not in text]
    require(not missing, f"{label} missing required invariants: {missing}")


def main() -> int:
    require(git("cat-file", "-t", TARGET) == "commit", "target SHA is not present")
    target_files = set(filter(None, git("diff", "--name-only", BASE, TARGET).splitlines()))
    require(target_files == EXPECTED_TARGET_FILES, f"unexpected PR #195 target diff: {sorted(target_files)}")

    verifier_files = set(filter(None, git("diff", "--name-only", TARGET, "HEAD").splitlines()))
    require(verifier_files == EXPECTED_VERIFIER_FILES, f"verifier branch contains non-verifier changes: {sorted(verifier_files)}")

    runner = show("bridge/verifier_runner.py")
    installer = show("bridge/install_verifier.sh")
    tests = show("bridge/test_verifier_runner.py")
    workflow = show(".github/workflows/bridge-verifier.yml")

    require_all(runner, [
        'VERIFY_MARKER = "<!-- vitros-opencode-verify:v1 -->"',
        'actions/runs?head_sha={target_sha}&event=pull_request&per_page=50',
        'item.get("name") == "CI"',
        'status != "completed" or conclusion != "success"',
        '"clone", "--no-checkout", "--no-local"',
        '"remote", "remove", "origin"',
        '"--pure"',
        'OPENCODE_CONFIG_CONTENT',
        '"*": "deny"',
        '"edit": "deny"',
        '"external_directory": "deny"',
        '"task": "deny"',
        '"webfetch": "deny"',
        '"websearch": "deny"',
        '"GH_TOKEN"',
        '"GITHUB_TOKEN"',
        '"SUPABASE_SERVICE_ROLE_KEY"',
        '"VERCEL_TOKEN"',
        '"CONVEX_DEPLOY_KEY"',
        '"CONVEX_SELF_HOSTED_ADMIN_KEY"',
        'GH_CONFIG_DIR',
        'NONCE=',
        'sandbox_head(sandbox)',
        'sandbox_status(sandbox)',
        'resolve_pr(repo, pr_number, target_sha)',
        'Snap OpenCode is not supported',
    ], "verifier runner")

    require_all(installer, [
        'Do not install the VITROS verifier service as root.',
        'Snap OpenCode is not supported by the hardened VITROS verifier.',
        'for flag in --dir --auto --format --agent',
        '--pure',
        'python3 "$ROOT/bridge/test_verifier_runner.py"',
        'NoNewPrivileges=true',
        'PrivateTmp=true',
        'ProtectSystem=strict',
        'ReadWritePaths=$HOME/.local/state/joeos-opencode-bridge $HOME/.cache/joeos-opencode-bridge',
        'UMask=0077',
        'systemctl --user enable --now vitros-opencode-verifier.service',
    ], "verifier installer")
    require('ReadWritePaths=$ROOT' not in installer, "control checkout must not be writable by verifier service")

    require_all(tests, [
        'test_terminal_requires_exact_target_and_nonce',
        'test_echoed_issue_terminal_without_nonce_cannot_pass',
        'test_secret_sanitizer_redacts_common_credentials',
        'test_product_and_github_credentials_are_stripped_from_opencode',
        'test_static_permission_policy_denies_mutation_network_and_project_execution',
        'test_inline_config_applies_same_static_policy_to_build_agent',
    ], "verifier regression tests")

    require_all(workflow, [
        'permissions:\n  contents: read',
        'python3 -m py_compile bridge/verifier_runner.py bridge/test_verifier_runner.py',
        'python3 -m unittest bridge/test_verifier_runner.py',
        'bash -n bridge/install_verifier.sh bridge/uninstall.sh bridge/install.sh',
        'OPENCODE_CONFIG_CONTENT',
        'SUPABASE_SERVICE_ROLE_KEY',
        'CONVEX_DEPLOY_KEY',
        'sandbox_head(sandbox)',
    ], "bridge verifier CI")

    print(f"VERIFY=PASS SHA={TARGET}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"VERIFY=FAIL SHA={TARGET} REASON={exc}", file=sys.stderr)
        raise
