# VITROS OpenCode Bridge

GitHub Issues are the authenticated task queue between ChatGPT and the VPS OpenCode executor.

A task is accepted only when:
- the issue author is in `BRIDGE_TRUSTED_AUTHORS`;
- the title begins with `[OC]`;
- the body contains `<!-- vitros-opencode-bridge:v1 -->`.

The runner creates an isolated worktree and `oc/issue-*` branch, invokes OpenCode, validates `git diff --check`, commits/pushes itself, and opens a PR. OpenCode cannot use `gh` and can use only read-only Git commands through `bridge/safe-bin`.

Nothing auto-merges. PR review is mandatory.

Local state/logs are kept outside the repository under `~/.local/state/joeos-opencode-bridge/` and `~/.cache/joeos-opencode-bridge/`.

Install from the repository root with `./bridge/install.sh`.
