# Testing Guide

This project uses Jest with unit and integration coverage for event mapping, runtime hook wiring, webhook delivery, queue reliability, and WebSocket fallback startup.

## Run all checks

```bash
npm run lint
npm run build
npm test -- --runInBand
```

## Test suites

### Unit

- `tests/unit/config-defaults-env.test.ts`
  - config defaults and environment parsing
- `tests/unit/config-merge-validate.test.ts`
  - config merge and validation rules
- `tests/unit/config-runtime-filter.test.ts`
  - runtime config resolution and event filtering
- `tests/unit/event-types.test.ts`
  - canonical event builders
- `tests/unit/redaction.test.ts`
  - payload redaction behavior (disabled by default, recursive key masking)
- `tests/unit/signing.test.ts`
  - HMAC signing behavior (disabled/secret-missing/enabled)
- `tests/unit/subagent-tracker.test.ts`
  - subagent spawn/activity/idle transition tracking
- `tests/unit/event-file-logger.test.ts`
  - file logging output modes, runtime-level filtering, and max-file-size rollover
- `tests/unit/websocket-security.test.ts`
  - WS auth token, origin allowlist, IP allowlist authorization logic
- `tests/unit/message-hooks.test.ts`
  - message hook parsing and validation
- `tests/unit/tracker.test.ts`
  - tool/session tracker behavior

### Integration

- `tests/integration/plugin-hooks.test.ts`
  - full plugin activation + hook registration + broadcast coverage
  - verifies message/tool/session/subagent/agent/gateway mappings
  - verifies subagent lifecycle + parent/child linkage behavior
- `tests/integration/queue-initialization.test.ts`
  - verifies queue is initialized at activation (not dependent on `gateway:startup`)
- `tests/integration/queue.test.ts`
  - enqueue/flush/retry/persistence behavior
  - includes persisted-queue merge safety test during startup load
  - validates atomic persistence writes (no temp-file leakage)
- `tests/integration/webhook.test.ts`
  - webhook request behavior and retry rules
- `tests/integration/websocket-fallback.test.ts`
  - fallback ports and startup stability under `EADDRINUSE`
- `tests/integration/hmac-secret-file.test.ts`
  - HMAC file-path behavior for missing/empty/valid secret files and runtime resolution

### Contract

- `tests/contract/openclaw-hook-surface.test.ts`
  - pinned OpenClaw hook-surface compatibility against fixture commit metadata
- `tests/contract/event-envelope-replay.test.ts`
  - Mission Control replay fixture validating canonical event envelope stability, including `schemaVersion`
- `tests/contract/event-type-category-contract.test.ts`
  - lockstep mapping between valid event types, expected categories, and config filter schema enums

## Coverage thresholds

Defined in `jest.config.js`:

- branches: 70%
- functions: 80%
- lines: 80%
- statements: 80%

## CI recommendation

Use this command in CI to avoid worker-level nondeterminism and to match local review behavior:

```bash
npm test -- --runInBand
```
