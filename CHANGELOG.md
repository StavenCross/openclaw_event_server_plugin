# Changelog

## 1.2.0 - 2026-03-11

This release expands the plugin from basic session/tool lifecycle coverage into
full modern OpenClaw run lifecycle coverage. It adds canonical events for model
resolution, prompt construction, model input/output, agent completion, and
session compaction while introducing a safer default privacy posture for those
new payloads.

### Highlights

- Added canonical event coverage for the modern OpenClaw typed hooks:
  - `agent.before_model_resolve`
  - `agent.before_prompt_build`
  - `agent.llm_input`
  - `agent.llm_output`
  - `agent.end`
  - `session.before_compaction`
  - `session.after_compaction`
- Added `privacy.payloadMode` with a metadata-first default so raw prompts,
  transcript messages, and assistant output are not broadcast unless operators
  explicitly opt into `full`.
- Extended Hook Bridge compatibility so the new agent/session lifecycle events
  can be matched with the same `eventType`, identity, and `data.*` selectors as
  the existing canonical event families.
- Hardened release engineering with a dedicated Node 20 release-lane preflight
  that mirrors the real publishing toolchain and GitHub Actions install path.

### Modern Lifecycle Coverage

- Added typed-hook registration and canonical event builders for the modern
  OpenClaw run hooks.
- Preserved stable canonical naming so downstream consumers can reason about
  the lifecycle without scraping raw gateway debug logs.
- Kept compaction events in the `session.*` family because the session
  transcript is the thing being compacted, while still preserving the acting
  `agentId` when available.
- Added a short-lived run tracker so `agent.llm_input` can emit derived audit
  fields such as:
  - `promptChangedFromBeforePromptBuild`
  - `promptLengthDeltaFromBeforePromptBuild`
  - `promptLengthDeltaFromBeforeModelResolve`
  - `historyMessageCountDeltaFromBeforePromptBuild`
- Fixed the tracker correlation path so those derived audit fields still work
  when OpenClaw omits an upstream `runId` but session identity is present.

### Privacy And Operator Safety

- Added `privacy.payloadMode=metadata|full` to the public config surface,
  environment loader, schema validation, and plugin manifest.
- Defaulted the modern lifecycle hooks to metadata-only payloads:
  - prompt lengths instead of prompt bodies
  - message counts and role summaries instead of transcript arrays
  - assistant text counts and lengths instead of assistant text content
- Preserved an explicit opt-in `full` mode for controlled debugging and
  observability workflows that truly need raw upstream payloads.
- Clarified that Tool Guard remains intentionally scoped to synchronous
  `before_tool_call` evaluation; prompt/model/compaction hooks are observable to
  Hook Bridge but are not part of Tool Guard enforcement.
- Documented that raw gateway debug logs can expose sensitive plugin config and
  should be treated as short-lived diagnostic artifacts.

### Release And Verification Improvements

- Added `npm run verify:release-lane`, which switches to the repo-pinned
  release toolchain, refreshes dependencies with `npm ci`, and runs the shared
  CI-style verification flow.
- Added `scripts/release-node-env.sh` so the release path and the manual
  preflight path share the same Node/npm selection logic.
- Simplified `scripts/release.sh` to reuse the release-lane toolchain helper
  and shared verification command instead of duplicating local toolchain logic.
- Corrected compatibility references so docs point to the current pinned
  OpenClaw hook-surface fixture.

### Testing And Documentation

- Added focused unit coverage for:
  - modern lifecycle typed hook registration
  - compaction hook registration
  - privacy mode shaping (`metadata` vs `full`)
  - Hook Bridge matching for the new lifecycle events
  - run-tracker behavior when `runId` is absent
- Added integration coverage for:
  - end-to-end emission of the modern lifecycle events
  - compaction event broadcasting
  - explicit full-payload opt-in behavior
- Updated documentation across:
  - `README.md`
  - `docs/api.md`
  - `docs/events.md`
  - `docs/backend.md`
  - `docs/testing.md`
  - `docs/Tool_guard.md`

### Breaking Changes

- None.

### Upgrade Notes

- No config migration is required for existing installs.
- If you want raw prompt/model/transcript content for the new lifecycle hooks,
  set `privacy.payloadMode: "full"` or
  `EVENT_PLUGIN_MODERN_LIFECYCLE_PAYLOAD_MODE=full`.
- If you do nothing, the new lifecycle hooks emit metadata-only payloads by
  default.
- Release preparation should continue to use the pinned release lane:
  - `npm run verify:release-lane`

### Validation

Validated on the release-prep state with:

- `npm run verify:release-lane`

Result:

- Node `v20.20.0`
- 43 test suites passed
- 285 tests passed
- coverage thresholds passed

## 1.1.1 - 2026-03-07

Published release for the March 7 feature set. `1.1.0` was intentionally skipped during release testing, so `1.1.1` carries the full feature notes plus the final CI-stability adjustment used for the public release.

### Fixes

- Removed a platform-sensitive assumption from the single-owner transport integration suite.
- Updated the `keeps tool guard local in follower runtimes while owner transports the resulting guard events` test to use a static Tool Guard decision instead of a local shell script.
- Kept the actual local-script Tool Guard coverage in the dedicated hook-bridge integration tests, where that behavior is already validated directly.

### Why This Release Exists

- `1.1.0` was used as an internal release-testing version and intentionally not kept as the public release tag.
- During release testing we found one integration test that was too platform-sensitive for the public release flow.
- No transport code change was required for the fix; the issue was the test's platform-sensitive setup.

### Full Release Notes

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
