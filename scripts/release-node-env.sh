#!/usr/bin/env bash

# Resolve and activate the repository's pinned release-lane Node toolchain.
# This keeps release verification deterministic even when the caller's shell
# prefers a different global Node/npm installation ahead of nvm-managed bins.

resolve_release_node_bin() {
  local root_dir="${1:?root_dir is required}"
  local release_node_spec
  release_node_spec="$(tr -d '[:space:]' < "$root_dir/.nvmrc")"

  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$nvm_dir/nvm.sh" ]]; then
    # Homebrew-managed Node installs often export npm_config_prefix, which makes
    # nvm complain even though we only want nvm long enough to resolve the
    # release-lane binary path.
    unset npm_config_prefix
    # shellcheck disable=SC1090
    . "$nvm_dir/nvm.sh"
    local resolved_node
    resolved_node="$(nvm which "$release_node_spec" 2>/dev/null || true)"
    if [[ -n "$resolved_node" && "$resolved_node" != "N/A" ]]; then
      dirname "$resolved_node"
      return 0
    fi
  fi

  local matched_dir
  matched_dir="$(
    find "$nvm_dir/versions/node" -maxdepth 1 -type d -name "v${release_node_spec}*" 2>/dev/null \
      | sort -V \
      | tail -n 1
  )"
  if [[ -n "$matched_dir" ]]; then
    printf '%s/bin\n' "$matched_dir"
    return 0
  fi

  return 1
}

use_release_node_toolchain() {
  local root_dir="${1:?root_dir is required}"
  local expected_node_major
  expected_node_major="$(tr -d '[:space:]' < "$root_dir/.nvmrc")"

  local release_node_bin
  if ! release_node_bin="$(resolve_release_node_bin "$root_dir")"; then
    echo "Unable to resolve Node $expected_node_major from .nvmrc." >&2
    echo "Install the release-lane toolchain first (for example: nvm install $expected_node_major)." >&2
    return 1
  fi

  export PATH="$release_node_bin:$PATH"
  hash -r

  local current_node_major
  current_node_major="$(node -p "process.versions.node.split('.')[0]")"
  local current_npm_major
  current_npm_major="$(npm -v | cut -d. -f1)"

  if [[ "$current_node_major" != "$expected_node_major" ]]; then
    echo "Release verification must run on Node $expected_node_major.x to match GitHub Actions." >&2
    echo "Resolved node path: $(command -v node)" >&2
    echo "Current Node version: $(node -v)" >&2
    return 1
  fi

  if [[ "$current_npm_major" != "10" ]]; then
    echo "Release verification must run on npm 10.x to match the pinned package manager." >&2
    echo "Resolved npm path: $(command -v npm)" >&2
    echo "Current npm version: $(npm -v)" >&2
    return 1
  fi

  echo "Using release-lane toolchain: node $(node -v), npm $(npm -v)"
}
