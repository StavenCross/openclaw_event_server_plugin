# API

This plugin emits canonical OpenClaw events and delivers them over:

- WebSocket broadcast (`ws://<bindAddress>:<port>/`)
- HTTP webhooks (direct or queue-backed)
- NDJSON event log (`eventLog.path`)

## Canonical Event Envelope

Every emitted event uses this envelope (`OpenClawEvent`):

- `eventId: string` unique ID
- `schemaVersion: string` (currently `1.1.0`)
- `type: EventType` canonical event type (see [events.md](./events.md))
- `eventCategory?: 'message' | 'tool' | 'command' | 'session' | 'agent' | 'gateway' | 'subagent' | 'synthetic'`
- `eventName?: string` original hook/event key
- `source?: 'internal-hook' | 'plugin-hook' | 'synthetic'`
- `timestamp: string` ISO timestamp
- `agentId?: string`
- `agentName?: string`
- `sessionId?: string`
- `sessionKey?: string`
- `sessionName?: string`
- `runId?: string`
- `toolCallId?: string`
- `correlationId?: string`
- `result?: unknown`
- `error?: { message: string; code?: string; stack?: string; kind?: 'tool' | 'agent' | 'gateway' | 'unknown' }`
- `pluginVersion: string` (currently `1.0.0`)
- `signature?: { version: 'v1'; algorithm: 'sha256' | 'sha512'; timestamp: number; nonce: string; value: string }`
- `data: Record<string, unknown>`
- `metadata?: Record<string, unknown>`

## WebSocket API

The server broadcasts all outbound canonical events to all connected clients.

- Startup config source: `security.ws.*` + WS port list
- Default bind: `127.0.0.1`
- Default port sequence: `9011,9012,9013,9014,9015,9016`
- Fallback behavior: if a port is in use, tries next configured port
- Welcome frame on connect:
  - `type: "welcome"`
  - `message: "Connected to OpenClaw Event Server broadcast"`
  - `timestamp: ISO string`
- Event broadcast payload = canonical event plus `broadcastAt`

If WS security is enabled:

- Token auth can be required (`security.ws.requireAuth` / `security.ws.authToken`)
- Origins and client IPs can be allowlisted (`security.ws.allowedOrigins`, `security.ws.allowedIps`)

## Webhook API

Each canonical event is POST/PUT/PATCHed to each configured webhook.

Request behavior:

- Header `Content-Type: application/json`
- Header `User-Agent: OpenClaw-Event-Plugin/1.0.0`
- Header `<correlationIdHeader>: <event.correlationId>` when present
- Header `Authorization: Bearer <authToken>` when configured
- Body:
  - full event envelope by default
  - minimal `{ type, timestamp }` when `includeFullPayload=false`

Validation and retry:

- URL must be valid HTTP/HTTPS
- Retries use exponential backoff
- 4xx responses are not retried except `429`
- Timeout controlled by `webhookTimeoutMs` or action-specific timeout

## Queue Behavior

When queue mode is active (`queue` + owner transport role):

- Events are enqueued and flushed periodically
- Batch flush size: 10 events
- Queue full policy: drop oldest
- Can persist queue to disk (`persistToDisk`, `persistPath`)

## Filtering

Webhook delivery filtering supports:

- `filters.includeTypes`
- `filters.excludeTypes`
- `filters.channelId`
- `filters.toolName`
- `filters.sessionId`

Filtering applies to HTTP webhooks. WebSocket broadcasts still get all emitted events.

## Environment Variables

Key runtime overrides:

- Core: `EVENT_PLUGIN_ENABLED`, `EVENT_PLUGIN_DEBUG`
- `EVENT_PLUGIN_TRANSPORT_MODE` accepts only `auto`, `owner`, or `follower`
- Webhooks: `EVENT_PLUGIN_WEBHOOKS`, `EVENT_PLUGIN_AUTH_TOKEN`
- Filters: `EVENT_PLUGIN_INCLUDE_TYPES`, `EVENT_PLUGIN_EXCLUDE_TYPES`
- Transport: `EVENT_PLUGIN_TRANSPORT_MODE`, `EVENT_PLUGIN_TRANSPORT_LOCK_PATH`, `EVENT_PLUGIN_TRANSPORT_SOCKET_PATH`, `EVENT_PLUGIN_TRANSPORT_LOCK_STALE_MS`, `EVENT_PLUGIN_TRANSPORT_HEARTBEAT_MS`, `EVENT_PLUGIN_TRANSPORT_RELAY_TIMEOUT_MS`, `EVENT_PLUGIN_TRANSPORT_RECONNECT_BACKOFF_MS`, `EVENT_PLUGIN_TRANSPORT_MAX_PENDING_EVENTS`, `EVENT_PLUGIN_TRANSPORT_MAX_PAYLOAD_BYTES`, `EVENT_PLUGIN_TRANSPORT_AUTH_TOKEN`, `EVENT_PLUGIN_TRANSPORT_DEDUPE_TTL_MS`, `EVENT_PLUGIN_TRANSPORT_SEMANTIC_DEDUPE_ENABLED`
- Status: `EVENT_PLUGIN_STATUS_WORKING_WINDOW_MS`, `EVENT_PLUGIN_STATUS_SLEEPING_WINDOW_MS`, `EVENT_PLUGIN_STATUS_TICK_INTERVAL_MS`, `EVENT_PLUGIN_STATUS_SUBAGENT_IDLE_WINDOW_MS`
- Redaction: `EVENT_PLUGIN_REDACTION_ENABLED`, `EVENT_PLUGIN_REDACTION_REPLACEMENT`, `EVENT_PLUGIN_REDACTION_FIELDS`
- Event log: `EVENT_PLUGIN_EVENT_LOG_ENABLED`, `EVENT_PLUGIN_EVENT_LOG_PATH`, `EVENT_PLUGIN_EVENT_LOG_MAX_FILE_MB`, `EVENT_PLUGIN_EVENT_LOG_FORMAT`, `EVENT_PLUGIN_EVENT_LOG_MIN_LEVEL`, `EVENT_PLUGIN_EVENT_LOG_RUNTIME`
- WS security: `EVENT_PLUGIN_WS_BIND_ADDRESS`, `EVENT_PLUGIN_WS_REQUIRE_AUTH`, `EVENT_PLUGIN_WS_AUTH_TOKEN`, `EVENT_PLUGIN_WS_ALLOWED_ORIGINS`, `EVENT_PLUGIN_WS_ALLOWED_IPS`, `EVENT_PLUGIN_WS_PORTS`, `EVENT_PLUGIN_DISABLE_WS`
- HMAC: `EVENT_PLUGIN_HMAC_ENABLED`, `EVENT_PLUGIN_HMAC_SECRET`, `EVENT_PLUGIN_HMAC_SECRET_FILE`, `EVENT_PLUGIN_HMAC_ALGORITHM`
- Diagnostics: `EVENT_PLUGIN_TOOL_GUARD_TRACE`, `EVENT_PLUGIN_DISABLE_STATUS_TICKER`
- Runtime detection override (for tests and nonstandard launch wrappers): `EVENT_PLUGIN_RUNTIME_KIND_OVERRIDE=gateway|agent|unknown`

If `transport.mode=auto` and the gateway process does not expose a recognizable OpenClaw gateway title/argv, set `EVENT_PLUGIN_RUNTIME_KIND_OVERRIDE=gateway`. Otherwise the plugin deliberately resolves to follower mode instead of letting an unknown runtime self-promote into the public transport hub.
