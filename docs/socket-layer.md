# Socket Layer

This project has two socket layers:

- external WebSocket broadcast server (`src/broadcast/websocketServer.ts`)
- internal owner-relay socket protocol (`src/transport/*`)

## External WebSocket Broadcast

Purpose:

- push emitted canonical events to connected clients in real time

Behavior:

- binds to configured host + first available configured port
- falls back across port list on `EADDRINUSE`
- accepts multiple clients
- broadcasts each event to all connected open clients
- appends `broadcastAt` timestamp to sent payload

Connection flow:

1. Client connects
2. Request authorization checks run (token/origin/ip if configured)
3. Server sends welcome frame
4. Client receives ongoing event stream

## Internal Relay Socket

Purpose:

- followers relay canonical events to the single owner runtime

Protocol:

- transport: local `net` socket
- payload: single-line JSON envelope (`{ authToken?, event }\n`)
- response: single-line JSON ack (`{ ok: true }` or `{ ok: false, error }`)

Validation on owner ingest:

- payload size limit (`maxPayloadBytes`)
- auth token match (if configured)
- minimal event-shape validation

Failure behavior:

- follower relay error causes retry/backoff
- in `auto` mode follower may promote itself to owner when owner appears unavailable

## Tuning Knobs

- `transport.maxPayloadBytes`
- `transport.relayTimeoutMs`
- `transport.reconnectBackoffMs`
- `transport.maxPendingEvents`
- `transport.authToken`
- `transport.semanticDedupeEnabled`

## Debugging Tips

- enable plugin debug logs (`EVENT_PLUGIN_DEBUG=true`)
- verify owner role transitions in runtime logs
- inspect event metadata `transport.*` fields for route/role tracing
