# Testing

This document describes the test strategy and suites for `openclaw-event-server-plugin`.

## Run Commands

Run full local checks:

```bash
nvm use
npm ci
npm run lint
npm run build
npm test -- --runInBand
npm run verify:release
npm run verify:ci
npm run verify:release-lane
```

Preferred release preflight:

```bash
npm run verify:release-lane
```

This resolves the Node toolchain from [`.nvmrc`](/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/.nvmrc), refreshes dependencies with
`npm ci`, and runs the same release-lane verification path used by the local
release script.

## Toolchain Parity

Switch to the repository-pinned Node toolchain before validating release work:

```bash
nvm use
```

GitHub Actions reads [`.nvmrc`](/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/.nvmrc) and installs dependencies with `npm ci`, so local release verification
should do the same. Running tests on a newer Node major can hide or introduce
socket and timing behavior that does not match the release runners.

If your interactive shell still prefers another global Node installation, use:

```bash
npm run verify:release-lane
```

That command resolves the pinned release-lane binaries directly, so it remains
reliable even when `nvm use` alone is not enough in the current shell session.

The CI workflow also runs a compatibility matrix on Node 20, 22, and 24. Node
20 is the canonical release lane, while newer majors are treated as
compatibility signals rather than the version used to publish a release.

Focused suites:

```bash
npm run test:unit
npm run test:integration
```

## Test Stack

- Test runner: Jest (`ts-jest`)
- Environment: Node
- Setup file: `tests/setup.ts`
- Coverage output: `coverage/` (text, lcov, html)

## Suite Layout

- `tests/unit`: fast behavior-level tests for pure/runtime modules
- `tests/integration`: plugin lifecycle and runtime interaction tests
- `tests/contract`: compatibility + envelope contract tests

## Unit Coverage Areas

Key unit suites include:

- config: defaults/env merge/validation/filtering
- events: canonical event type mapping
- redaction/signing behavior
- message hook parsing
- status reducer + subagent tracker
- runtime event operations and utility helpers
- hook bridge action execution and tool guard matching/decision logic
- modern agent lifecycle typed hook registration and canonical event mapping
- compaction lifecycle typed hook registration and canonical event mapping
- privacy-mode shaping for modern lifecycle payloads (`metadata` vs `full`)
- transport manager owner/follower logic
- transport owner self-recovery after transient relay socket bind failures
- transport lock reclaim when a fresh lock references a dead owner pid
- transport recovery logging for follower relay failures and owner demotion/rebind
- owner relay socket listening logs and live-owner lock contention diagnostics
- relay socket auth/ack/error handling
- websocket security authorization checks
- event file logging behavior
- hook bridge config validation edge cases

## Integration Coverage Areas

Integration suites validate end-to-end plugin behavior across hooks and transport:

- plugin hook mapping and lifecycle (`plugin-hooks-core`, `plugin-hooks-lifecycle`)
- tool guard integration (`plugin-hooks-tool-guard`)
- hook bridge matching for modern agent/session lifecycle events (currently covered in focused unit tests)
- explicit opt-in tests for full lifecycle payload mode
- queue init and queue delivery/retry/persistence
- webhook delivery flow
- websocket fallback/startup behavior and server behavior
- HMAC secret file resolution
- single-owner transport coordination
- owner demotion/failover cleanup of the singleton WebSocket broadcast server
- owner relay recovery without requiring a gateway restart after transient socket bind failure

## Contract Coverage Areas

Contract suites ensure compatibility and schema stability:

- OpenClaw hook-surface fixture compatibility
- canonical event envelope replay stability
- event type/category lockstep contract

## Coverage Thresholds

Defined in `jest.config.js`:

- branches: 70%
- functions: 80%
- lines: 80%
- statements: 80%

## CI Recommendation

Use deterministic execution in CI:

```bash
npm run verify:ci
```

This reduces worker-related nondeterminism and keeps the CI path aligned with
local release verification.
