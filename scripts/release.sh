#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release.sh <patch|minor|major|x.y.z> [--push] [--no-verify]

Examples:
  ./scripts/release.sh patch
  ./scripts/release.sh minor --push
  ./scripts/release.sh 1.4.0 --push

Behavior:
  1) Ensures you are on main and working tree is clean.
  2) Enforces the repo-pinned Node/npm toolchain used by GitHub Actions.
  3) Refreshes dependencies with npm ci and optionally runs shared release verification unless --no-verify.
  4) Bumps version in package.json + package-lock.json (no auto git tag).
  5) Creates commit: chore(release): vX.Y.Z
  6) Creates annotated tag: vX.Y.Z
  7) With --push, atomically pushes main and the new tag to origin.
EOF
}

if [[ $# -eq 1 && ( "$1" == "-h" || "$1" == "--help" ) ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

VERSION_INPUT="$1"
shift

PUSH="false"
VERIFY="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      PUSH="true"
      shift
      ;;
    --no-verify)
      VERIFY="false"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/release-node-env.sh"
use_release_node_toolchain "$ROOT_DIR"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Not inside a git repository." >&2
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "Releases must be created from main. Current branch: $CURRENT_BRANCH" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash changes before releasing." >&2
  exit 1
fi

if [[ "$VERIFY" == "true" ]]; then
  "$ROOT_DIR/scripts/verify-release-lane.sh"
fi

echo "Bumping version: $VERSION_INPUT"
npm version "$VERSION_INPUT" --no-git-tag-version
node ./scripts/sync-version.js
NEW_VERSION="$(node -p "require('./package.json').version")"
TAG="v$NEW_VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag already exists: $TAG" >&2
  echo "Aborting release and leaving version files updated for manual review." >&2
  exit 1
fi

git add package.json package-lock.json openclaw.plugin.json src/version.ts docs/api.md
git commit -m "chore(release): $TAG"
git tag -a "$TAG" -m "Release $TAG"

echo "Created release commit + tag:"
echo "  Commit: chore(release): $TAG"
echo "  Tag:    $TAG"

if [[ "$PUSH" == "true" ]]; then
  echo "Atomically pushing main and tag to origin..."
  git push --atomic origin main "$TAG"
  echo "Pushed. Create a GitHub release from tag $TAG."
else
  echo "Local release prepared. Push when ready:"
  echo "  git push --atomic origin main $TAG"
fi
