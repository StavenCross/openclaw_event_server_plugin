# OpenClaw Event Server Plugin

Most teams using OpenClaw hit the same wall: important agent activity is hard to operationalize because it lives in logs, scattered channels, or manual checks. This plugin solves that by turning agent behavior into clean, real-time events (WebSocket or webhook) that your automations can consume immediately, plus configurable Tool Guard controls to block risky tool calls and require human approval when needed. In practice, you install it, point events to your systems, and define guard rules.

Use cases:
- Send Slack alerts when tool calls fail or agents error.
- Feed `agent.status` and `agent.activity` into dashboards for live visibility.
- Trigger downstream jobs from session lifecycle events (`session.start`, `session.end`).
- Require human approval for risky tools (`web_search`, `web_fetch`, `browser`, `exec` with `sudo`).
- Write normalized events to long-term storage for audit, compliance, or analytics.
- Wake a sleeping parent agent when their sub agent stalls, finishes or times out
- Cost guardrails: monitor high-frequency tool loops and block when token/tool usage crosses per-session budgets.
- Knowledge capture: when a run succeeds after multiple failures, auto-log the successful tool sequence to docs/wiki.
- subsequent agent setup. Bot A finishes a writing a youtube script and goes idle, event server triggers an alert to Bot B to review script and make adjustments, OR if bot A fails or stalls, retries Bot A.


User senarios:
- Live content studio control room: a creator runs multiple agents for research, scripting, clipping, and posting. Event Server becomes the “producer dashboard” that shows who is working, who is stuck, and when a draft is ready. Tool Guard adds a human checkpoint before anything publishes or sends outreach.
- Founder daily ops autopilot: a small business owner uses agents for inbox triage, lead follow-up, and report generation. Event streams turn this into a visible operations timeline, so they can see bottlenecks and response speed. Tool Guard keeps high-risk actions (sending, spending, exporting) human-approved.
- Streamer has an openclaw agent monitoring his chat and uses it to manage interactivity in his live stream, Event server is feeding status updates and if the agent dies, stalls or goes inactive, calls a script to spawn a new agent with little to no downtime. 
- Creative memory engine: every finished run emits structured “what worked” events into a reusable idea bank. Over time, creators build a searchable playbook of winning hooks, formats, and campaign patterns.


How does it actually work?
Openclaw Event Server Plugin is built around 3 things:
1. Event server; This simply finds all the various events throughout openclaw and presents them in an easy to consume format.
2. Hook Bridge; execute a script file or webhook when an event is captured
3. Tool Guard; Openclaw ships with exec approval by default, but it does not have anything for other tools, this plugin fills that gap and allows users to create approval workflows or block possibly dangerous tool calls



It emits:
- Raw internal hook events (`message:*`, `command:*`, `agent:*`, `gateway:startup`)
- Raw plugin hook events (`before_tool_call`, `after_tool_call`, `tool_result_persist`, session/subagent/gateway typed hooks)
- Synthetic events (`agent.activity`, `agent.status`, `agent.sub_agent_spawn`)

## Transport

- WebSocket broadcast server (default ports: `9011,9012,9013,9014,9015,9016`)
- HTTP webhooks with retry/queue support

## Event Model

All emitted events use one canonical envelope so consumers can parse every event type consistently.

All emitted events use a canonical envelope:

- `eventId`
- `schemaVersion`
- `timestamp`
- `type`
- `eventCategory`
- `eventName`
- `source`
- `agentId`, `sessionId`, `sessionKey`, `runId`, `toolCallId` (when available)
- `correlationId`
- `result`/`error` (when relevant)
- `data`
- `metadata`

### Supported event types

Synthetic event types are computed by this plugin and are not native upstream gateway events.

- Message: `message.received`, `message.transcribed`, `message.preprocessed`, `message.sent`
- Tool: `tool.called`, `tool.guard.matched`, `tool.guard.allowed`, `tool.guard.blocked`, `tool.completed`, `tool.error`, `tool.result_persist`
- Command: `command.new`, `command.reset`, `command.stop`
- Session: `session.start`, `session.end`
- Subagent: `subagent.spawning`, `subagent.spawned`, `subagent.ended`
- Subagent synthetic: `subagent.idle`
- Agent: `agent.bootstrap`, `agent.error`, `agent.session_start`, `agent.session_end`
- Gateway: `gateway.startup`, `gateway.start`, `gateway.stop`
- Synthetic: `agent.activity`, `agent.status`, `agent.sub_agent_spawn`
- Legacy aliases preserved for compatibility: `session.spawned`, `session.completed`, `session.error`

## Install

Choose one install path:

1. Install from npm (recommended for most users; no local build needed):

```bash
openclaw plugins install @openclaw/event-server-plugin
```

2. Install from local source (for contributors/dev):

```bash
npm install
npm run build
openclaw plugins install -l /absolute/path/to/openclaw_event_server_plugin
```

When installing from local source, `dist/` must be built before installation.

## Compatibility

Compatibility is pinned to a known OpenClaw hook surface and enforced by contract tests.

- Pinned hook-surface fixture: OpenClaw commit `7b5e64ef2e369258e2a4a613b7a62db3c21e5160`.
- Compatibility is enforced by fixture-driven contract tests (`tests/contract/openclaw-hook-surface.test.ts`).
- Additional versions can be documented by adding new hook-surface fixtures when validated.

## Configure

Use this as the primary runtime config for transport, retries, logging, security, filtering, redaction, status timing, and automation behavior.

In `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "event-server-plugin": {
        "enabled": true,
        "config": {
          "webhooks": [
            {
              "url": "https://example.com/events",
              "method": "POST"
            }
          ],
          "queue": {
            "maxSize": 1000,
            "flushIntervalMs": 5000,
            "persistToDisk": false
          },
          "status": {
            "workingWindowMs": 30000,
            "sleepingWindowMs": 600000,
            "tickIntervalMs": 5000,
            "subagentIdleWindowMs": 300000
          },
          "redaction": {
            "enabled": false,
            "replacement": "[REDACTED]",
            "fields": ["content", "params", "token", "authorization"]
          },
          "eventLog": {
            "enabled": true,
            "path": ".event-server/events.ndjson",
            "maxFileSizeMb": 30,
            "format": "full-json",
            "minLevel": "debug",
            "includeRuntimeLogs": true
          },
          "security": {
            "ws": {
              "bindAddress": "127.0.0.1",
              "requireAuth": false,
              "authToken": "",
              "allowedOrigins": [],
              "allowedIps": []
            },
            "hmac": {
              "enabled": false,
              "secretFilePath": ".event-plugin-hmac.secret",
              "algorithm": "sha256"
            }
          },
          "retry": {
            "maxAttempts": 3,
            "initialDelayMs": 1000,
            "maxDelayMs": 30000,
            "backoffMultiplier": 2
          },
          "filters": {
            "includeTypes": [],
            "excludeTypes": []
          },
          "hookBridge": {
            "enabled": false,
            "dryRun": false,
            "allowedActionDirs": ["/absolute/path/to/hooks"],
            "localScriptDefaults": {
              "timeoutMs": 10000,
              "maxPayloadBytes": 65536
            },
            "actions": {
              "sudo-alert": {
                "type": "webhook",
                "url": "https://example.com/hook/sudo-alert",
                "method": "POST"
              },
              "wake-parent": {
                "type": "local_script",
                "path": "/absolute/path/to/hooks/wake-parent.sh",
                "args": []
              }
            },
            "rules": [
              {
                "id": "notify-sudo",
                "when": {
                  "eventType": "tool.called",
                  "toolName": "exec",
                  "contains": {
                    "data.params.command": "sudo"
                  }
                },
                "action": "sudo-alert",
                "cooldownMs": 60000
              }
            ],
            "toolGuard": {
              "enabled": false,
              "dryRun": false,
              "timeoutMs": 15000,
              "onError": "allow",
              "rules": [
                {
                  "id": "approve-exec",
                  "when": {
                    "toolName": "exec"
                  },
                  "action": "wake-parent"
                }
              ]
            }
          }
        }
      }
    }
  }
}
```

## Environment Variables

Use environment variables for quick overrides in containers, CI, and one-off debugging.

- `EVENT_PLUGIN_WEBHOOKS` comma-separated webhook URLs
- `EVENT_PLUGIN_AUTH_TOKEN` bearer token applied to env-defined webhooks
- `EVENT_PLUGIN_DEBUG` enable debug logging
- `EVENT_PLUGIN_INCLUDE_TYPES` comma-separated include filters
- `EVENT_PLUGIN_EXCLUDE_TYPES` comma-separated exclude filters
- `EVENT_PLUGIN_ENABLED` enable/disable plugin
- `EVENT_PLUGIN_WS_PORTS` comma-separated WS fallback order
- `EVENT_PLUGIN_DISABLE_WS` disable WS server
- `EVENT_PLUGIN_DISABLE_STATUS_TICKER` disable periodic synthetic status ticks (tests/CI)
- `EVENT_PLUGIN_TOOL_GUARD_TRACE` set `1`/`true` to emit verbose Tool Guard evaluation/action traces
- `EVENT_PLUGIN_STATUS_WORKING_WINDOW_MS` override working activity window
- `EVENT_PLUGIN_STATUS_SLEEPING_WINDOW_MS` override sleeping window
- `EVENT_PLUGIN_STATUS_TICK_INTERVAL_MS` override status ticker interval
- `EVENT_PLUGIN_STATUS_SUBAGENT_IDLE_WINDOW_MS` override `subagent.idle` threshold
- `EVENT_PLUGIN_REDACTION_ENABLED` enable payload redaction (default `false`)
- `EVENT_PLUGIN_REDACTION_REPLACEMENT` replacement text for redacted values
- `EVENT_PLUGIN_REDACTION_FIELDS` comma-separated key names to redact recursively
- `EVENT_PLUGIN_EVENT_LOG_ENABLED` enable/disable NDJSON file logging
- `EVENT_PLUGIN_EVENT_LOG_PATH` override log file path
- `EVENT_PLUGIN_EVENT_LOG_MAX_FILE_MB` max NDJSON log size in MB before truncation rollover (default `30`)
- `EVENT_PLUGIN_EVENT_LOG_FORMAT` `full-json` or `summary`
- `EVENT_PLUGIN_EVENT_LOG_MIN_LEVEL` `debug|info|warn|error` for runtime log records
- `EVENT_PLUGIN_EVENT_LOG_RUNTIME` include runtime log entries in file output
- `EVENT_PLUGIN_WS_BIND_ADDRESS` WS bind address (default `127.0.0.1`)
- `EVENT_PLUGIN_WS_REQUIRE_AUTH` require WS token auth
- `EVENT_PLUGIN_WS_AUTH_TOKEN` shared WS token
- `EVENT_PLUGIN_WS_ALLOWED_ORIGINS` comma-separated allowlist for WS `Origin` header
- `EVENT_PLUGIN_WS_ALLOWED_IPS` comma-separated WS client IP allowlist
- `EVENT_PLUGIN_HMAC_ENABLED` enable event HMAC signing
- `EVENT_PLUGIN_HMAC_SECRET` inline shared HMAC secret
- `EVENT_PLUGIN_HMAC_SECRET_FILE` file path for shared HMAC secret
- `EVENT_PLUGIN_HMAC_ALGORITHM` `sha256` or `sha512`

## Agent Status Semantics

`agent.status` is derived across all known sessions for each agent.

Example: if a parent agent starts a session and then appears quiet, status can still be `working` while a subagent is actively processing.

- `working`: activity in last `status.workingWindowMs` (default 30s)
- `idle`: no activity for > `status.workingWindowMs` and <= `status.sleepingWindowMs`
- `sleeping`: no activity for > `status.sleepingWindowMs` (default 10m)
- `offline`: marked offline (for example gateway stop/offline agent error classification)
- `error`: agent-level error latch

`tool.error` does not automatically force `agent.status=error`.

## Redaction

Payload redaction is opt-in and disabled by default. When enabled, the plugin redacts configured key names recursively across `data`, `metadata`, and nested payload objects before broadcasting to WebSocket and HTTP webhooks.

## Subagent Tracking

Subagent lifecycle and workload can be tracked independently:

- `subagent.spawned` carries parent + child identity fields.
- Tool events include `subagentKey`, `parentAgentId`, `parentSessionKey` when tool calls are associated with a child session.
- `subagent.idle` is emitted when a spawned child session has no observed activity for `status.subagentIdleWindowMs`.
- `agent.activity` for `subagent.idle` is emitted only when parent/child `agentId` is known; the plugin does not emit synthetic `"unknown"` agent identities.

This enables Mission Control tree views (parent agent with per-subagent status/tool lanes) while preserving top-level `agent.status` aggregation.

## Event Logging

`eventLog` writes NDJSON to disk from inside the plugin runtime.

- `format=full-json` (default): complete canonical event envelope in each line.
- `format=summary`: reduced envelope fields for lower volume.
- runtime records can be included and filtered by `minLevel`.
- `maxFileSizeMb=30` (default): logger truncates and continues once the file reaches the size cap.

Default path is `.event-server/events.ndjson`.

Relative `eventLog.path` values are resolved at runtime in this order:
- `OPENCLAW_STATE_DIR` (if set)
- directory containing `OPENCLAW_CONFIG_PATH` (if set)
- `~/.openclaw/`

This keeps default config portable while avoiding service working-directory issues.

## Security

Recommended defaults for community deployments:

- WS binds to localhost (`127.0.0.1`) by default.
- WS auth can be enabled with a shared token.
- Optional origin/IP allowlists for WS clients.
- Optional HMAC event signing (`hmac.enabled=false` by default).
- Native TLS/WSS termination is not provided by this plugin; run it behind a reverse proxy
  (for example Nginx/Caddy/Traefik) for production HTTPS/WSS.

For local setups, keep the shared HMAC secret in `.event-plugin-hmac.secret`. Set `security.hmac.enabled=true` (or `EVENT_PLUGIN_HMAC_ENABLED=true`) to enable event signing.

## Hook Bridge Automation

`hookBridge` enables event-driven automations directly from canonical plugin events. It can execute a local script or call a webhook when a matching event occurs.

- Match rules by `eventType`, identity fields, nested field checks, idle thresholds, and parent status.
- Dispatch actions as:
  - `webhook` (`POST|PUT|PATCH` with JSON payload)
  - `local_script` (fixed script path + args, event payload over stdin)
- Suppress repeated triggers with per-rule `cooldownMs`.

Local script actions are restricted to `allowedActionDirs` and run with `shell=false`.
Default runtime limits for local scripts are configured in `localScriptDefaults`.

### Tool Guard (Optional human in the middle)

`hookBridge.toolGuard` adds synchronous `before_tool_call` policy checks using the same `actions` registry.
By default it is disabled and does not affect tool execution.

- `enabled=false` (default): no blocking behavior.
- `rules`: ordered checks for tool-call context:
  - `toolName`, `contains`, `equals`, `matchesRegex`, `notMatchesRegex`
  - `requiredPaths`, `typeChecks`, `inList`, `notInList`
  - `domainAllowlist` / `domainBlocklist` (optional `domainPath`, default `data.params.url`)
  - agent/session fields
- `onError`:
  - `allow` (default) fail-open on script/webhook error or timeout
  - `block` fail-closed
- `dryRun=true`: evaluates/logs decisions but never blocks.
- `priority`: higher-priority rules evaluate first (ties keep config order).
- `stopOnMatch`: stop evaluating additional rules when a rule matches but returns no decision
  (rules that return a decision already short-circuit).
- `retryBackoffMs`: force backoff when a blocked call is retried repeatedly.
- `approvalCacheTtlMs`: cache allow decisions for repeat calls.
- `scopeKeyBy`: `tool` or `tool_and_params` for retry/cache keys.
- `redaction` (default off): optional redaction for `tool.guard.*` event `data.params`.
- Each rule can either:
  - call an `action` (webhook/local script), or
  - use an inline static `decision` for simple validation/guidance.

Guard action response contract (webhook response body or local script stdout):

```json
{ "block": true, "blockReason": "Manual approval required" }
```

or

```json
{ "params": { "mode": "safe" } }
```

Invalid decision payloads are ignored. A valid decision must include either:
- `block` as a boolean, or
- `params` as an object.

For true blocking behavior (recommended for approvals):
- Set `hookBridge.toolGuard.onError` to `block` (fail-closed).
- Use a decision script that defaults to block on timeout/error.
- Require explicit human approvers (`OPENCLAW_APPROVAL_ALLOWED_USER_IDS` or profile `allowedUserIds`) so bot reactions/replies cannot auto-approve.

Example invalid payload (ignored):

```json
{ "blockReason": "manual approval required" }
```

Templated guidance is supported in `blockReasonTemplate` (or `blockReason`):
- `{{toolName}}`, `{{eventType}}`, `{{agentId}}`, `{{sessionId}}`, `{{sessionKey}}`, `{{runId}}`, `{{toolCallId}}`
- `{{path:data.params.url}}` for dotted-path lookups

Example malformed-call filter without scripting:

```json
{
  "id": "web-fetch-url-must-be-https",
  "priority": 100,
  "when": {
    "toolName": "web_fetch",
    "notMatchesRegex": {
      "data.params.url": "^https://"
    }
  },
  "decision": {
    "block": true,
    "blockReasonTemplate": "Malformed {{toolName}} URL: {{path:data.params.url}}. Use: {{toolName}} \"https://...\""
  }
}
```

### Tool Guard Replay

You can replay captured tool calls against `toolGuard` policies before rollout:

From a local source checkout:

```bash
npm run build
jq '.plugins.entries["event-server-plugin"].config' ~/.openclaw/openclaw.json > /tmp/event-plugin-config.json
npm run toolguard:replay -- --config /tmp/event-plugin-config.json --input ./calls.ndjson
```

Input format supports:
- JSON array of tool call objects
- NDJSON (one tool call object per line)

Each call object fields:
- `toolName` (required)
- `params` (object)
- optional `agentId`, `sessionId`, `sessionKey`, `runId`, `toolCallId`

### Tool Guard Bundles

Starter bundles are included under `examples/tool-guard-bundles/`:
- `network-egress.json`
- `shell-guard.json`
- `sudo-slack-approval-allow.json` (sends Slack approval requests for `sudo` calls, then allows execution)
- `web-browse-human-approval.json` (requires explicit human approval for `web_search`, `web_fetch`, and `browser`; posts a Slack approval request and waits for approve/reject reply or reaction)
- annotated versions for bot/user guidance are also included as `*.annotated.jsonc`

Example local scripts for `local_script` actions are under `examples/tool-guard-bundles/scripts/`:
- `sudo-slack-approval-and-allow.sh`
- `web-browse-slack-human-approval.sh` (interactive Slack approvals via replies/reactions; requires longer `toolGuard.timeoutMs`)
  - script is fail-closed by default (`OPENCLAW_APPROVAL_REQUIRE_ALLOWED_USERS=true`)
  - rejects approvals from bot users
  - supports `web_search`, `web_fetch`, `browser` (or any tool when used in a matching rule)

Optional approval channel profiles example:
- `toolguard-approval-profiles.example.json` (copy to `~/.openclaw/toolguard-approval-profiles.json` and edit)
  - include `allowedUserIds` to restrict who can approve/reject

## Development

```bash
npm run lint
npm run build
npm test -- --runInBand
```

## Notes

- The plugin is intentionally "dumb" for event forwarding: payload transformation is minimal.
- Downstream consumers should own filtering/aggregation beyond canonical normalization.
