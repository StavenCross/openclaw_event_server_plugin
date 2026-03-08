#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Reuse the same toolchain selection logic as the release script so the manual
# preflight command exercises the same Node/npm lane as the real release flow.
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/release-node-env.sh"
use_release_node_toolchain "$ROOT_DIR"

echo "Refreshing dependencies with npm ci to match GitHub Actions..."
npm ci

echo "Running release-lane verification (CI=1 lint + build + test)..."
npm run verify:ci
