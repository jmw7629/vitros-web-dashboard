#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Do not install the VITROS verifier service as root." >&2
  exit 1
fi

for cmd in git gh python3 systemctl; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing required command: $cmd" >&2
    exit 1
  }
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$ROOT" ]] || {
  echo "Run from inside vitros-web-dashboard." >&2
  exit 1
}
REMOTE="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
[[ "$REMOTE" == *"jmw7629/vitros-web-dashboard"* ]] || {
  echo "Unexpected origin: $REMOTE" >&2
  exit 1
}
[[ -z "$(git -C "$ROOT" status --porcelain)" ]] || {
  echo "Control checkout must be clean before installing verifier service." >&2
  exit 1
}

CONFIG_DIR="$HOME/.config/joeos-opencode-bridge"
ENV_FILE="$CONFIG_DIR/vitros.env"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/vitros-opencode-verifier.service"
mkdir -p "$CONFIG_DIR" "$SERVICE_DIR"
chmod 700 "$CONFIG_DIR"

# Reuse the builder's environment when present so model/provider configuration
# stays identical. Never echo env-file contents because it may contain tokens.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

OPENCODE_BIN_PATH="${OPENCODE_BIN:-$(command -v opencode 2>/dev/null || true)}"
[[ -n "$OPENCODE_BIN_PATH" && -x "$OPENCODE_BIN_PATH" ]] || {
  echo "OpenCode executable is missing. Set OPENCODE_BIN in $ENV_FILE to a working user-local binary." >&2
  exit 1
}
case "$(readlink -f "$OPENCODE_BIN_PATH")" in
  /snap/*)
    echo "Snap OpenCode is not supported by the hardened VITROS verifier." >&2
    echo "Set OPENCODE_BIN in $ENV_FILE to a proven user-local non-snap executable." >&2
    exit 1
    ;;
esac

"$OPENCODE_BIN_PATH" --version >/dev/null
HELP="$($OPENCODE_BIN_PATH run --help 2>&1 || true)"
for flag in --dir --auto --format; do
  grep -q -- "$flag" <<<"$HELP" || {
    echo "OpenCode run is missing required flag: $flag" >&2
    exit 1
  }
done

python3 "$ROOT/bridge/test_verifier_runner.py"

# Write only non-secret bridge defaults when an env file does not yet exist.
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<EOF
BRIDGE_REPO=jmw7629/vitros-web-dashboard
BRIDGE_ROOT=$ROOT
BRIDGE_TRUSTED_AUTHORS=jmw7629
BRIDGE_POLL_SECONDS=60
OPENCODE_BIN=$OPENCODE_BIN_PATH
EOF
  chmod 600 "$ENV_FILE"
fi

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=VITROS independent OpenCode verifier worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=-$ENV_FILE
ExecStart=/usr/bin/env python3 $ROOT/bridge/verifier_runner.py
Restart=on-failure
RestartSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$HOME/.local/state/joeos-opencode-bridge $HOME/.cache/joeos-opencode-bridge
UMask=0077

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now vitros-opencode-verifier.service

systemctl --user --no-pager --full status vitros-opencode-verifier.service || true

echo
echo "VITROS verifier service installed."
echo "OpenCode binary: $OPENCODE_BIN_PATH"
echo "Service: vitros-opencode-verifier.service"
echo "Logs: journalctl --user -u vitros-opencode-verifier.service -f"
echo "The control checkout is read-only to the verifier service; disposable sandboxes live under the verifier cache."
