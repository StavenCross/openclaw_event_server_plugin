# Hook Bridge

Hook Bridge is an event-to-action automation layer. It listens to canonical events and executes configured actions when rules match.

It has two engines:

- async event bridge (`hookBridge.rules`): reacts to emitted events
- sync Tool Guard (`hookBridge.toolGuard`): pre-tool enforcement in `before_tool_call`

This document covers the async event bridge. Tool Guard details are in [Tool_guard.md](./Tool_guard.md).

## How It Works

1. Event is emitted into runtime pipeline.
2. Hook Bridge evaluates enabled rules in order.
3. Matching rule triggers action if cooldown allows.
4. Action executes as webhook or local script.
5. Runtime records telemetry/backpressure and continues.

## Rule Model

Each rule includes:

- `id`
- `enabled` (optional)
- `when` matcher
- `action` action ID
- `cooldownMs` (optional)
- `coalesce` (optional)

Matcher (`when`) supports:

- identity: `eventType`, `toolName`, `agentId`, `sessionId`, `sessionKey`
- content checks: `contains`, `equals`, `requiredPaths`
- type/value checks: `typeChecks`, `inList`, `notInList`
- regex checks: `matchesRegex`, `notMatchesRegex`
- URL domain checks: `domainAllowlist`, `domainBlocklist`, `domainPath`
- subagent status checks: `idleForMsGte`, `parentStatus`

## Actions

### Webhook Action

Required:

- `type: webhook`
- `url`

Optional:

- `method`
- `headers`
- `authToken`
- `timeoutMs`

Payload sent:

```json
{
  "ruleId": "<rule-id>",
  "event": { "...": "canonical event" }
}
```

### Local Script Action

Required:

- `type: local_script`
- `path` (absolute)

Optional:

- `args`
- `timeoutMs`
- `maxPayloadBytes`

Script receives JSON on stdin:

```json
{
  "ruleId": "<rule-id>",
  "event": { "...": "canonical event" }
}
```

## Creating Hooks For Events

To create event hooks with Hook Bridge:

1. Create actions (`webhook` and/or `local_script`).
2. Add rule with precise `when` criteria.
3. Add `cooldownMs` for noisy event types.
4. Enable `dryRun=true` first.
5. Observe logs and refine matchers.
6. Disable dry-run when signal quality is good.

## Webhook Best Practices

- Keep endpoints idempotent by using `eventId`.
- Validate event `schemaVersion` and `type` at ingress.
- Apply authentication and signature verification if needed.
- Respond quickly and offload expensive work to your own queue.

## Script Best Practices

- Keep script paths in dedicated secured `allowedActionDirs`.
- Parse stdin safely and handle invalid payloads.
- Return non-zero exit on failure so plugin logs action failure.
- Set explicit `timeoutMs` and `maxPayloadBytes` per action for high-volume flows.

## Example Rule

```json
{
  "id": "notify-sudo-exec",
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
```

For tool provenance-aware rules, prefer matching on
`data.provenance.routeResolution == "resolved"` plus specific
`data.provenance.threadId` or `data.provenance.conversationId` values when
thread ownership matters. Do not key actions only on `agentId` or shared
runtime aliases such as `agent:<agentId>:main`, because the plugin
intentionally treats those as ambiguous when multiple active sessions share
them.

## Operational Controls

- `enabled`: global bridge switch
- `dryRun`: match and log without executing actions
- `runtime.maxPendingEvents`: bridge queue bound
- `runtime.concurrency`: number of action workers
- `runtime.dropPolicy`: `drop_oldest` or `drop_newest`
- `telemetry.*`: high-watermark, latency, failure-rate thresholds
