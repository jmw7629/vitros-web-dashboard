#!/usr/bin/env python3
"""Independent deterministic verifier for PR #249 exact implementation head."""
from __future__ import annotations

import re
import subprocess
import sys

TARGET = "f603c004c5c606c248011277948edda10a896b7b"
BASE = "8f8d16bc48779b25937efc6444acdcf5a33c374f"
EXPECTED_TARGET_FILES = {
    ".github/workflows/incoming-stock-provider-error-containment.yml",
    "convex/incomingStockActions.ts",
    "scripts/incoming-stock-provider-error-containment-check.mjs",
}
EXPECTED_VERIFIER_FILES = {
    "scripts/verify-incoming-stock-provider-249.py",
    ".github/workflows/verify-incoming-stock-provider-249.yml",
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
    require(target_files == EXPECTED_TARGET_FILES, f"unexpected PR #249 target diff: {sorted(target_files)}")
    verifier_files = set(filter(None, git("diff", "--name-only", TARGET, "HEAD").splitlines()))
    require(verifier_files == EXPECTED_VERIFIER_FILES, f"verifier branch scope drift: {sorted(verifier_files)}")

    source = show("convex/incomingStockActions.ts")
    gate = show("scripts/incoming-stock-provider-error-containment-check.mjs")
    workflow = show(".github/workflows/incoming-stock-provider-error-containment.yml")

    start = source.index("async function applyConfirmedReceive")
    end = source.index("export const reviewPackingListDraft", start)
    receive = source[start:end]
    match = re.search(r"if \(!response\.ok\)\s*\{([\s\S]*?)\n\s*\}", receive)
    require(match is not None, "confirmed RECEIVE non-2xx boundary missing")
    failure = match.group(1)
    require("Receive failed (${response.status})" in failure, "provider failure is not status-only")
    require(not re.search(r"response\.(json|text|arrayBuffer|blob|formData)\s*\(", failure), "provider error body is read")
    require(".message" not in failure and ".error" not in failure, "provider error field is reflected")

    review = source[source.index("export const reviewPackingListDraft"):source.index("export const commitConfirmedReceiveLine")]
    commit = source[source.index("export const commitConfirmedReceiveLine"):]
    require_all(review, [
        'requireCapability(ctx, "inventory.write")',
        "requiresHumanConfirmation: true",
        'identityRule: "canonical_part_number_only"',
        "descriptionUsedForIdentity: false",
    ], "review boundary")
    require_all(commit, [
        'requireCapability(ctx, "inventory.write")',
        "applyConfirmedReceive",
        "const correlationId = `incoming:${args.confirmationId.trim()}`",
    ], "confirmed RECEIVE boundary")
    require_all(receive, [
        'p_mode: "RECEIVE"',
        "p_user: args.actor",
        "p_correlation_id: args.correlationId",
        "SUPABASE_SERVICE_ROLE_KEY" if False else "apply_inventory_transition",
    ], "atomic receive request")
    require("SUPABASE_SERVICE_ROLE_KEY" in source, "server-only Supabase service boundary missing")
    require(not re.search(r"VITE_[A-Z0-9_]*SERVICE", source), "browser service credential pattern introduced")
    require("/rest/v1/stock" in source, "canonical stock lookup unexpectedly removed")

    require_all(gate, [
        "INCOMING_STOCK_PROVIDER_ERROR_CONTAINMENT=PASS",
        "PROVIDER_ERROR_BODY_REFLECTION=NONE",
        "HUMAN_CONFIRMATION=REQUIRED",
        "CANONICAL_PART_IDENTITY=PASS",
        "ATOMIC_RECEIVE_BOUNDARY=PRESERVED",
    ], "dedicated containment gate")
    require_all(workflow, [
        "incoming-stock-provider-error-containment-check.mjs",
        "npm run typecheck",
        "npm run build",
    ], "dedicated containment workflow")

    print(f"VERIFY=PASS SHA={TARGET}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"VERIFY=FAIL SHA={TARGET} REASON={exc}", file=sys.stderr)
        raise
