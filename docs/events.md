# Events

This is the exhaustive event type list emitted by the plugin and their structures.

## Canonical Envelope

All event types share the same outer envelope:

- `eventId`, `schemaVersion`, `timestamp`, `type`, `eventCategory`, `eventName`, `source`, `pluginVersion`
- optional: `agentId`, `sessionId`, `sessionKey`, `runId`, `toolCallId`, `correlationId`, `result`, `error`, `signature`, `metadata`
- `data` payload is type-specific

## Event Type Inventory

- Message: `message.received`, `message.transcribed`, `message.preprocessed`, `message.sent`, `message.edited`, `message.deleted`
- Tool: `tool.called`, `tool.guard.matched`, `tool.guard.allowed`, `tool.guard.blocked`, `tool.completed`, `tool.error`, `tool.result_persist`
- Command: `command.new`, `command.reset`, `command.stop`
- Session: `session.start`, `session.end`, `session.before_compaction`, `session.after_compaction`
- Subagent: `subagent.spawning`, `subagent.spawned`, `subagent.ended`, `subagent.idle`
- Agent: `agent.bootstrap`, `agent.error`, `agent.before_model_resolve`, `agent.before_prompt_build`, `agent.llm_input`, `agent.llm_output`, `agent.end`, `agent.session_start`, `agent.session_end`, `agent.sub_agent_spawn`, `agent.status`, `agent.activity`
- Gateway: `gateway.startup`, `gateway.start`, `gateway.stop`
- Legacy aliases: `session.spawned`, `session.completed`, `session.error`

## Message Events

### `message.received`
- `eventCategory`: `message`
- `eventName`: `message:received`
- `source`: `internal-hook`
- `data` keys (when present): `from`, `to`, `content`, `channelId`, `accountId`, `conversationId`, `messageId`, `isGroup`, `groupId`, `metadata`
- `metadata.hookTimestamp` may exist

### `message.transcribed`
- `eventName`: `message:transcribed`
- `data` includes message keys above plus `transcript`

### `message.preprocessed`
- `eventName`: `message:preprocessed`
- `data` includes message keys above plus `normalizedText`

### `message.sent`
- `eventName`: `message:sent`
- `result`: `success` when available
- `error`: present when `context.error` exists

### `message.edited`
- `eventName`: `message:edited`
- `data` may include `newContent`, `originalContent`, `messageId`, `channelId`

### `message.deleted`
- `eventName`: `message:deleted`
- `data` may include `messageId`, `channelId`

## Tool Events

### `tool.called`
- `eventName`: `before_tool_call`
- `source`: `plugin-hook`
- `data`: `toolName`, `params`, `agentId`, `parentAgentId`, `subagentKey`, `parentSessionId`, `parentSessionKey`

### `tool.guard.matched`
- `eventName`: `before_tool_call`
- `data`: `toolName`, `params` (possibly redacted), `blockReason?`, `matchedRuleId?`, `matchedActionId?`, `decisionSource?`, identity fields above

### `tool.guard.allowed`
- same structure as `tool.guard.matched`
- emitted when matched and allowed (optionally with param patch)

### `tool.guard.blocked`
- same structure as guard events
- emitted when tool call is blocked

### `tool.completed`
- `eventName`: `after_tool_call`
- `result`: tool result payload
- `data`: `toolName`, `durationMs`, identity fields, `result`

### `tool.error`
- `eventName`: `after_tool_call`
- `error.kind`: `tool`
- `data`: `toolName`, `params`, identity fields, `error`, `stackTrace`

### `tool.result_persist`
- `eventName`: `tool_result_persist`
- `data`: `toolName`, `toolCallId`, `message`, `isSynthetic`, identity fields

## Command Events

### `command.new` / `command.reset` / `command.stop`
- `eventCategory`: `command`
- `eventName`: `command:new` / `command:reset` / `command:stop`
- `source`: `internal-hook`
- `data`: `commandSource?`, `senderId?`, plus raw command context fields

## Session Events

### `session.start`
- `eventName`: `session_start`
- `source`: `plugin-hook`
- `data`: `sessionId`, `sessionKey?`, `agentId?`, `resumedFrom?`, optional metadata passthrough

### `session.end`
- `eventName`: `session_end`
- `data`: `sessionId`, `sessionKey?`, `agentId?`, `messageCount?`, `durationMs?`, optional metadata passthrough

### `session.before_compaction`
- `eventName`: `before_compaction`
- `source`: `plugin-hook`
- `data` in default metadata mode: `messageCount`, `compactingCount?`, `tokenCount?`, `hasSessionFile`, `messageRoles?`
- `data` in full mode additionally includes: `messages?`, `sessionFile?`
- semantic note: compaction is emitted as a session event because the session transcript is the thing being compacted, even when an agent initiates it

### `session.after_compaction`
- `eventName`: `after_compaction`
- `source`: `plugin-hook`
- `data` in default metadata mode: `messageCount`, `compactedCount`, `tokenCount?`, `hasSessionFile`
- `data` in full mode additionally includes: `sessionFile?`

### Legacy `session.spawned`
- compatibility alias
- `data`: `sessionKey`, `parentSessionId?`, `agentId?`, `metadata.workspaceDir?`, `metadata.channel?`, `metadata.requester?`

### Legacy `session.completed`
- compatibility alias
- `data`: `sessionKey`, `parentSessionId?`, `agentId?`

### Legacy `session.error`
- compatibility alias
- `error.kind`: `agent`
- `data`: `sessionKey`, `parentSessionId?`, `agentId?`, `error`, `stackTrace?`

## Subagent Events

### `subagent.spawning`
- `eventName`: `subagent_spawning`
- `data`: `childSessionKey?` + raw subagent payload (commonly includes parent/child IDs and session refs)

### `subagent.spawned`
- `eventName`: `subagent_spawned`
- `data`: `childSessionKey?` + raw subagent payload

### `subagent.ended`
- `eventName`: `subagent_ended`
- `data`: `childSessionKey?`, `endReason` (`completed|deleted|swept|released|unknown`) + raw subagent payload

### `subagent.idle` (synthetic)
- `eventCategory`: `synthetic`
- `eventName`: `subagent.idle`
- `source`: `synthetic`
- `data`: `subagentKey`, `parentAgentId?`, `parentSessionId?`, `parentSessionKey?`, `childAgentId?`, `childSessionKey`, `mode?`, `idleForMs`, `lastActiveAt`

## Agent Events

### `agent.bootstrap`
- `eventName`: `agent:bootstrap`
- `source`: `internal-hook`
- `data`: raw bootstrap context

### `agent.error`
- `eventName`: `agent:error`
- `error.kind`: `agent`
- `data`: raw error context

### `agent.before_model_resolve`
- `eventName`: `before_model_resolve`
- `source`: `plugin-hook`
- `data` in default metadata mode: `promptLength`
- `data` in full mode additionally includes: `prompt`
- semantic note: this is the earliest modern run hook and is intended for model/provider steering rather than prompt mutation

### `agent.before_prompt_build`
- `eventName`: `before_prompt_build`
- `source`: `plugin-hook`
- `data` in default metadata mode: `promptLength`, `messageCount`, `messageRoles?`
- `data` in full mode additionally includes: `prompt`, `messages`
- semantic note: this supersedes most legacy `before_agent_start` prompt-injection use cases

### `agent.llm_input`
- `eventName`: `llm_input`
- `source`: `plugin-hook`
- `data` in default metadata mode: `provider`, `model`, `promptLength`, `historyMessageCount`, `historyMessageRoles?`, `imagesCount`, `hasSystemPrompt`, prompt-delta audit fields when prior hook state exists
- `data` in full mode additionally includes: `systemPrompt?`, `prompt`, `historyMessages`

### `agent.llm_output`
- `eventName`: `llm_output`
- `source`: `plugin-hook`
- `data` in default metadata mode: `provider`, `model`, `assistantTextCount`, `assistantTextLengths?`, `hasLastAssistant`, `usage?`
- `data` in full mode additionally includes: `assistantTexts`, `lastAssistant?`

### `agent.end`
- `eventName`: `agent_end`
- `source`: `plugin-hook`
- `error.kind`: `agent` when `success=false` and upstream provides an error
- `data` in default metadata mode: `messageCount`, `messageRoles?`, `success`, `error?`, `durationMs?`
- `data` in full mode additionally includes: `messages`
- semantic note: this is the stable "agent run finished" hook, not a scraped runtime debug line

### `agent.session_start`
- `eventName`: `agent:session:start`
- `data`: raw agent session context

### `agent.session_end`
- `eventName`: `agent:session:end`
- `data`: raw agent session context

### `agent.sub_agent_spawn` (synthetic)
- `eventName`: `agent.sub_agent_spawn`
- `source`: `synthetic`
- `data`: `parentAgentId?`, `childAgentId?`, `parentSessionId?`, `parentSessionKey?`, `childSessionKey?`, `mode?`, plus raw spawn payload

### `agent.status` (synthetic)
- `eventName`: `agent.status`
- `source`: `synthetic`
- `data`: `agentId`, `status` (`sleeping|idle|working|offline|error`), `activity?`, `activityDetail?`, `sourceEventType?`
- `metadata` may include: `reason`, `activeSessionCount`, `lastActiveAt`

### `agent.activity` (synthetic)
- `eventName`: `agent.activity`
- `source`: `synthetic`
- `data`: `agentId`, `activity`, `activityDetail?`, `sourceEventType?`, `toolName?`, `toolStatus?`

## Gateway Events

### `gateway.startup`
- `eventName`: `gateway:startup`
- `source`: `internal-hook`
- `data`: `port?` plus raw context

### `gateway.start`
- `eventName`: `gateway_start`
- `source`: `plugin-hook`
- `data`: `port?` plus raw payload

### `gateway.stop`
- `eventName`: `gateway_stop`
- `source`: `plugin-hook`
- `data`: `reason?` plus raw payload

## Correlation Notes

- Tool lifecycle correlation is maintained via `toolCallId` and `correlationId`.
- Session and subagent synthetic events include parent/child linkage fields in `data`.
- Hook Bridge rules can match the new agent/session lifecycle events through normal `eventType`, identity fields, and `data.*` matchers.
- Tool Guard remains scoped to `before_tool_call`; prompt/model/compaction hooks are observable to Hook Bridge but not subject to synchronous tool-guard enforcement.
- `privacy.payloadMode=metadata` is the default for these modern lifecycle hooks. Use `privacy.payloadMode=full` only when you intentionally want raw prompt/model/transcript payloads in downstream transports.
- Transport metadata may be injected into `metadata.transport` by the transport manager (`runtimeId`, `route`, role fields).
- Downstream consumers may re-emit normalized socket events such as `agent_status`. Those are consumer-specific transport labels, not additional upstream OpenClaw hook names. When reviewing gateway debug logs for new upstream coverage, compare against the pinned hook surface fixture in `tests/fixtures/openclaw-hook-surface.v3caab92.json`.
