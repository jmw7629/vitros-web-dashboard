#!/usr/bin/env bash
set -euo pipefail
if [[ "${EUID}" -eq 0 ]]; then echo "Do not install this bridge as root." >&2; exit 1; fi
for cmd in git gh python3 opencode systemctl; do command -v "$cmd" >/dev/null 2>&1 || { echo "Missing required command: $cmd" >&2; exit 1; }; done
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"; [[ -n "$ROOT" ]] || { echo "Run from inside vitros-web-dashboard." >&2; exit 1; }
REPO="${BRIDGE_REPO:-jmw7629/vitros-web-dashboard}"; REMOTE="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"; [[ "$REMOTE" == *"jmw7629/vitros-web-dashboard"* ]] || { echo "Unexpected origin: $REMOTE" >&2; exit 1; }
OPENCODE_BIN_PATH="$(command -v opencode)"; case "$OPENCODE_BIN_PATH" in /snap/*) echo "Snap OpenCode is not supported by the hardened bridge." >&2; exit 1;; esac

echo "[1/8] GitHub authentication..."; gh auth status >/dev/null 2>&1 || { echo "Run: gh auth login" >&2; exit 1; }
echo "[2/8] Git credential helper..."; gh auth setup-git
echo "[3/8] OpenCode authentication..."; opencode auth list || { echo "OpenCode authentication is not ready." >&2; exit 1; }
echo "[4/8] OpenCode automation flags..."; HELP="$(opencode run --help 2>&1 || true)"; for flag in --dir --auto --format; do grep -q -- "$flag" <<<"$HELP" || { echo "OpenCode missing $flag" >&2; exit 1; }; done

echo "[5/8] Git identity..."; [[ -n "$(git -C "$ROOT" config user.name 2>/dev/null || true)" ]] || git -C "$ROOT" config user.name "VITROS OpenCode Bridge"; [[ -n "$(git -C "$ROOT" config user.email 2>/dev/null || true)" ]] || git -C "$ROOT" config user.email "jmw7629@users.noreply.github.com"
CONFIG_DIR="$HOME/.config/joeos-opencode-bridge"; ENV_FILE="$CONFIG_DIR/vitros.env"; SERVICE_DIR="$HOME/.config/systemd/user"; SERVICE_FILE="$SERVICE_DIR/vitros-opencode-bridge.service"; mkdir -p "$CONFIG_DIR" "$SERVICE_DIR"; chmod 700 "$CONFIG_DIR"
OLD_MODEL="$(grep '^OPENCODE_MODEL=' "$ENV_FILE" 2>/dev/null || true)"; OLD_AGENT="$(grep '^OPENCODE_AGENT=' "$ENV_FILE" 2>/dev/null || true)"; OLD_ATTACH="$(grep '^OPENCODE_ATTACH_URL=' "$ENV_FILE" 2>/dev/null || true)"
cat > "$ENV_FILE" <<EOF
BRIDGE_REPO=$REPO
BRIDGE_ROOT=$ROOT
BRIDGE_TRUSTED_AUTHORS=jmw7629
BRIDGE_POLL_SECONDS=60
OPENCODE_BIN=$OPENCODE_BIN_PATH
EOF
[[ -n "$OLD_MODEL" ]] && printf '%s\n' "$OLD_MODEL" >> "$ENV_FILE"; [[ -n "$OLD_AGENT" ]] && printf '%s\n' "$OLD_AGENT" >> "$ENV_FILE"; [[ -n "$OLD_ATTACH" ]] && printf '%s\n' "$OLD_ATTACH" >> "$ENV_FILE"; chmod 600 "$ENV_FILE"

echo "[6/8] Pausing other OpenCode bridges to prioritize VITROS..."; systemctl --user disable --now stickdeath-byte-opencode-bridge.service 2>/dev/null || true; systemctl --user disable --now stickdeath-opencode-bridge.service 2>/dev/null || true

echo "[7/8] Writing VITROS service..."; cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=VITROS ChatGPT to OpenCode bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=-$ENV_FILE
ExecStart=/usr/bin/env python3 $ROOT/bridge/runner.py
Restart=on-failure
RestartSec=10
NoNewPrivileges=true
UMask=0077

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload; systemctl --user enable --now vitros-opencode-bridge.service

echo "[8/8] Status..."; systemctl --user --no-pager --full status vitros-opencode-bridge.service || true
echo; echo "VITROS bridge installed."; echo "OpenCode binary: $OPENCODE_BIN_PATH"; echo "Config: $ENV_FILE"; echo "Logs: journalctl --user -u vitros-opencode-bridge -f"; echo "No task auto-merges."
