#!/usr/bin/env bash
set -euo pipefail

# Keep verifier control checkouts clean: Python bytecode is runtime cache, not source.
export PYTHONDONTWRITEBYTECODE=1

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

# Always isolate verifier control from the builder/live checkout. The builder
# environment may set BRIDGE_ROOT to a dirty runtime checkout; the verifier must
# never trust that path for its own control code. Provision a dedicated clean
# clone pinned to the exact installer commit and pass it explicitly via --root.
BRIDGE_HEAD=$(git rev-parse HEAD)
VERIFIER_CONTROL_ROOT="$HOME/.local/share/joeos-opencode-bridge/vitros-verifier-control"
if [[ -e "$VERIFIER_CONTROL_ROOT" ]]; then
  [[ -d "$VERIFIER_CONTROL_ROOT/.git" ]] || {
    echo "Verifier control root exists but is not a git checkout: $VERIFIER_CONTROL_ROOT" >&2
    exit 1
  }
  CONTROL_REMOTE=$(git -C "$VERIFIER_CONTROL_ROOT" remote get-url origin 2>/dev/null || true)
  [[ "$CONTROL_REMOTE" == *"jmw7629/vitros-web-dashboard"* ]] || {
    echo "Unexpected verifier control origin: $CONTROL_REMOTE" >&2
    exit 1
  }
  [[ -z "$(git -C "$VERIFIER_CONTROL_ROOT" status --porcelain)" ]] || {
    echo "Verifier control checkout is dirty; refusing to overwrite it." >&2
    exit 1
  }
else
  mkdir -p "$(dirname "$VERIFIER_CONTROL_ROOT")"
  git clone --no-checkout "$REMOTE" "$VERIFIER_CONTROL_ROOT"
fi

git -C "$VERIFIER_CONTROL_ROOT" fetch --quiet origin "$BRIDGE_HEAD"
git -C "$VERIFIER_CONTROL_ROOT" checkout --quiet --detach "$BRIDGE_HEAD"
[[ "$(git -C "$VERIFIER_CONTROL_ROOT" rev-parse HEAD)" == "$BRIDGE_HEAD" ]] || {
  echo "Verifier control checkout did not pin to installer head $BRIDGE_HEAD" >&2
  exit 1
}
[[ -z "$(git -C "$VERIFIER_CONTROL_ROOT" status --porcelain)" ]] || {
  echo "Verifier control checkout became dirty during provisioning." >&2
  exit 1
}
BRIDGE_ROOT="$VERIFIER_CONTROL_ROOT"
echo "Dedicated verifier control root: $BRIDGE_ROOT" >&2

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
GLOBAL_HELP="$($OPENCODE_BIN_PATH --help 2>&1 || true)"
grep -q -- "--pure" <<<"$GLOBAL_HELP" || {
  echo "OpenCode is missing the required global --pure isolation flag." >&2
  exit 1
}
RUN_HELP="$($OPENCODE_BIN_PATH run --help 2>&1 || true)"
for flag in --dir --auto --format --agent; do
  grep -q -- "$flag" <<<"$RUN_HELP" || {
    echo "OpenCode run is missing required flag: $flag" >&2
    exit 1
  }
done

python3 "$ROOT/bridge/test_verifier_runner.py"
python3 "$ROOT/bridge/test_verifier_gate_runner.py"

# Write only non-secret bridge defaults when an env file does not yet exist.
# BRIDGE_ROOT is always the dedicated verifier control clone. If an existing
# env file still names a builder/live root, the service CLI --root below takes
# precedence and keeps verifier control isolated.
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<EOF
BRIDGE_REPO=jmw7629/vitros-web-dashboard
BRIDGE_ROOT=$BRIDGE_ROOT
BRIDGE_TRUSTED_AUTHORS=jmw7629
BRIDGE_POLL_SECONDS=60
BRIDGE_VERIFIER_OPENCODE_TIMEOUT_SECONDS=900
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
WorkingDirectory=$BRIDGE_ROOT
EnvironmentFile=-$ENV_FILE
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/usr/bin/env python3 $BRIDGE_ROOT/bridge/verifier_gate_runner.py --root $BRIDGE_ROOT
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
