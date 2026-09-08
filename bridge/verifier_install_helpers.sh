#!/usr/bin/env bash

# Pure helper functions for the hardened VITROS verifier installer.
# This file intentionally performs no service mutation when sourced.

verifier_fail() {
  printf '%s\n' "$*" >&2
  return 1
}

verifier_repo_identity_ok() {
  local remote="${1:-}"
  case "$remote" in
    https://github.com/jmw7629/vitros-web-dashboard|https://github.com/jmw7629/vitros-web-dashboard.git|git@github.com:jmw7629/vitros-web-dashboard|git@github.com:jmw7629/vitros-web-dashboard.git|ssh://git@github.com/jmw7629/vitros-web-dashboard|ssh://git@github.com/jmw7629/vitros-web-dashboard.git)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

verifier_checkout_head() {
  git -C "$1" rev-parse HEAD 2>/dev/null
}

verifier_checkout_clean() {
  [[ -z "$(GIT_OPTIONAL_LOCKS=0 git -C "$1" status --porcelain --untracked-files=all 2>/dev/null)" ]]
}

verifier_validate_source_checkout() {
  local path="$1"
  [[ -d "$path" ]] || verifier_fail "Installer source path is not a directory." || return 1
  [[ "$(git -C "$path" rev-parse --is-inside-work-tree 2>/dev/null || true)" == "true" ]] || \
    verifier_fail "Installer source is not a Git checkout." || return 1
  verifier_checkout_clean "$path" || \
    verifier_fail "Control checkout must be clean before installing verifier service; preserving it byte-for-byte and failing closed." || return 1
  local remote head
  remote="$(git -C "$path" config --get remote.origin.url 2>/dev/null || true)"
  verifier_repo_identity_ok "$remote" || verifier_fail "Unexpected source origin; verifier installation refused." || return 1
  head="$(verifier_checkout_head "$path" || true)"
  [[ "$head" =~ ^[0-9a-fA-F]{40}$ ]] || verifier_fail "Cannot resolve exact installer source HEAD." || return 1
}

verifier_validate_existing_control() {
  local path="$1"
  [[ -d "$path" ]] || verifier_fail "Verifier control path is not a directory: $path" || return 1
  [[ "$(git -C "$path" rev-parse --is-inside-work-tree 2>/dev/null || true)" == "true" ]] || \
    verifier_fail "Verifier control path is not a Git checkout; preserving it byte-for-byte and failing closed: $path" || return 1
  verifier_checkout_clean "$path" || \
    verifier_fail "Verifier control checkout is dirty; preserving it byte-for-byte and failing closed: $path" || return 1
  local remote
  remote="$(git -C "$path" config --get remote.origin.url 2>/dev/null || true)"
  verifier_repo_identity_ok "$remote" || \
    verifier_fail "Verifier control checkout has an unexpected origin; preserving it byte-for-byte and failing closed: $path" || return 1
}

verifier_target_available_for_clone() {
  local target="$1"
  if [[ ! -e "$target" ]]; then
    return 0
  fi
  [[ -d "$target" ]] || return 1
  [[ -z "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]
}

verifier_provision_control() {
  local remote="$1"
  local target="$2"
  local source_head="$3"

  [[ "$source_head" =~ ^[0-9a-fA-F]{40}$ ]] || verifier_fail "Source HEAD is not a full 40-character SHA." || return 1
  verifier_repo_identity_ok "$remote" || verifier_fail "Unexpected source origin; verifier provisioning refused." || return 1
  verifier_target_available_for_clone "$target" || verifier_fail "Refusing to provision over an existing non-empty path: $target" || return 1

  mkdir -p "$(dirname "$target")"
  git clone --quiet --no-checkout -- "$remote" "$target" || \
    verifier_fail "Failed to clone dedicated verifier control checkout; falling back to builder root is prohibited." || return 1
  # Canonicalize origin back to the validated source URL. This avoids persisting
  # any local Git URL rewrite while keeping the control checkout tied to GitHub.
  git -C "$target" remote set-url origin "$remote" || \
    verifier_fail "Dedicated verifier checkout origin could not be canonicalized; installation failed closed at $target." || return 1
  git -C "$target" checkout --quiet --detach "$source_head" || \
    verifier_fail "Dedicated verifier checkout could not pin exact source HEAD; installation failed closed at $target." || return 1

  local actual_head actual_remote
  actual_head="$(verifier_checkout_head "$target" || true)"
  actual_remote="$(git -C "$target" config --get remote.origin.url 2>/dev/null || true)"
  [[ "$actual_head" == "$source_head" ]] || \
    verifier_fail "Dedicated verifier checkout HEAD mismatch after provisioning; installation failed closed at $target." || return 1
  verifier_repo_identity_ok "$actual_remote" || \
    verifier_fail "Dedicated verifier checkout origin mismatch after provisioning; installation failed closed at $target." || return 1
  verifier_checkout_clean "$target" || \
    verifier_fail "Dedicated verifier checkout is dirty immediately after provisioning; installation failed closed at $target." || return 1
}

verifier_select_control_root() {
  local remote="$1"
  local default_root="$2"
  local source_head="$3"

  if [[ -e "$default_root" ]]; then
    verifier_validate_existing_control "$default_root" || return 1
    local actual_head
    actual_head="$(verifier_checkout_head "$default_root" || true)"
    if [[ "$actual_head" == "$source_head" ]]; then
      printf '%s\n' "$default_root"
      return 0
    fi

    # Preserve the existing clean-but-mismatched checkout. Provision a new unique
    # sibling pinned to the installer source HEAD instead of resetting/replacing it.
    local unique_root
    unique_root="$(mktemp -d "${default_root}-installer-XXXXXXXX")" || \
      verifier_fail "Could not allocate a unique verifier control path." || return 1
    verifier_provision_control "$remote" "$unique_root" "$source_head" || return 1
    printf '%s\n' "$unique_root"
    return 0
  fi

  verifier_provision_control "$remote" "$default_root" "$source_head" || return 1
  printf '%s\n' "$default_root"
}

verifier_render_unit() {
  local control_root="$1"
  local env_file="$2"
  local home_dir="$3"
  cat <<EOF
[Unit]
Description=VITROS independent OpenCode verifier worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$control_root
EnvironmentFile=-$env_file
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/usr/bin/env python3 $control_root/bridge/verifier_gate_runner.py --root $control_root
Restart=on-failure
RestartSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$home_dir/.local/state/joeos-opencode-bridge $home_dir/.cache/joeos-opencode-bridge
UMask=0077

[Install]
WantedBy=default.target
EOF
}

verifier_inspect_working_directory() {
  local service="$1"

  local output
  output=$(systemctl --user show "$service" --property=WorkingDirectory --value --no-pager 2>/dev/null) || {
    verifier_fail "systemctl show --property=WorkingDirectory failed for $service"
    return 1
  }

  if [[ -z "$output" ]]; then
    verifier_fail "Empty WorkingDirectory value from systemctl show for $service"
    return 1
  fi

  # No grep/PCRE/prefix stripping — just validate we have a non‑empty path.
  # --value should strip the “WorkingDirectory=” prefix, leaving just the path.
  printf '%s' "$output"
  return 0
}

verifier_inspect_execstart() {
  local service="$1"
  local control_root="$2"

  local output
  output=$(systemctl --user show "$service" --property=ExecStart --value --no-pager 2>/dev/null) || {
    verifier_fail "systemctl show --property=ExecStart failed for $service"
    return 1
  }

  if [[ -z "$output" ]]; then
    verifier_fail "Empty ExecStart value from systemctl show for $service"
    return 1
  fi

  # Prove path=/usr/bin/env exists in the structured effective value.
  if [[ "$output" != *'/usr/bin/env'* ]]; then
    verifier_fail "ExecStart path is not /usr/bin/env"
    return 1
  fi

  # Extract argv[]= segment using shell parameter expansion (no grep -oP).
  local argv_value=""
  if [[ "$output" == *'argv[]='* ]]; then
    argv_value="${output#*argv[]=}"
    argv_value="${argv_value%%;*}"
    argv_value="${argv_value%%}*}"
    argv_value="${argv_value# }"
  fi

  # Verify the argv segment contains the required components.
  # Must equal /usr/bin/env python3 <control>/bridge/verifier_gate_runner.py --root <control>
  local expected_argv="/usr/bin/env python3 ${control_root}/bridge/verifier_gate_runner.py --root ${control_root}"
  if [[ "$argv_value" != "$expected_argv" ]]; then
    verifier_fail "ExecStart argv does not match expected [$expected_argv]; got ${argv_value:-<empty>}"
    return 1
  fi

  return 0
}

verifier_activate_unit() {
  local service="$1"
  local control_root="$2"

  # Step 1: daemon-reload
  systemctl --user daemon-reload || {
    verifier_fail "systemctl --user daemon-reload failed"
    return 1
  }

  # Step 2: validate effective WorkingDirectory
  local wd
  wd=$(verifier_inspect_working_directory "$service") || {
    verifier_fail "WorkingDirectory inspection failed; failing closed before activation"
    return 1
  }

  # Step 3: validate effective ExecStart
  local es
  es=$(verifier_inspect_execstart "$service" "$control_root") || {
    verifier_fail "ExecStart inspection failed; failing closed before activation"
    return 1
  }

  # Step 4: enable and start the unit — only if all inspections passed
  systemctl --user enable --now "$service" || {
    verifier_fail "systemctl --user enable --now failed for $service"
    return 1
  }

  return 0
}
