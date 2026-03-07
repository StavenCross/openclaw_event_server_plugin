# UI

The plugin does not ship a built-in web UI. It provides an event stream and control points intended for custom dashboards and automations.

## Recommended UI Surfaces

For operator dashboards, prioritize:

- live event timeline (by `timestamp`, `type`, `agentId`)
- per-agent status board (`agent.status`, `agent.activity`)
- tool guard stream (`tool.guard.*`) with rule/action IDs
- subagent graph (`subagent.*`, `agent.sub_agent_spawn`)
- webhook delivery/queue metrics from runtime logs

## Minimal Consumer Pattern

1. Connect to WebSocket broadcast.
2. Parse canonical event envelope.
3. Store by `eventId` and `correlationId`.
4. Render type-specific cards using `event.type` + `event.data`.

## UX Guidance For Operators

- Always show `correlationId`, `sessionId/sessionKey`, `toolCallId` for drill-down.
- Treat `agent.status` as state transitions and `agent.activity` as timeline updates.
- Surface `tool.guard.blocked` with `blockReason`, `matchedRuleId`, `matchedActionId`.
- Show transport metadata (`metadata.transport`) when diagnosing multi-runtime behavior.

## Suggested Views

- Overview: active agents, working/idle/sleeping/offline counts
- Tool Guard: matched/allowed/blocked rates and latest blocked actions
- Sessions: active sessions and recent session completions
- Subagents: spawned/ended/idle transitions
- Gateway health: startup/start/stop lifecycle events
