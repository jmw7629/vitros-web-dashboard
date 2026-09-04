#!/usr/bin/env python3
"""Independent exact-head verifier worker for the VITROS OpenCode bridge.

The verifier is deliberately isolated from the builder runner. It validates a
trusted verifier issue, resolves the exact PR head, copies that head into a
throw-away detached clone, removes GitHub/product credentials from the OpenCode
process, and only publishes a terminal result that carries a per-run challenge.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import secrets
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
    r"VERIFY=(PASS|FAIL|BLOCKED)\s+SHA=([0-9a-f]{40})\s+NONCE=([0-9a-f]{32})"
    r"(?:\s+REASON=([^\r\n\"\\]+))?",
    re.IGNORECASE,
)
SHA_RE = re.compile(r"\b[0-9a-f]{40}\b", re.IGNORECASE)
PR_RE = re.compile(r"\bPR\s*#(\d+)\b", re.IGNORECASE)
SECRET_PATTERNS = (
    re.compile(r"(?i)(authorization\s*:\s*bearer\s+)[^\s]+"),
    re.compile(
        r"(?i)((?:token|secret|api[_-]?key|deploy[_-]?key|service[_-]?role[_-]?key)\s*[=:]\s*)[^\s,;]+"
    ),
    re.compile(r"\b(?:sk|sbp|eyJ)[A-Za-z0-9_.-]{24,}\b"),
)
OPEN_CODE_STRIPPED_ENV = {
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GITHUB_PAT",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VERCEL_TOKEN",
    "CONVEX_DEPLOY_KEY",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
}


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


def origin_url(root: Path) -> str:
    value = run(["git", "remote", "get-url", "origin"], cwd=root).stdout.strip()
    if not value:
        raise BridgeError("Control checkout has no origin URL.")
    return value


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
            "gh",
            "issue",
            "list",
            "--repo",
            repo,
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,body,author,url,updatedAt",
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
        # Recovery worker intentionally handles exact-PR verifier jobs only.
        # Historical production-head verifier issues without a PR are left alone.
        target_ok = PR_RE.search(body) is not None and SHA_RE.search(body) is not None
        if author in allowed and title.startswith("[VERIFY]") and marker_ok and target_ok:
            selected.append(issue)
    return sorted(selected, key=lambda item: int(item["number"]), reverse=True)


def parse_target(body: str) -> tuple[int, str]:
    pr_match = PR_RE.search(body)
    if not pr_match:
        raise BridgeError("Verifier issue must name a target PR as `PR #<number>`.")
    sha_matches = SHA_RE.findall(body)
    if not sha_matches:
        raise BridgeError("Verifier issue must include an exact 40-character target SHA.")
    # Verifier templates put target SHA first; later SHAs may be base/history values.
    return int(pr_match.group(1)), sha_matches[0].lower()


def resolve_pr(repo: str, pr_number: int, expected_sha: str) -> dict[str, str]:
    proc = run(
        [
            "gh",
            "pr",
            "view",
            str(pr_number),
            "--repo",
            repo,
            "--json",
            "headRefOid,baseRefOid,url,title,state",
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
        [
            "gh",
            "issue",
            "comment",
            str(issue_number),
            "--repo",
            repo,
            "--body",
            sanitize(text),
        ]
    )


def build_prompt(
    issue: dict[str, Any],
    pr_number: int,
    target_sha: str,
    base_sha: str,
    nonce: str,
) -> str:
    first, second = nonce[:16], nonce[16:]
    return f"""You are the independent read-only verifier for VITROS PR #{pr_number}.

You are checked out at exact target SHA {target_sha}; base SHA is {base_sha or 'unknown'}.
Read AGENTS.md first. Inspect the implementation and run relevant read-only/static/build/test checks requested by the approved verifier issue below. Do not edit source files, commit, push, create branches/tags, merge, deploy, change database state, or post SAP. Git/GitHub mutation paths are blocked or isolated by policy. If a requested production mutation would be needed, mark that item BLOCKED rather than performing it. Never reveal credentials, tokens, environment secret values, or full private payloads.

Before concluding, run `git status --porcelain` and `git rev-parse HEAD`. Treat any source mutation or HEAD movement you caused as failure. The runner will independently enforce both checks.

For the final terminal result, output one line beginning with VERIFY, followed by the exact target SHA, followed by a NONCE made by concatenating these two challenge halves with no separator: `{first}` then `{second}`. Use PASS only when every required gate you can safely execute passes; otherwise use FAIL or BLOCKED and a concise REASON. Do not copy any terminal example from the verifier issue body because it lacks this run challenge.

--- BEGIN APPROVED VERIFIER ISSUE ---
{issue.get('body') or ''}
--- END APPROVED VERIFIER ISSUE ---
"""


def extract_terminal(stdout: str, stderr: str, target_sha: str, nonce: str) -> tuple[str, str]:
    # Raw JSON events may embed assistant text in JSON strings. A per-run nonce that
    # is absent from the approved issue prevents an echoed issue template from
    # being accepted as a terminal verifier result.
    matches = list(TERMINAL_RE.finditer(f"{stdout}\n{stderr}"))
    if not matches:
        return "BLOCKED", "OpenCode did not emit the required challenged terminal verifier line."
    for match in reversed(matches):
        if match.group(3).lower() != nonce.lower():
            continue
        status = match.group(1).upper()
        sha = match.group(2).lower()
        reason = sanitize((match.group(4) or "").strip())
        if sha != target_sha:
            return "BLOCKED", f"Verifier returned terminal SHA {sha} instead of {target_sha}."
        return status, reason
    return "BLOCKED", "OpenCode terminal output did not carry the active verifier challenge."


def sandbox_head(sandbox: Path) -> str:
    return run(["git", "rev-parse", "HEAD"], cwd=sandbox).stdout.strip().lower()


def sandbox_status(sandbox: Path) -> str:
    return run(["git", "status", "--porcelain"], cwd=sandbox).stdout.strip()


def prepare_sandbox(root: Path, sandbox: Path, pr_number: int, target_sha: str) -> None:
    if sandbox.exists():
        shutil.rmtree(sandbox)
    sandbox.parent.mkdir(parents=True, exist_ok=True)

    # A standalone clone prevents local commits/refs in the verifier from touching
    # the control checkout or the builder's worktrees.
    run(["git", "clone", "--no-checkout", "--no-local", str(root), str(sandbox)], cwd=root)
    remote = origin_url(root)
    run(["git", "fetch", "--no-tags", remote, f"pull/{pr_number}/head"], cwd=sandbox)
    run(["git", "checkout", "--detach", target_sha], cwd=sandbox)
    # Remove the local-origin remote before OpenCode starts; it has no legitimate
    # reason to push anywhere during verification.
    run(["git", "remote", "remove", "origin"], cwd=sandbox, check=False)

    if sandbox_head(sandbox) != target_sha:
        raise BridgeError("Verifier sandbox did not resolve to the exact target SHA.")
    if sandbox_status(sandbox):
        raise BridgeError("Fresh verifier sandbox is unexpectedly dirty.")


def verifier_env(root: Path, sandbox: Path) -> dict[str, str]:
    env = os.environ.copy()
    real_git = shutil.which("git")
    real_gh = shutil.which("gh")
    if not real_git or not real_gh:
        raise BridgeError("Cannot locate real git/gh binaries.")

    for key in OPEN_CODE_STRIPPED_ENV:
        env.pop(key, None)
    env.pop("SSH_AUTH_SOCK", None)
    env["BRIDGE_REAL_GIT"] = real_git
    env["BRIDGE_REAL_GH"] = real_gh
    # Safe wrappers come from the trusted control checkout, never the PR head.
    env["PATH"] = f"{root / 'bridge' / 'safe-bin'}:{env.get('PATH', '')}"
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_ASKPASS"] = "/bin/false"
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = "/dev/null"
    # Even an absolute `gh` invocation receives an empty config directory and no
    # GitHub token. The runner's own gh process is outside this environment.
    gh_config = sandbox.parent / ".verifier-gh-empty"
    gh_config.mkdir(parents=True, exist_ok=True)
    env["GH_CONFIG_DIR"] = str(gh_config)
    env["CI"] = "1"
    return env


def execute_task(
    root: Path,
    repo: str,
    issue: dict[str, Any],
    state: dict[str, Any],
    state_path: Path,
    sandbox_root: Path,
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

    sandbox = sandbox_root / f"verify-{issue_number}-{target_sha[:10]}"
    prepare_sandbox(root, sandbox, pr_number, target_sha)
    # Close the race between initial PR resolution and the fetched sandbox.
    pr = resolve_pr(repo, pr_number, target_sha)
    if pr["state"] != "OPEN":
        shutil.rmtree(sandbox, ignore_errors=True)
        return

    logs = state_path.parent / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    log = logs / f"verify-{issue_number}-{target_sha[:10]}.log"
    nonce = secrets.token_hex(16)
    try:
        comment(
            repo,
            issue_number,
            f"Verifier accepted PR #{pr_number} exact head `{target_sha}`. Isolated read-only checks are running; no merge/deploy/database mutation is permitted.",
        )
        command = [
            opencode_bin,
            "run",
            "--dir",
            str(sandbox),
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
        command.append(build_prompt(issue, pr_number, target_sha, pr["base"], nonce))

        proc = run(command, cwd=sandbox, check=False, env=verifier_env(root, sandbox))
        log.write_text(
            f"$ {shlex.join(command[:-1])} <PROMPT>\n\nexit={proc.returncode}\n\nSTDOUT\n"
            f"{sanitize(proc.stdout or '')}\n\nSTDERR\n{sanitize(proc.stderr or '')}\n"
        )
        os.chmod(log, 0o600)

        dirty = sandbox_status(sandbox)
        head = sandbox_head(sandbox)
        if head != target_sha:
            status, reason = "FAIL", "Verifier moved HEAD away from the exact target; sandbox was discarded."
        elif dirty:
            status, reason = "FAIL", "Verifier mutated tracked/unignored files; sandbox was discarded."
        elif proc.returncode != 0:
            status, reason = "BLOCKED", f"OpenCode exited with code {proc.returncode}."
        else:
            status, reason = extract_terminal(proc.stdout or "", proc.stderr or "", target_sha, nonce)

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
            state["retry"][task_key] = {
                "attempts": attempts,
                "next": int(time.time()) + min(3600, 300 * max(1, attempts)),
                "reason": reason[:900],
            }
        save_state(state_path, state)
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


def bridge_once(
    root: Path,
    repo: str,
    state_path: Path,
    sandbox_root: Path,
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
            execute_task(root, repo, issue, state, state_path, sandbox_root, opencode_bin)
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
    sandbox_root = Path(
        os.getenv(
            "BRIDGE_VERIFIER_WORKTREE_ROOT",
            f"~/.cache/joeos-opencode-bridge/{key}/verifier-sandboxes",
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
                bridge_once(root, args.repo, state_path, sandbox_root, opencode_bin)
            except Exception as exc:
                print(f"[verifier] {sanitize(str(exc))}", file=sys.stderr)
            if args.once:
                return 0
            time.sleep(max(args.interval, 30))


if __name__ == "__main__":
    raise SystemExit(main())
