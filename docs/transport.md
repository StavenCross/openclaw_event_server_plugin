# Transport

## Overview

The plugin uses a coordinated owner model: one owner runtime handles transport and followers relay events.

Configured via `transport.mode`:

- `auto` (recommended, gateway runtime becomes owner)
- `owner`
- `follower`

`auto` is safe-by-default:

- gateway runtimes resolve to `owner`
- agent and unknown runtimes resolve to `follower`
- unknown is intentionally not allowed to self-promote

If your gateway is launched through a wrapper or supervisor that changes the process title/argv, set `EVENT_PLUGIN_RUNTIME_KIND_OVERRIDE=gateway` explicitly. Do the same for wrapped agent runtimes with `EVENT_PLUGIN_RUNTIME_KIND_OVERRIDE=agent`.

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
- a fresh gateway owner can replace a stale lock when older than `lockStaleMs`
- a lock whose recorded owner PID is already dead is reclaimed immediately,
  even if the heartbeat timestamp is still fresh
- owner shutdown removes lock only if runtime owns it
- owner-intended runtimes (`owner` mode, plus gateway runtimes after `auto` resolution)
  retry lock acquisition and relay socket startup after transient owner failures, so a
  bad socket path no longer requires a full gateway restart to recover

## Relay Path

Followers send events to owner via local socket (`transport.socketPath`):

- envelope contains `event` and optional `authToken`
- payload limited by `maxPayloadBytes`
- relay timeout controlled by `relayTimeoutMs`
- reconnect attempts back off by `reconnectBackoffMs`
- if the owner relay socket dies and the owner runtime is still intended to own
  transport, the owner retries in the background while followers keep their pending
  relay queue and retry delivery

Useful runtime log signatures to monitor:

- `Demoting owner runtime to follower; follower relays may temporarily report ECONNREFUSED until recovery succeeds`
- `Scheduling owner transport recovery attempt`
- `Attempting owner transport recovery`
- `Failed to relay event to owner; event remains queued while transport recovery is pending`
- `Existing owner lock belongs to a dead PID; reclaiming transport lock immediately`
- `Transport lock is still owned by a live runtime; owner takeover skipped`
- `Owner relay server is listening`

Those log entries now include structured context such as:

- `runtimeId`
- `transportMode`
- `role`
- `socketPath`
- `lockPath`
- `pendingEvents`
- `reason`
- `error` when available

In `auto`, non-gateway runtimes stay followers permanently. They do not promote themselves to owner later.

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

This gives you a simple mental model:

- gateway = public event hub
- all other runtimes = local event producers that relay into the gateway
