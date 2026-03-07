# Hook Bridge + Tool Guard Actions

This guide explains exactly how to make Hook Bridge and Tool Guard call your scripts or webhooks, using the bundled examples as templates.

Related docs:

- [Hook Bridge](./hookbridge.md)
- [Tool Guard](./Tool_guard.md)
- [Events](./events.md)

Example bundle folder:

- [examples/tool-guard-bundles/README.md](/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/examples/tool-guard-bundles/README.md)

## Mental Model

- Hook Bridge (`hookBridge.rules`) is asynchronous event automation.
  - Event emitted -> rule matches -> action executes.
  - Good for notifications, workflows, downstream jobs.

- Tool Guard (`hookBridge.toolGuard.rules`) is synchronous pre-tool policy.
  - Before tool call -> rule matches -> decision (allow/block/patch params).
  - Good for approvals, safety policy, hard blocks.

Both can call:

- `local_script`
- `webhook`

## Action Types

## `local_script`

Configuration:

```json
{
  "type": "local_script",
  "path": "/absolute/path/to/script.sh",
  "args": [],
  "timeoutMs": 10000,
  "maxPayloadBytes": 65536
}
```

Requirements:

- `path` must be absolute
- `path` must be inside `hookBridge.allowedActionDirs`
- script should be executable (`chmod +x`)

Input payload on stdin:

```json
{
  "ruleId": "rule-id",
  "event": { "...": "canonical event envelope" }
}
```

Tool Guard response contract (stdout):

- empty output: no decision
- JSON decision object:
  - `{"block": true, "blockReason": "..."}`
  - `{"block": false}`
  - `{"params": {"key":"value"}}`

## `webhook`

Configuration:

```json
{
  "type": "webhook",
  "url": "https://example.com/endpoint",
  "method": "POST",
  "headers": { "x-env": "prod" },
  "authToken": "...",
  "timeoutMs": 5000
}
```

Request body:

```json
{
  "ruleId": "rule-id",
  "event": { "...": "canonical event envelope" }
}
```

Tool Guard webhook response body can return the same decision object as scripts.

## Existing Example Patterns

## 1) Notify and allow (`exec sudo`)

Files:

- [sudo-slack-approval-allow.annotated.jsonc](/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/examples/tool-guard-bundles/sudo-slack-approval-allow.annotated.jsonc)
- [sudo-slack-approval-and-allow.sh](/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/examples/tool-guard-bundles/scripts/sudo-slack-approval-and-allow.sh)

Behavior:

- Tool Guard matches `exec` + `sudo`.
- Calls local script.
- Script posts Slack notification.
- Script returns `{"block":false}` (fail-open awareness flow).

Use when:

- you want visibility but not hard gating.

## 2) Strict human approval for web tools

Files:

- [web-browse-human-approval.annotated.jsonc](/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/examples/tool-guard-bundles/web-browse-human-approval.annotated.jsonc)
- [web-browse-slack-human-approval.sh](/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/examples/tool-guard-bundles/scripts/web-browse-slack-human-approval.sh)
- [toolguard-approval-profiles.example.annotated.jsonc](/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/examples/tool-guard-bundles/toolguard-approval-profiles.example.annotated.jsonc)

Behavior:

- Rules match `web_search`, `web_fetch`, `browser`.
- Script posts approval request to Slack.
- Script polls thread replies/reactions.
- Returns allow or block decision.
- Example uses `onError: "block"` (fail-closed).

Use when:

- real human approval is required before tool execution.

## 3) Static policy (no actions)

Files:

- [shell-guard.annotated.jsonc](/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/examples/tool-guard-bundles/shell-guard.annotated.jsonc)
- [network-egress.annotated.jsonc](/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/examples/tool-guard-bundles/network-egress.annotated.jsonc)

Shows how to use inline `decision` rules when you do not need scripts/webhooks.

## 4) Replay harness

File:

- [run-live-web-browse-approval-replay.sh](/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/examples/tool-guard-bundles/scripts/run-live-web-browse-approval-replay.sh)

Use this to test end-to-end behavior before production rollout.

## Build Your Own Script

1. Add safe directories:

```json
{
  "hookBridge": {
    "allowedActionDirs": ["/absolute/path/to/hooks"]
  }
}
```

2. Create script action:

```json
{
  "actions": {
    "my-script-action": {
      "type": "local_script",
      "path": "/absolute/path/to/hooks/my-handler.sh",
      "timeoutMs": 15000,
      "maxPayloadBytes": 65536
    }
  }
}
```

3. Add rule that points to action (Hook Bridge or Tool Guard rule).

4. Parse stdin JSON and return decision JSON when used by Tool Guard.

Script skeleton:

```sh
#!/bin/sh
set -eu
payload="$(cat)"
# parse with jq, run side effects
printf '{"block":false}\n'
```

## Build Your Own Webhook

1. Register webhook action URL.
2. Rule-match only needed events/tools.
3. Handle `{ruleId,event}` payload in your service.
4. For Tool Guard, respond with decision JSON.

Service pseudocode:

```ts
app.post('/tool-approval', (req, res) => {
  const { ruleId, event } = req.body;
  // evaluate policy/human approval state
  res.json({ block: false });
});
```

## Best Practices For Users And Agent Bots

- Start with `dryRun=true` and inspect `tool.guard.matched`.
- Use precise `when` matchers to avoid noisy triggers.
- Prefer idempotent handlers keyed by `event.eventId` / `toolCallId`.
- Keep action timeouts below hook timeout budgets.
- For high-risk tools, set `toolGuard.onError="block"`.
- Keep secrets in env vars; do not hardcode in committed configs.
- Restrict approvers explicitly (as shown by approval profile examples).

## Common Failure Modes

- Script path not absolute or outside `allowedActionDirs`.
- Script not executable.
- Payload exceeds `maxPayloadBytes`.
- Tool Guard timeout shorter than action runtime.
- Webhook returns non-2xx / non-JSON where decision expected.

## Minimal Combined Example

```json
{
  "hookBridge": {
    "enabled": true,
    "allowedActionDirs": ["/absolute/path/to/hooks"],
    "actions": {
      "notify": {
        "type": "webhook",
        "url": "https://example.com/events"
      },
      "approve": {
        "type": "local_script",
        "path": "/absolute/path/to/hooks/approve.sh",
        "timeoutMs": 120000
      }
    },
    "rules": [
      {
        "id": "notify-tool-errors",
        "when": { "eventType": "tool.error" },
        "action": "notify"
      }
    ],
    "toolGuard": {
      "enabled": true,
      "onError": "block",
      "rules": [
        {
          "id": "approve-browser",
          "when": { "toolName": "browser" },
          "action": "approve"
        }
      ]
    }
  }
}
```
