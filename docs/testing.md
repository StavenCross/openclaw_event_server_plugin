# Testing

This document describes the test strategy and suites for `openclaw-event-server-plugin`.

## Run Commands

Run full local checks:

```bash
npm run lint
npm run build
npm test -- --runInBand
```

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
npm test -- --runInBand
```

This reduces worker-related nondeterminism and aligns with local review runs.
