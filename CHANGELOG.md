# Changelog

## 1.1.1 - 2026-03-07

Patch release to replace the failed `v1.1.0` rollout with a CI-stable build.

### Fixes

- Removed a platform-sensitive assumption from the single-owner transport integration suite.
- Updated the `keeps tool guard local in follower runtimes while owner transports the resulting guard events` test to use a static Tool Guard decision instead of a local shell script.
- Kept the actual local-script Tool Guard coverage in the dedicated hook-bridge integration tests, where that behavior is already validated directly.

### Why This Release Exists

- `v1.1.0` was published, but the GitHub Actions runs for both `main` and the release tag failed on Linux.
- The failure was isolated to one integration test that passed locally on macOS but intermittently returned `undefined` on the runner.
- No transport code change was required for the fix; the issue was the test's platform-sensitive setup.

### Validation

- `npm run lint`
- `npm run build`
- `npm test -- --runInBand`

Result:

- 38 test suites passed
- 251 tests passed
- coverage thresholds passed

## 1.1.0 - 2026-03-07

This feature release rolls up the full transport hardening and release engineering work landed on `main` on March 7, 2026.

### Highlights

- Introduced single-owner transport with local relay so only one runtime publishes the public event stream while other runtimes still emit canonical events locally.
- Changed `transport.mode=auto` to a gateway-owned model: gateway runtimes become the owner, agent and unknown runtimes remain followers, and follower runtimes never self-promote later.
- Hardened runtime detection and owner demotion behavior so stale or incidental background processes cannot continue serving the WebSocket event server after losing transport ownership.
- Refreshed the dependency and lint/tooling stack, including the flat ESLint config migration and coordinated Jest 30 upgrade.
- Added substantial transport, hook, relay, runtime-kind, and release regression coverage.

### Transport And Runtime Changes

- Added the owner/follower transport coordinator, lock management, relay protocol, relay client/server, and deduplication path.
- Ensured owner-only handling for:
  - WebSocket broadcast
  - webhook queueing and delivery
  - NDJSON event logging
  - async Hook Bridge event dispatch
- Kept local-only handling for synchronous Tool Guard evaluation so pre-tool decisions still happen in the runtime where the tool call originates.
- Added automatic WebSocket startup retry after transient full port exhaustion.
- Added runtime-kind detection and `EVENT_PLUGIN_RUNTIME_KIND_OVERRIDE` support for wrapped or unusual process launches.
- Made `auto` resolve to the gateway as the public transport hub, with all other runtimes relaying into it.
- Hardened Unix socket path resolution and Windows named-pipe handling for transport sockets.

### Dependency And Tooling Updates

- Upgraded `jest` to `30.2.0` and `@types/jest` to `30.0.0`.
- Upgraded `eslint` to `10.0.3`.
- Upgraded `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` to `8.56.1`.
- Upgraded `@types/node` to `20.19.37`.
- Upgraded `uuid` to `11.1.0`, which is the highest compatible non-ESM-breaking version for the current runtime/tooling setup.
- Replaced the legacy `.eslintrc.json` setup with `eslint.config.js`.

### Test Coverage

- Added end-to-end coverage for single-owner transport across owner/follower runtimes.
- Added relay socket/auth coverage for accepted, rejected, oversized, and malformed relay cases.
- Added regression coverage for:
  - owner demotion shutting down the singleton WebSocket server
  - follower shutdown not unlinking the active owner socket
  - broken owner demotion and lock release
  - `auto` mode resolving gateway ownership correctly
  - unknown-runtime warning behavior
  - runtime-kind parsing not misclassifying incidental argv tokens
- Expanded Tool Guard, hook-bridge config validation, queue initialization, and event-log behavior coverage.

### Documentation Updates

- Reorganized and expanded implementation documentation under [`docs/`](./docs/README.md).
- Updated:
  - [README](./README.md)
  - [Transport](./docs/transport.md)
  - [Socket Layer](./docs/socket-layer.md)
  - [API](./docs/api.md)
  - [Backend](./docs/backend.md)
  - [Security](./docs/security.md)
  - [Testing](./docs/testing.md)
  - [Tool Guard](./docs/Tool_guard.md)
  - [Hook Bridge](./docs/hookbridge.md)
  - [HookBridge + ToolGuard Actions](./docs/hookbridge-toolguard-actions.md)
  - [UI](./docs/ui.md)
- Added clearer operator guidance for nonstandard process launches and runtime-kind overrides.
- Added release workflow improvements so future version bumps update plugin metadata and versioned API docs together.

### Validation

Validated on the `1.1.0` release prep state with:

- `npm run lint`
- `npm run build`
- `npm test -- --runInBand`

Result:

- 38 test suites passed
- 251 tests passed
- coverage thresholds passed
