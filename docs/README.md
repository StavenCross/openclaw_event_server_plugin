# Documentation

This folder is the implementation-aligned documentation for `openclaw-event-server-plugin`.

## Docs Map

- [API](./api.md): event envelope, delivery channels, webhook behavior, queue behavior, and additive tool provenance metadata.
- [Events](./events.md): exhaustive list of emitted event types, field structures, and provenance field semantics.
- [Transport](./transport.md): single-owner transport mode, lock/relay flow, deduplication.
- [Socket Layer](./socket-layer.md): WebSocket server behavior and local relay socket protocol.
- [Security](./security.md): WS auth controls, origin/IP filters, HMAC signing, redaction.
- [Hook Bridge](./hookbridge.md): asynchronous event-to-action automation bridge.
- [Tool Guard](./Tool_guard.md): synchronous pre-tool policy/approval controls and best practices.
- [HookBridge + ToolGuard Actions](./hookbridge-toolguard-actions.md): detailed script/webhook invocation patterns with example bundle walkthroughs.
- [Backend](./backend.md): code structure, runtime lifecycle, processing pipeline.
- [UI](./ui.md): recommended dashboard/consumer patterns for this plugin.
- [Testing](./testing.md): test strategy, suite coverage map, and CI/local commands.
- [Release](./release.md): local release flow, shared verification, and tag publish guidance.

## Source Of Truth

These docs were derived from the TypeScript implementation in `src/` and current tests in `tests/`. If behavior changes, update docs in this folder in the same PR.

Release history and ship notes live in the root [CHANGELOG.md](../CHANGELOG.md).
