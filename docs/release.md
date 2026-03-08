# Release

This document describes the supported local release flow for
`openclaw-event-server-plugin`.

## Recommended Flow

1. Make sure `main` is clean and up to date.
2. Switch to the repo-pinned Node toolchain:

```bash
nvm use
```

3. Run the shared preflight:

```bash
npm run verify:release-lane
```

4. Prepare the release locally:

```bash
./scripts/release.sh patch
```

Or prepare and push in one step:

```bash
./scripts/release.sh patch --push
```

## What The Script Does

- requires `main`
- requires a clean working tree
- requires the release lane toolchain from [`.nvmrc`](/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/.nvmrc), currently Node 20.x with npm 10.x, so local verification matches GitHub Actions
- refreshes dependencies with `npm ci`
- runs `npm run verify:release-lane` unless `--no-verify` is supplied
- bumps `package.json` and `package-lock.json`
- syncs `openclaw.plugin.json`, `src/version.ts`, and `docs/api.md`
- creates `chore(release): vX.Y.Z`
- creates annotated tag `vX.Y.Z`
- atomically pushes `main` and the tag when `--push` is used

## Why This Is Safer

- One shared verification command is used by local release prep and CI-style
  preflight.
- The release script fails fast when the local Node/npm toolchain does not
  match GitHub Actions, which prevents false-green local runs.
- `npm ci` makes the local dependency tree match the lockfile-based GitHub
  install path instead of relying on an older or mutated `node_modules`.
- The manual preflight command resolves the pinned release-lane toolchain
  directly, so it still works when the interactive shell prefers a different
  global Node installation.
- Compatibility coverage for newer supported Node majors lives in CI, but
  publishing stays pinned to the release lane so npm releases are deterministic.
- Atomic push prevents the branch/tag split-brain case where `main` pushes but
  the tag push fails afterward.
- Version bumping happens only after verification succeeds, so failed tests do
  not leave release commits or tags behind.

## Release Notes

If you want custom GitHub release notes, add:

```text
.github/release-notes/vX.Y.Z.md
```

before pushing the release tag.
