# Transport

## Overview

The plugin uses a coordinated owner model: one owner runtime handles transport and followers relay events.

Configured via `transport.mode`:

- `auto` (recommended)
- `owner`
- `follower`

## Owner Responsibilities

Only owner runtimes perform:

- WebSocket broadcast
- webhook queue + delivery
- event file logging
- hookBridge asynchronous rule dispatch

Follower runtimes still execute local synchronous hook logic (including Tool Guard decisions in `before_tool_call`) and relay canonical events to owner.

## Locking And Ownership

Lock file (`transport.lockPath`) contains:

- `runtimeId`
- `pid`
- `updatedAt`
- `socketPath`

Behavior:

- owner acquires lock via atomic create
- heartbeat updates lock timestamp
- stale lock takeover occurs when older than `lockStaleMs`
- owner shutdown removes lock only if runtime owns it

## Relay Path

Followers send events to owner via local socket (`transport.socketPath`):

- envelope contains `event` and optional `authToken`
- payload limited by `maxPayloadBytes`
- relay timeout controlled by `relayTimeoutMs`
- reconnect attempts back off by `reconnectBackoffMs`

If relay fails in `auto`, follower attempts promotion to owner.

## Deduplication

Owner deduplicates by:

1. `eventId` cache
2. semantic key derived from event identity + payload fields

Dedupe window = `dedupeTtlMs`.

This reduces duplicate emissions when role transitions or retries occur.

If you expect legitimate repeated same-payload events inside the dedupe window, set `semanticDedupeEnabled: false` and rely on `eventId` retry dedupe only.

## Follower Backpressure

Followers maintain pending relay queue:

- bounded by `maxPendingEvents`
- full queue policy: drop oldest pending event

## Platform Notes

- macOS/Linux: `socketPath` is Unix domain socket path
- Windows: resolved to named pipe path

## Recommended Defaults

For multi-runtime hosts:

- `mode: auto`
- set explicit `lockPath` and `socketPath` under private app dir
- set `authToken`
- leave `semanticDedupeEnabled: true` unless repeated same-payload events are expected
- keep `maxPayloadBytes` aligned with your largest expected event payload
