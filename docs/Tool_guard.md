# Tool Guard

Tool Guard is a synchronous policy layer executed during `before_tool_call`. It can block, allow, or patch tool params before execution.

This is implemented through `hookBridge.toolGuard` and evaluated in `register-tool-hooks.ts`.

It does not run for `before_model_resolve`, `before_prompt_build`, `llm_input`,
`llm_output`, `agent_end`, `before_compaction`, or `after_compaction`. Those
hooks still flow into Hook Bridge as normal canonical events, but they are
observability/automation signals rather than synchronous tool-execution
decision points.

This is an intentional scope boundary, not a missing implementation. If policy
enforcement is ever needed for prompt/model hooks, that should ship as a new
non-tool guard subsystem instead of overloading `toolGuard`.

## Execution Model

For each tool call:

1. Plugin builds a synthetic guard context event (`type=tool.called`, `eventName=before_tool_call`).
2. Guard state applies retry-backoff and approval cache checks.
3. Enabled rules are sorted by `priority` (desc) then declaration order.
4. On match, rule can:
   - return static `decision`
   - execute action (`webhook` or `local_script`) and parse returned decision JSON
   - short-circuit with `stopOnMatch`
5. Outcome is emitted as guard events:
   - `tool.guard.matched`
   - `tool.guard.allowed`
   - `tool.guard.blocked`

## Decision Model

Decision object supports:

- `block?: boolean`
- `blockReason?: string`
- `blockReasonTemplate?: string`
- `params?: Record<string, unknown>`

Behavior:

- `block=true`: tool call is blocked and params are null-patched for fail-closed defense.
- `params` set: tool call allowed with merged param patch.
- no decision: next rule may evaluate unless short-circuited.

## Template Tokens

`blockReasonTemplate` can interpolate:

- `{{toolName}}`, `{{eventType}}`, `{{agentId}}`, `{{sessionId}}`, `{{sessionKey}}`, `{{runId}}`, `{{toolCallId}}`
- `{{path:<dotted.path>}}` for arbitrary payload values

Backoff templates can also use `{{retryBackoffRemainingMs}}`.

## Matching Fields

`when` supports:

- `eventType`, `toolName`, `agentId`, `sessionId`, `sessionKey`
- `contains`, `equals`, `requiredPaths`
- `typeChecks`, `inList`, `notInList`
- `matchesRegex`, `notMatchesRegex`
- `domainAllowlist`, `domainBlocklist`, `domainPath`
- `idleForMsGte`, `parentStatus`

## Backoff And Approval Cache

Tool Guard includes built-in anti-loop and approval reuse controls:

- `scopeKeyBy`: `tool` or `tool_and_params`
- `retryBackoffMs`: block rapid retries after a blocked decision
- `retryBackoffReason`: custom reason while backoff active
- `approvalCacheTtlMs`: cache allow decisions for repeated calls

## Error Handling

`onError`:

- `allow`: action failure/timeouts fail open
- `block`: action failure/timeouts fail closed

For high-risk tools, use `block`.

## Hooking In Approval Scripts

Use `local_script` or `webhook` actions for human approval flows.

### Script Input Contract

Tool Guard local scripts receive JSON via stdin:

```json
{
  "ruleId": "<rule-id>",
  "event": {
    "type": "tool.called",
    "data": {
      "toolName": "exec",
      "params": { "command": "sudo rm -rf /" }
    }
  }
}
```

Script should output either empty output (no decision) or JSON decision:

```json
{"block": true, "blockReason": "Approval required"}
```

or

```json
{"params": {"safeMode": true}}
```

### Webhook Input/Output Contract

Webhook receives the same `{ruleId,event}` JSON body and can respond with decision JSON in response body.

## Script Best Practices

- Keep action scripts under a dedicated absolute `allowedActionDirs` path.
- Validate/parsing stdin robustly; default to safe behavior.
- Exit non-zero for true runtime failures.
- Bound runtime with explicit `timeoutMs`.
- Keep payload sizes controlled with `maxPayloadBytes`.
- Make approval decisions idempotent by keying on `toolCallId` + `eventId`.

## Webhook Best Practices

- Require auth and TLS.
- Validate incoming event shape and version.
- Return strict JSON decisions.
- Keep response latency low to avoid blocking tool path.
- Log `ruleId`, `toolName`, `sessionId`, `toolCallId` for audit.

## Safe Rollout Strategy

1. Enable `toolGuard.enabled=true`, `dryRun=true`.
2. Start with observability rules (`tool.guard.matched`) only.
3. Add blocking decisions for highest-risk patterns.
4. Turn on `onError=block` only after endpoint/script reliability is proven.
5. Tune `retryBackoffMs` and `approvalCacheTtlMs` to balance safety and UX.

## Minimal Example

```json
{
  "hookBridge": {
    "enabled": true,
    "allowedActionDirs": ["/absolute/path/to/hooks"],
    "actions": {
      "approval-webhook": {
        "type": "webhook",
        "url": "https://example.com/tool-approval",
        "method": "POST",
        "timeoutMs": 5000
      }
    },
    "toolGuard": {
      "enabled": true,
      "dryRun": false,
      "onError": "block",
      "retryBackoffMs": 10000,
      "approvalCacheTtlMs": 60000,
      "rules": [
        {
          "id": "guard-exec-sudo",
          "priority": 100,
          "when": {
            "toolName": "exec",
            "contains": {
              "data.params.command": "sudo"
            }
          },
          "action": "approval-webhook"
        }
      ]
    }
  }
}
```
