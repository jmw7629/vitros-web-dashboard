#!/usr/bin/env bash
set -euo pipefail

for service in vitros-opencode-bridge.service vitros-opencode-verifier.service; do
  systemctl --user disable --now "$service" 2>/dev/null || true
done
rm -f \
  "$HOME/.config/systemd/user/vitros-opencode-bridge.service" \
  "$HOME/.config/systemd/user/vitros-opencode-verifier.service"
systemctl --user daemon-reload
echo "VITROS bridge/verifier services removed. Logs/state were preserved."
