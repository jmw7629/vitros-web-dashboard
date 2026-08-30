#!/usr/bin/env bash
set -euo pipefail
systemctl --user disable --now vitros-opencode-bridge.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/vitros-opencode-bridge.service"
systemctl --user daemon-reload
echo "VITROS bridge service removed. Logs/state were preserved."
