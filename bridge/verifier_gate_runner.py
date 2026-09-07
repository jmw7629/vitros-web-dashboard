#!/usr/bin/env python3
"""Hardened entrypoint for the independent VITROS verifier.

The base verifier already requires exact-head GitHub Actions CI. This wrapper adds
an equally exact commit-status gate for the Vercel preview before OpenCode is
allowed to produce a PASS verdict. It intentionally uses only GitHub metadata;
no Vercel token or production credential is exposed to the verifier model.
"""
from __future__ import annotations

import json
from typing import Any

import verifier_runner as vr

_ORIGINAL_CI_EVIDENCE = vr.exact_ci_evidence


def _latest_vercel_status(payload: dict[str, Any]) -> dict[str, Any] | None:
    statuses = [
        item
        for item in (payload.get("statuses") or [])
        if str(item.get("context") or "").strip().lower() == "vercel"
    ]
    if not statuses:
        return None
    return max(
        statuses,
        key=lambda item: (
            str(item.get("updated_at") or item.get("created_at") or ""),
            int(item.get("id") or 0),
        ),
    )


def exact_ci_and_vercel_evidence(repo: str, target_sha: str) -> str:
    ci_evidence = _ORIGINAL_CI_EVIDENCE(repo, target_sha)
    proc = vr.run(
        [
            "gh",
            "api",
            "--method",
            "GET",
            f"repos/{repo}/commits/{target_sha}/status",
        ]
    )
    try:
        payload = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise vr.BridgeError("Exact-head GitHub commit-status evidence is unreadable.") from exc

    status = _latest_vercel_status(payload)
    if not status:
        raise vr.BridgeError(f"Exact-head Vercel preview status is missing for {target_sha}.")

    state = str(status.get("state") or "unknown").strip().lower()
    if state != "success":
        description = vr.sanitize(str(status.get("description") or "").strip())[:300]
        detail = f": {description}" if description else ""
        raise vr.BridgeError(
            f"Exact-head Vercel preview is not READY for {target_sha}: {state}{detail}."
        )

    target_url = str(status.get("target_url") or "").strip()
    if not target_url.startswith("https://vercel.com/"):
        raise vr.BridgeError(
            f"Exact-head Vercel preview success for {target_sha} has no trusted Vercel evidence URL."
        )

    return f"{ci_evidence}; Vercel Preview"


def main() -> int:
    # execute_task resolves exact_ci_evidence dynamically from verifier_runner, so
    # patch only this metadata gate and leave the verifier isolation machinery intact.
    vr.exact_ci_evidence = exact_ci_and_vercel_evidence
    return vr.main()


if __name__ == "__main__":
    raise SystemExit(main())
