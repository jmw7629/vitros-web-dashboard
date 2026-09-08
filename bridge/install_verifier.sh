#!/usr/bin/env bash
set -euo pipefail
umask 077

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
HELPERS="$ROOT/bridge/verifier_install_helpers.sh"
[[ -f "$HELPERS" ]] || {
  echo "Missing verifier installer helper library: $HELPERS" >&2
  exit 1
}
# shellcheck disable=SC1090
source "$HELPERS"

verifier_validate_source_checkout "$ROOT" || exit 1
REMOTE="$(git -C "$ROOT" config --get remote.origin.url 2>/dev/null || true)"
SOURCE_HEAD="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"

CONFIG_DIR="$HOME/.config/joeos-opencode-bridge"
ENV_FILE="$CONFIG_DIR/vitros.env"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/vitros-opencode-verifier.service"
mkdir -p "$CONFIG_DIR" "$SERVICE_DIR"
chmod 700 "$CONFIG_DIR"

# Reuse shared non-root builder settings when present. BRIDGE_ROOT from this
# file is never authoritative for the verifier because ExecStart always passes
# an explicit dedicated --root selected below.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# Authoritative verifier control root. It cannot be redirected by BRIDGE_ROOT
# from the builder environment. An existing dirty/non-git checkout fails closed;
# an existing clean checkout at a different HEAD is preserved and a unique
# sibling is provisioned at the exact installer source SHA.
VERIFIER_CONTROL_ROOT_DEFAULT="$HOME/.local/share/joeos-opencode-bridge/vitros-verifier-control-v2"
VERIFIER_CONTROL_ROOT="$(
  verifier_select_control_root "$REMOTE" "$VERIFIER_CONTROL_ROOT_DEFAULT" "$SOURCE_HEAD"
)" || {
  echo "Dedicated verifier control provisioning failed; builder-root fallback is prohibited." >&2
  exit 1
}
[[ -n "$VERIFIER_CONTROL_ROOT" ]] || {
  echo "Dedicated verifier control provisioning returned no root; failing closed." >&2
  exit 1
}

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
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<EOF
BRIDGE_REPO=jmw7629/vitros-web-dashboard
BRIDGE_ROOT=$ROOT
BRIDGE_TRUSTED_AUTHORS=jmw7629
BRIDGE_POLL_SECONDS=60
BRIDGE_VERIFIER_OPENCODE_TIMEOUT_SECONDS=900
OPENCODE_BIN=$OPENCODE_BIN_PATH
EOF
  chmod 600 "$ENV_FILE"
fi

verifier_render_unit "$VERIFIER_CONTROL_ROOT" "$ENV_FILE" "$HOME" > "$SERVICE_FILE"

systemctl --user daemon-reload

# Verify effective unit after daemon-reload: check that no systemd user drop-in
# overrides the reviewed control root's WorkingDirectory or ExecStart. Fail
# closed before any start/enable action if an override is detected.
EFFECTIVE_UNIT="$(systemctl --user cat vitros-opencode-verifier.service 2>/dev/null || true)"

if [[ -n "$EFFECTIVE_UNIT" ]]; then
  EFFECTIVE_WORKDIR="$(echo "$EFFECTIVE_UNIT" | grep '^WorkingDirectory=' | head -1 | cut -d= -f2- || true)"
  EFFECTIVE_EXECSTART="$(echo "$EFFECTIVE_UNIT" | grep '^ExecStart=' | head -1 | cut -d= -f2- || true)"

  EXPECTED_WORKDIR="$VERIFIER_CONTROL_ROOT"
  EXPECTED_EXECSTART="/usr/bin/env python3 $VERIFIER_CONTROL_ROOT/bridge/verifier_gate_runner.py --root $VERIFIER_CONTROL_ROOT"

  if [[ "$EFFECTIVE_WORKDIR" != "$EXPECTED_WORKDIR" ]]; then
    DROP_IN_PATHS="$(systemctl --user show vitros-opencode-verifier.service --property=DropInPaths 2>/dev/null | tail -n +2 || true)"
    fail_closed "Effective WorkingDirectory mismatch: expected $EXPECTED_WORKDIR, got $EFFECTIVE_WORKDIR. Conflicting drop-in(s): $DROP_IN_PATHS. Installer aborted to prevent running verifier with overridden control root."
  fi

  if [[ "$EFFECTIVE_EXECSTART" != "$EXPECTED_EXECSTART" ]]; then
    fail_closed "Effective ExecStart mismatch: expected $EXPECTED_EXECSTART, got $EFFECTIVE_EXECSTART. Installer aborted to prevent running verifier with overridden ExecStart."
  fi
fi

systemctl --user enable --now vitros-opencode-verifier.service

systemctl --user --no-pager --full status vitros-opencode-verifier.service || true

echo
echo "VITROS verifier service installed."
echo "OpenCode binary: $OPENCODE_BIN_PATH"
echo "Service: vitros-opencode-verifier.service"
echo "Logs: journalctl --user -u vitros-opencode-verifier.service -f"
echo "The control checkout is read-only to the verifier service; disposable sandboxes live under the verifier cache."
