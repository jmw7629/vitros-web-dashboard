#!/usr/bin/env python3
"""Independent exact-head verifier worker for the VITROS OpenCode bridge.

This process is intentionally separate from the builder runner so one builder and
one verifier can execute concurrently without sharing worktree/state locks.
OpenCode is never allowed to own Git/GitHub mutations; verifier results are
posted by this runner only after the exact PR head is revalidated.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

VERIFY_MARKER = "<!-- vitros-opencode-verify:v1 -->"
LEGACY_VERIFY_MARKER = "joeos-opencode-bridge:v1"
DEFAULT_REPO = "jmw7629/vitros-web-dashboard"
TERMINAL_RE = re.compile(
    r"VERIFY=(PASS|FAIL|BLOCKED)\s+SHA=([0-9a-f]{40})(?:\s+REASON=([^\r\n\"\\]+))?",
    re.IGNORECASE,
)
SHA_RE = re.compile(r"\b[0-9a-f]{40}\b", re.IGNORECASE)
PR_RE = re.compile(r"\bPR\s*#(\d+)\b", re.IGNORECASE)
SECRET_PATTERNS = (
    re.compile(r"(?i)(authorization\s*:\s*bearer\s+)[^\s]+"),
    re.compile(r"(?i)((?:token|secret|api[_-]?key|deploy[_-]?key|service[_-]?role[_-]?key)\s*[=:]\s*)[^\s,;]+"),
    re.compile(r"\b(?:sk|sbp|eyJ)[A-Za-z0-9_.-]{24,}\b"),
)


class BridgeError(RuntimeError):
    pass


def run(
    args: list[str],
    *,
    cwd: Path | None = None,
    check: bool = True,
    env: dict[str, str] | None = None,
    timeout: int | None = None,
) -> subprocess.CompletedProcess[str]:
    try:
        proc = subprocess.run(
            args,
            cwd=str(cwd) if cwd else None,
            text=True,
            capture_output=True,
            check=False,
            env=env,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise BridgeError(f"Command timed out: {shlex.join(args[:6])}") from exc
    if check and proc.returncode != 0:
        raise BridgeError(
            f"Command failed ({proc.returncode}): {shlex.join(args[:6])}\n"
            f"stdout:\n{sanitize((proc.stdout or '')[-3000:])}\n"
            f"stderr:\n{sanitize((proc.stderr or '')[-3000:])}"
        )
    return proc


def sanitize(value: str) -> str:
    text = value.replace("\x00", "")
    for pattern in SECRET_PATTERNS:
        if pattern.groups:
            text = pattern.sub(lambda match: f"{match.group(1)}[REDACTED]", text)
        else:
            text = pattern.sub("[REDACTED]", text)
    return text[-6000:]


def repo_key(repo: str) -> str:
    return repo.replace("/", "__")


def trusted_authors() -> set[str]:
    return {
        item.strip()
        for item in os.getenv("BRIDGE_TRUSTED_AUTHORS", "jmw7629").split(",")
        if item.strip()
    }


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"completed": {}, "retry": {}}
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        raise BridgeError(f"Verifier state is unreadable: {path}") from exc
    data.setdefault("completed", {})
    data.setdefault("retry", {})
    return data


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def ensure_repo(root: Path, repo: str) -> None:
    if not (root / ".git").exists():
        raise BridgeError(f"Not a Git checkout: {root}")
    if run(["git", "status", "--porcelain"], cwd=root).stdout.strip():
        raise BridgeError("Control checkout is dirty; verifier refuses to run.")
    remote = (
        run(["git", "remote", "get-url", "origin"], cwd=root)
        .stdout.strip()
        .lower()
        .rstrip("/")
        .removesuffix(".git")
    )
    if repo.lower() not in remote:
        raise BridgeError(f"Unexpected origin {remote!r}; expected {repo!r}")


def validate_opencode() -> str:
    binary = os.getenv("OPENCODE_BIN", "opencode").strip() or "opencode"
    resolved = shutil.which(binary) if "/" not in binary else binary
    if not resolved or not Path(resolved).exists():
        raise BridgeError(f"OpenCode executable not found: {binary}")
    resolved_path = str(Path(resolved).resolve())
    if resolved_path.startswith("/snap/"):
        raise BridgeError("Snap OpenCode is not supported by the hardened verifier service.")
    version = run([resolved_path, "--version"], timeout=30).stdout.strip()
    if not version:
        raise BridgeError("OpenCode --version returned no version.")
    help_text = run([resolved_path, "run", "--help"], check=False, timeout=30)
    combined = f"{help_text.stdout}\n{help_text.stderr}"
    for flag in ("--dir", "--auto", "--format"):
        if flag not in combined:
            raise BridgeError(f"OpenCode run is missing required flag {flag}")
    return resolved_path


def list_tasks(repo: str) -> list[dict[str, Any]]:
    proc = run(
        [
            "gh", "issue", "list", "--repo", repo, "--state", "open", "--limit", "100",
            "--json", "number,title,body,author,url,updatedAt",
        ]
    )
    issues = json.loads(proc.stdout or "[]")
    allowed = trusted_authors()
    selected: list[dict[str, Any]] = []
    for issue in issues:
        author = ((issue.get("author") or {}).get("login") or "").strip()
        title = (issue.get("title") or "").strip()
        body = issue.get("body") or ""
        marker_ok = VERIFY_MARKER in body or LEGACY_VERIFY_MARKER in body
        # This recovery worker intentionally handles exact-PR verifier jobs only.
        # Historical production-head verifier issues without a PR are left alone.
        target_ok = PR_RE.search(body) is not None and SHA_RE.search(body) is not None
        if author in allowed and title.startswith("[VERIFY]") and marker_ok and target_ok:
            selected.append(issue)
    # New verifier work should not sit behind stale historical tasks.
    return sorted(selected, key=lambda item: int(item["number"]), reverse=True)


def parse_target(body: str) -> tuple[int, str]:
    pr_match = PR_RE.search(body)
    if not pr_match:
        raise BridgeError("Verifier issue must name a target PR as `PR #<number>`.")
    sha_matches = SHA_RE.findall(body)
    if not sha_matches:
        raise BridgeError("Verifier issue must include an exact 40-character target SHA.")
    # Verifier templates put the target SHA first; later SHAs may be bases or historical heads.
    return int(pr_match.group(1)), sha_matches[0].lower()


def resolve_pr(repo: str, pr_number: int, expected_sha: str) -> dict[str, str]:
    proc = run(
        [
            "gh", "pr", "view", str(pr_number), "--repo", repo,
            "--json", "headRefOid,baseRefOid,url,title,state",
        ]
    )
    raw = json.loads(proc.stdout or "{}")
    head = str(raw.get("headRefOid") or "").lower()
    if head != expected_sha:
        raise BridgeError(
            f"PR #{pr_number} head moved: expected {expected_sha}, current {head or 'unknown'}"
        )
    return {
        "head": head,
        "base": str(raw.get("baseRefOid") or "").lower(),
        "url": str(raw.get("url") or ""),
        "title": str(raw.get("title") or ""),
        "state": str(raw.get("state") or "").upper(),
    }


def comment(repo: str, issue_number: int, text: str) -> None:
    run(
        ["gh", "issue", "comment", str(issue_number), "--repo", repo, "--body", sanitize(text)]
    )


def build_prompt(issue: dict[str, Any], pr_number: int, target_sha: str, base_sha: str) -> str:
    return f"""You are the independent read-only verifier for VITROS PR #{pr_number}.

You are checked out at exact target SHA {target_sha}; base SHA is {base_sha or 'unknown'}.
Read AGENTS.md first. Inspect the implementation and run relevant read-only/static/build/test checks requested by the approved verifier issue below. Do not edit files, commit, push, create branches, merge, deploy, change database state, or post SAP. Git and GitHub mutation commands are blocked by policy. If a requested production mutation would be needed, mark that item BLOCKED rather than performing it. Never reveal credentials, tokens, environment secret values, or full private payloads.

Before your conclusion, run `git status --porcelain` and treat any repository mutation you caused as a verification failure. Finish with exactly one terminal line using the exact target SHA:
VERIFY=PASS SHA={target_sha}
VERIFY=FAIL SHA={target_sha} REASON=<concise reason>
or
VERIFY=BLOCKED SHA={target_sha} REASON=<concise blocker>

--- BEGIN APPROVED VERIFIER ISSUE ---
{issue.get('body') or ''}
--- END APPROVED VERIFIER ISSUE ---
"""


def extract_terminal(stdout: str, stderr: str, target_sha: str) -> tuple[str, str]:
    # OpenCode JSON output may embed the assistant terminal line inside a JSON string,
    # so search the raw output and use the last terminal result emitted.
    matches = list(TERMINAL_RE.finditer(f"{stdout}\n{stderr}"))
    if not matches:
        return "BLOCKED", "OpenCode did not emit the required terminal verifier line."
    match = matches[-1]
    status = match.group(1).upper()
    sha = match.group(2).lower()
    reason = sanitize((match.group(3) or "").strip())
    if sha != target_sha:
        return "BLOCKED", f"Verifier returned terminal SHA {sha} instead of {target_sha}."
    return status, reason


def safe_worktree_status(worktree: Path) -> str:
    return run(["git", "status", "--porcelain"], cwd=worktree).stdout.strip()


def verifier_env(worktree: Path) -> dict[str, str]:
    env = os.environ.copy()
    real_git = shutil.which("git")
    real_gh = shutil.which("gh")
    if not real_git or not real_gh:
        raise BridgeError("Cannot locate real git/gh binaries.")
    env["BRIDGE_REAL_GIT"] = real_git
    env["BRIDGE_REAL_GH"] = real_gh
    env["PATH"] = f"{worktree / 'bridge' / 'safe-bin'}:{env.get('PATH', '')}"
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["CI"] = "1"
    return env


def execute_task(
    root: Path,
    repo: str,
    issue: dict[str, Any],
    state: dict[str, Any],
    state_path: Path,
    worktree_root: Path,
    opencode_bin: str,
) -> None:
    issue_number = int(issue["number"])
    body = issue.get("body") or ""
    pr_number, target_sha = parse_target(body)
    task_key = f"{issue_number}:{pr_number}:{target_sha}"
    if task_key in state["completed"]:
        return

    retry = state["retry"].get(task_key) or {}
    if int(retry.get("next", 0)) > int(time.time()):
        return

    pr = resolve_pr(repo, pr_number, target_sha)
    if pr["state"] != "OPEN":
        # A closed/merged PR no longer needs verifier capacity; remember this locally
        # without posting noisy BLOCKED comments to historical verifier issues.
        state["completed"][task_key] = {
            "status": "STALE",
            "issue": issue_number,
            "pr": pr_number,
            "sha": target_sha,
            "time": int(time.time()),
        }
        state["retry"].pop(task_key, None)
        save_state(state_path, state)
        return

    run(["git", "fetch", "--prune", "origin", f"pull/{pr_number}/head"], cwd=root)
    # Re-read the PR after fetching to close the race between resolution and checkout.
    pr = resolve_pr(repo, pr_number, target_sha)
    if pr["state"] != "OPEN":
        return

    worktree = worktree_root / f"verify-{issue_number}-{target_sha[:10]}"
    if worktree.exists():
        run(["git", "worktree", "remove", "--force", str(worktree)], cwd=root, check=False)
    worktree.parent.mkdir(parents=True, exist_ok=True)
    run(["git", "worktree", "add", "--detach", str(worktree), target_sha], cwd=root)

    logs = state_path.parent / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    log = logs / f"verify-{issue_number}-{target_sha[:10]}.log"
    try:
        if safe_worktree_status(worktree):
            raise BridgeError("Fresh verifier worktree is unexpectedly dirty.")

        comment(
            repo,
            issue_number,
            f"Verifier accepted PR #{pr_number} exact head `{target_sha}`. Read-only checks are running; no merge/deploy/database mutation is permitted.",
        )
        command = [
            opencode_bin,
            "run",
            "--dir",
            str(worktree),
            "--auto",
            "--format",
            "json",
            "--title",
            f"VITROS verify PR #{pr_number}",
        ]
        if os.getenv("OPENCODE_MODEL", "").strip():
            command += ["--model", os.getenv("OPENCODE_MODEL", "").strip()]
        if os.getenv("OPENCODE_AGENT", "").strip():
            command += ["--agent", os.getenv("OPENCODE_AGENT", "").strip()]
        command.append(build_prompt(issue, pr_number, target_sha, pr["base"]))

        proc = run(command, cwd=worktree, check=False, env=verifier_env(worktree))
        log.write_text(
            f"$ {shlex.join(command[:-1])} <PROMPT>\n\nexit={proc.returncode}\n\nSTDOUT\n"
            f"{sanitize(proc.stdout or '')}\n\nSTDERR\n{sanitize(proc.stderr or '')}\n"
        )
        os.chmod(log, 0o600)

        dirty = safe_worktree_status(worktree)
        if dirty:
            status, reason = "FAIL", "Verifier mutated the read-only worktree; changes were discarded."
        elif proc.returncode != 0:
            status, reason = "BLOCKED", f"OpenCode exited with code {proc.returncode}."
        else:
            status, reason = extract_terminal(proc.stdout or "", proc.stderr or "", target_sha)

        # Exact head must still match immediately before publishing the result.
        current = resolve_pr(repo, pr_number, target_sha)
        if current["state"] != "OPEN":
            status, reason = "BLOCKED", "Target PR closed while verification was running."
        terminal = f"VERIFY={status} SHA={target_sha}"
        if reason:
            terminal += f" REASON={reason[:900]}"
        comment(repo, issue_number, terminal)

        if status in {"PASS", "FAIL"}:
            state["completed"][task_key] = {
                "status": status,
                "issue": issue_number,
                "pr": pr_number,
                "sha": target_sha,
                "log": str(log),
                "time": int(time.time()),
            }
            state["retry"].pop(task_key, None)
        else:
            attempts = int(retry.get("attempts", 0)) + 1
            # BLOCKED results remain retryable but back off to avoid comment storms.
            state["retry"][task_key] = {
                "attempts": attempts,
                "next": int(time.time()) + min(3600, 300 * max(1, attempts)),
                "reason": reason[:900],
            }
        save_state(state_path, state)
    finally:
        run(["git", "worktree", "remove", "--force", str(worktree)], cwd=root, check=False)


def bridge_once(
    root: Path,
    repo: str,
    state_path: Path,
    worktree_root: Path,
    opencode_bin: str,
) -> None:
    ensure_repo(root, repo)
    state = load_state(state_path)
    for issue in list_tasks(repo):
        issue_key = f"issue:{int(issue['number'])}"
        retry = state["retry"].get(issue_key) or {}
        if int(retry.get("next", 0)) > int(time.time()):
            continue
        try:
            execute_task(root, repo, issue, state, state_path, worktree_root, opencode_bin)
            state["retry"].pop(issue_key, None)
            save_state(state_path, state)
        except Exception as exc:
            reason = sanitize(str(exc))[:900]
            attempts = int(retry.get("attempts", 0)) + 1
            state["retry"][issue_key] = {
                "attempts": attempts,
                "next": int(time.time()) + min(3600, 300 * max(1, attempts)),
                "reason": reason,
            }
            save_state(state_path, state)
            try:
                comment(repo, int(issue["number"]), f"VERIFY=BLOCKED SHA=unknown REASON={reason}")
            except Exception:
                pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=os.getenv("BRIDGE_REPO", DEFAULT_REPO))
    parser.add_argument("--root", default=os.getenv("BRIDGE_ROOT", ""))
    parser.add_argument("--interval", type=int, default=int(os.getenv("BRIDGE_POLL_SECONDS", "60")))
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve() if args.root else Path(__file__).resolve().parent.parent
    key = repo_key(args.repo)
    state_path = Path(
        os.getenv(
            "BRIDGE_VERIFIER_STATE_FILE",
            f"~/.local/state/joeos-opencode-bridge/{key}/verifier-processed.json",
        )
    ).expanduser()
    worktree_root = Path(
        os.getenv(
            "BRIDGE_VERIFIER_WORKTREE_ROOT",
            f"~/.cache/joeos-opencode-bridge/{key}/verifier-worktrees",
        )
    ).expanduser()
    lock_path = state_path.parent / "verifier.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    opencode_bin = validate_opencode()
    with lock_path.open("w") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another VITROS verifier runner is already active.", file=sys.stderr)
            return 2
        while True:
            try:
                bridge_once(root, args.repo, state_path, worktree_root, opencode_bin)
            except Exception as exc:
                print(f"[verifier] {sanitize(str(exc))}", file=sys.stderr)
            if args.once:
                return 0
            time.sleep(max(args.interval, 30))


if __name__ == "__main__":
    raise SystemExit(main())
