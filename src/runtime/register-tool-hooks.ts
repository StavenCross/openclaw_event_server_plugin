import { randomUUID } from 'node:crypto';
import {
  createToolCalledEvent,
  createToolCompletedEvent,
  createToolErrorEvent,
  createToolGuardEvent,
  createToolResultPersistEvent,
} from '../hooks/tool-hooks';
import { redactPayload } from '../events/redaction';
import { buildToolEventProvenance, observeSessionProvenance } from './provenance';
import { buildBlockedParamsPatch, traceToolGuard } from './tool-hook-helpers';
import type { OpenClawPluginApi, PendingToolCall } from './types';
import type { TypedHookDeps } from './typed-hooks';
import {
  isRecord,
  normalizeError,
  readObject,
  readString,
  registerTypedHook,
  registerTypedHookFireAndForget,
  registerTypedHookWithResult,
  resolveAgentId,
  resolveSessionRefs,
  toContext,
  toToolHookEvent,
} from './utils';

export function registerToolHooks(api: OpenClawPluginApi, deps: TypedHookDeps): void {
  const { state, logger, ops } = deps;

  registerTypedHookWithResult<{ block?: boolean; blockReason?: string; params?: Record<string, unknown> }>(
    logger,
    api,
    'before_tool_call',
    {
      name: 'event-plugin.before-tool-call',
      description: 'Broadcast tool.called events and optionally apply hookBridge tool guard',
      // Run late so block/params decisions are not overridden by other hooks.
      priority: -10000,
    },
    async (rawEvent, rawCtx) => {
      const event = toToolHookEvent(rawEvent);
      const ctx = toContext(rawCtx);
      const raw = isRecord(rawEvent) ? rawEvent : undefined;
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const agentId = resolveAgentId({
        sessionTracker: state.sessionTracker,
        hookEvent: raw,
        ctx,
        sessionRefs,
      });
      const toolName = readString(event.toolName) ?? readString(ctx?.toolName) ?? 'unknown';
      const params = readObject(event.params) ?? {};
      const redactedGuardParams = redactPayload(params, state.config.hookBridge.toolGuard.redaction);
      const runId = readString(event.runId) ?? readString(ctx?.runId);
      const toolCallId = readString(event.toolCallId) ?? readString(ctx?.toolCallId);
      const correlationId = randomUUID();
      const subagent = state.subagentTracker.getByChildSessionKey(sessionRefs.sessionKey);
      traceToolGuard(logger, 'before_tool_call.in', {
        toolName,
        toolCallId: toolCallId ?? null,
        runId: runId ?? null,
        agentId: agentId ?? null,
        sessionId: sessionRefs.sessionId ?? null,
        sessionKey: sessionRefs.sessionKey ?? null,
      });

      const guardDecision = await state.hookBridge?.evaluateBeforeToolCall({
        toolName,
        params,
        agentId,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        runId,
        toolCallId,
      });
      traceToolGuard(logger, 'before_tool_call.guardDecision', {
        toolName,
        toolCallId: toolCallId ?? null,
        decision: guardDecision ?? null,
      });

      observeSessionProvenance({
        sessionTracker: state.sessionTracker,
        sessionRefs,
        hookEvent: raw,
        ctx,
        agentId,
        parentAgentId: subagent?.parentAgentId,
        parentSessionId: subagent?.parentSessionId,
        parentSessionKey: subagent?.parentSessionKey,
        runId,
        direction: 'internal',
      });

      const provenance = buildToolEventProvenance({
        sessionTracker: state.sessionTracker,
        sessionRefs,
        hookEvent: raw,
        ctx,
        runId,
        toolCallId,
        correlationId,
        parentAgentId: subagent?.parentAgentId,
        parentSessionId: subagent?.parentSessionId,
        parentSessionKey: subagent?.parentSessionKey,
        subagentKey: subagent?.subagentKey,
      });

      const calledEvent = createToolCalledEvent({
        toolName,
        params,
        provenance,
        agentId,
        parentAgentId: subagent?.parentAgentId,
        subagentKey: subagent?.subagentKey,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        parentSessionId: subagent?.parentSessionId,
        parentSessionKey: subagent?.parentSessionKey,
        runId,
        toolCallId,
        correlationId,
      });
      await ops.broadcastEvent(calledEvent);

      const callId = state.toolTracker.startCall(toolName, params, {
        runId,
        toolCallId,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        agentId,
        correlationId,
      });
      const pending: PendingToolCall = {
        callId,
        correlationId,
        agentId,
      };
      if (toolCallId) {
        state.pendingToolCalls.set(toolCallId, pending);
      }
      if (ctx) {
        state.pendingToolCallsByContext.set(ctx, pending);
      }

      await ops.emitAgentActivity({
        agentId,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        correlationId: calledEvent.correlationId,
        sourceEventType: 'tool.called',
        activity: 'Using Tool',
        activityDetail: `Calling tool: ${toolName}`,
        toolName,
        toolStatus: 'called',
      });

      if (guardDecision?.matched) {
        await ops.broadcastEvent(
          createToolGuardEvent({
            type: 'tool.guard.matched',
            toolName,
            params: redactedGuardParams,
            provenance,
            blockReason: guardDecision.blockReason,
            matchedRuleId: guardDecision.matchedRuleId,
            matchedActionId: guardDecision.matchedActionId,
            decisionSource: guardDecision.decisionSource,
            agentId,
            parentAgentId: subagent?.parentAgentId,
            subagentKey: subagent?.subagentKey,
            sessionId: sessionRefs.sessionId,
            sessionKey: sessionRefs.sessionKey,
            parentSessionId: subagent?.parentSessionId,
            parentSessionKey: subagent?.parentSessionKey,
            runId,
            toolCallId,
            correlationId,
          }),
        );
      }

      if (guardDecision?.block) {
        const blockedParamsPatch = buildBlockedParamsPatch(params);
        traceToolGuard(logger, 'before_tool_call.return.block', {
          toolName,
          toolCallId: toolCallId ?? null,
          blockReason: guardDecision.blockReason ?? null,
          matchedRuleId: guardDecision.matchedRuleId ?? null,
          matchedActionId: guardDecision.matchedActionId ?? null,
          decisionSource: guardDecision.decisionSource ?? null,
        });
        await ops.broadcastEvent(
          createToolGuardEvent({
            type: 'tool.guard.blocked',
            toolName,
            params: redactPayload(
              {
                ...params,
                ...blockedParamsPatch,
              },
              state.config.hookBridge.toolGuard.redaction,
            ),
            provenance,
            blockReason: guardDecision.blockReason,
            matchedRuleId: guardDecision.matchedRuleId,
            matchedActionId: guardDecision.matchedActionId,
            decisionSource: guardDecision.decisionSource,
            agentId,
            parentAgentId: subagent?.parentAgentId,
            subagentKey: subagent?.subagentKey,
            sessionId: sessionRefs.sessionId,
            sessionKey: sessionRefs.sessionKey,
            parentSessionId: subagent?.parentSessionId,
            parentSessionKey: subagent?.parentSessionKey,
            runId,
            toolCallId,
            correlationId,
          }),
        );
        return {
          block: true,
          blockReason: guardDecision.blockReason,
          // Defense in depth: if another hook later overwrites block=false in this runtime,
          // this param patch still causes tool argument validation/execution to fail closed.
          params: blockedParamsPatch,
        };
      }

      if (guardDecision?.params) {
        traceToolGuard(logger, 'before_tool_call.return.params', {
          toolName,
          toolCallId: toolCallId ?? null,
          matchedRuleId: guardDecision.matchedRuleId ?? null,
          matchedActionId: guardDecision.matchedActionId ?? null,
          decisionSource: guardDecision.decisionSource ?? null,
        });
        await ops.broadcastEvent(
          createToolGuardEvent({
            type: 'tool.guard.allowed',
            toolName,
            params: redactPayload(guardDecision.params, state.config.hookBridge.toolGuard.redaction),
            provenance,
            matchedRuleId: guardDecision.matchedRuleId,
            matchedActionId: guardDecision.matchedActionId,
            decisionSource: guardDecision.decisionSource,
            agentId,
            parentAgentId: subagent?.parentAgentId,
            subagentKey: subagent?.subagentKey,
            sessionId: sessionRefs.sessionId,
            sessionKey: sessionRefs.sessionKey,
            parentSessionId: subagent?.parentSessionId,
            parentSessionKey: subagent?.parentSessionKey,
            runId,
            toolCallId,
            correlationId,
          }),
        );
        return {
          params: guardDecision.params,
        };
      }

      if (guardDecision?.matched) {
        await ops.broadcastEvent(
          createToolGuardEvent({
            type: 'tool.guard.allowed',
            toolName,
            params: redactedGuardParams,
            provenance,
            matchedRuleId: guardDecision.matchedRuleId,
            matchedActionId: guardDecision.matchedActionId,
            decisionSource: guardDecision.decisionSource,
            agentId,
            parentAgentId: subagent?.parentAgentId,
            subagentKey: subagent?.subagentKey,
            sessionId: sessionRefs.sessionId,
            sessionKey: sessionRefs.sessionKey,
            parentSessionId: subagent?.parentSessionId,
            parentSessionKey: subagent?.parentSessionKey,
            runId,
            toolCallId,
            correlationId,
          }),
        );
      }
      traceToolGuard(logger, 'before_tool_call.return.none', {
        toolName,
        toolCallId: toolCallId ?? null,
      });

      return undefined;
    },
  );

  registerTypedHook(
    logger,
    api,
    'after_tool_call',
    { name: 'event-plugin.after-tool-call', description: 'Broadcast tool.completed/tool.error events' },
    async (rawEvent, rawCtx) => {
      const event = toToolHookEvent(rawEvent);
      const ctx = toContext(rawCtx);
      const raw = isRecord(rawEvent) ? rawEvent : undefined;
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const toolCallId = readString(event.toolCallId) ?? readString(ctx?.toolCallId);
      const pendingById = toolCallId ? state.pendingToolCalls.get(toolCallId) : undefined;
      const pendingByContext = ctx ? state.pendingToolCallsByContext.get(ctx) : undefined;
      const pending = pendingById ?? pendingByContext;

      const callInfo = pending ? state.toolTracker.endCall(pending.callId) : null;
      if (toolCallId) {
        state.pendingToolCalls.delete(toolCallId);
      }
      if (ctx) {
        state.pendingToolCallsByContext.delete(ctx);
      }

      const agentId =
        pending?.agentId ??
        resolveAgentId({
          sessionTracker: state.sessionTracker,
          hookEvent: raw,
          ctx,
          sessionRefs,
        });
      const runId = callInfo?.runId ?? readString(event.runId) ?? readString(ctx?.runId);
      const subagent = state.subagentTracker.getByChildSessionKey(
        callInfo?.sessionKey ?? sessionRefs.sessionKey,
      );
      observeSessionProvenance({
        sessionTracker: state.sessionTracker,
        sessionRefs,
        hookEvent: raw,
        ctx,
        agentId,
        parentAgentId: subagent?.parentAgentId,
        parentSessionId: subagent?.parentSessionId,
        parentSessionKey: subagent?.parentSessionKey,
        runId,
        direction: 'internal',
      });
      const toolName =
        callInfo?.toolName ?? readString(event.toolName) ?? readString(ctx?.toolName) ?? 'unknown';
      const correlationId = pending?.correlationId ?? callInfo?.correlationId;
      const provenance = buildToolEventProvenance({
        sessionTracker: state.sessionTracker,
        sessionRefs: {
          ...sessionRefs,
          sessionId: callInfo?.sessionId ?? sessionRefs.sessionId,
          sessionKey: callInfo?.sessionKey ?? sessionRefs.sessionKey,
        },
        hookEvent: raw,
        ctx,
        runId,
        toolCallId: callInfo?.toolCallId ?? toolCallId,
        correlationId,
        parentAgentId: subagent?.parentAgentId,
        parentSessionId: subagent?.parentSessionId,
        parentSessionKey: subagent?.parentSessionKey,
        subagentKey: subagent?.subagentKey,
      });

      const normalizedError =
        event.error !== undefined && event.error !== null ? normalizeError(event.error) : undefined;
      const toolEvent = normalizedError
        ? createToolErrorEvent({
            toolName,
            error: normalizedError.message,
            stackTrace: normalizedError.stack,
            params: callInfo?.params,
            provenance,
            agentId,
            parentAgentId: subagent?.parentAgentId,
            subagentKey: subagent?.subagentKey,
            sessionId: callInfo?.sessionId ?? sessionRefs.sessionId,
            sessionKey: callInfo?.sessionKey ?? sessionRefs.sessionKey,
            parentSessionId: subagent?.parentSessionId,
            parentSessionKey: subagent?.parentSessionKey,
            runId,
            toolCallId: callInfo?.toolCallId ?? toolCallId,
            correlationId,
          })
        : createToolCompletedEvent({
            toolName,
            result: event.result,
            durationMs: callInfo?.durationMs,
            provenance,
            agentId,
            parentAgentId: subagent?.parentAgentId,
            subagentKey: subagent?.subagentKey,
            sessionId: callInfo?.sessionId ?? sessionRefs.sessionId,
            sessionKey: callInfo?.sessionKey ?? sessionRefs.sessionKey,
            parentSessionId: subagent?.parentSessionId,
            parentSessionKey: subagent?.parentSessionKey,
            runId,
            toolCallId: callInfo?.toolCallId ?? toolCallId,
            correlationId,
          });

      await ops.broadcastEvent(toolEvent);
      await ops.emitAgentActivity({
        agentId,
        sessionId: toolEvent.sessionId,
        sessionKey: toolEvent.sessionKey,
        correlationId: toolEvent.correlationId,
        sourceEventType: toolEvent.type,
        activity: toolEvent.type === 'tool.error' ? 'Tool Error' : 'Tool Completed',
        activityDetail:
          toolEvent.type === 'tool.error' ? `Tool failed: ${toolName}` : `Tool completed: ${toolName}`,
        toolName,
        toolStatus: toolEvent.type === 'tool.error' ? 'error' : 'completed',
      });
    },
  );

  registerTypedHookFireAndForget(
    logger,
    api,
    'tool_result_persist',
    { name: 'event-plugin.tool-result-persist', description: 'Broadcast tool.result_persist events' },
    async (rawEvent, rawCtx) => {
      const event = toToolHookEvent(rawEvent);
      const ctx = toContext(rawCtx);
      const raw = isRecord(rawEvent) ? rawEvent : undefined;
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const agentId = resolveAgentId({
        sessionTracker: state.sessionTracker,
        hookEvent: raw,
        ctx,
        sessionRefs,
      });
      const subagent = state.subagentTracker.getByChildSessionKey(sessionRefs.sessionKey);
      observeSessionProvenance({
        sessionTracker: state.sessionTracker,
        sessionRefs,
        hookEvent: raw,
        ctx,
        agentId,
        parentAgentId: subagent?.parentAgentId,
        parentSessionId: subagent?.parentSessionId,
        parentSessionKey: subagent?.parentSessionKey,
        direction: 'internal',
      });
      const provenance = buildToolEventProvenance({
        sessionTracker: state.sessionTracker,
        sessionRefs,
        hookEvent: raw,
        ctx,
        toolCallId: readString(event.toolCallId) ?? readString(ctx?.toolCallId),
        correlationId: undefined,
        parentAgentId: subagent?.parentAgentId,
        parentSessionId: subagent?.parentSessionId,
        parentSessionKey: subagent?.parentSessionKey,
        subagentKey: subagent?.subagentKey,
      });

      const persistEvent = createToolResultPersistEvent({
        toolName: readString(event.toolName) ?? readString(ctx?.toolName),
        toolCallId: readString(event.toolCallId) ?? readString(ctx?.toolCallId),
        message: event.message,
        isSynthetic: typeof event.isSynthetic === 'boolean' ? event.isSynthetic : undefined,
        provenance,
        agentId,
        parentAgentId: subagent?.parentAgentId,
        subagentKey: subagent?.subagentKey,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        parentSessionId: subagent?.parentSessionId,
        parentSessionKey: subagent?.parentSessionKey,
      });
      await ops.broadcastEvent(persistEvent);
      await ops.emitAgentActivity({
        agentId,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        correlationId: persistEvent.correlationId,
        sourceEventType: 'tool.result_persist',
        activity: 'Persisting Tool Result',
        activityDetail: 'Tool result appended to transcript',
      });
    },
  );
}
