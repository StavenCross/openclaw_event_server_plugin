import { createAgentSubAgentSpawnEvent } from '../hooks/agent-hooks';
import {
  createSubagentEndedEvent,
  createSubagentSpawnedEvent,
  createSubagentSpawningEvent,
} from '../hooks/subagent-hooks';
import type { OpenClawPluginApi } from './types';
import type { TypedHookDeps } from './typed-hooks';
import {
  isRecord,
  readString,
  registerTypedHook,
  resolveAgentId,
  resolveSessionRefs,
  toContext,
} from './utils';

function normalizeSubagentEndReason(value: unknown): 'completed' | 'deleted' | 'swept' | 'released' | 'unknown' {
  switch (value) {
    case 'completed':
    case 'deleted':
    case 'swept':
    case 'released':
      return value;
    default:
      return 'unknown';
  }
}

export function registerSubagentHooks(api: OpenClawPluginApi, deps: TypedHookDeps): void {
  const { state, logger, ops } = deps;

  registerTypedHook(
    logger,
    api,
    'subagent_spawning',
    { name: 'event-plugin.subagent-spawning', description: 'Broadcast subagent.spawning events' },
    async (rawEvent, rawCtx) => {
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const ctx = toContext(rawCtx);
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const agentId =
        resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, ctx, sessionRefs }) ??
        readString(raw.agentId);
      const event = createSubagentSpawningEvent({
        agentId,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        runId: readString(raw.runId) ?? readString(ctx?.runId),
        childSessionKey: readString(raw.childSessionKey),
        data: {
          ...raw,
          parentAgentId: agentId,
          parentSessionId: sessionRefs.sessionId,
          parentSessionKey: sessionRefs.sessionKey,
          childAgentId: readString(raw.agentId),
          childSessionKey: readString(raw.childSessionKey),
        },
      });
      await ops.broadcastEvent(event);
      await ops.emitAgentActivity({
        agentId,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        correlationId: event.correlationId,
        sourceEventType: 'subagent.spawning',
        activity: 'Spawning Subagent',
        activityDetail: 'Subagent spawn requested',
      });
    },
  );

  registerTypedHook(
    logger,
    api,
    'subagent_spawned',
    { name: 'event-plugin.subagent-spawned', description: 'Broadcast subagent.spawned events' },
    async (rawEvent, rawCtx) => {
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const ctx = toContext(rawCtx);
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const agentId =
        resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, ctx, sessionRefs }) ??
        readString(raw.agentId);
      const runId = readString(raw.runId) ?? readString(ctx?.runId);
      const childSessionKey = readString(raw.childSessionKey);
      const event = createSubagentSpawnedEvent({
        agentId,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        runId,
        childSessionKey,
        data: {
          ...raw,
          parentAgentId: agentId,
          parentSessionId: sessionRefs.sessionId,
          parentSessionKey: sessionRefs.sessionKey,
          childAgentId: readString(raw.agentId),
          childSessionKey,
        },
      });
      await ops.broadcastEvent(event);

      const synthetic = createAgentSubAgentSpawnEvent({
        parentAgentId: agentId,
        parentSessionId: sessionRefs.sessionId,
        parentSessionKey: sessionRefs.sessionKey,
        childAgentId: readString(raw.agentId),
        childSessionKey,
        runId,
        mode: readString(raw.mode),
        data: raw,
      });
      await ops.broadcastEvent(synthetic);

      if (childSessionKey) {
        state.subagentTracker.registerSpawn({
          childSessionKey,
          parentAgentId: agentId,
          parentSessionId: sessionRefs.sessionId,
          parentSessionKey: sessionRefs.sessionKey,
          childAgentId: readString(raw.agentId),
          runId,
          mode: readString(raw.mode),
        });
        state.sessionTracker.touchSession({
          sessionKey: childSessionKey,
          agentId: readString(raw.agentId),
        });
      }

      await ops.emitAgentActivity({
        agentId,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        correlationId: event.correlationId,
        sourceEventType: 'subagent.spawned',
        activity: 'Subagent Spawned',
        activityDetail: 'Subagent successfully spawned',
      });
    },
  );

  registerTypedHook(
    logger,
    api,
    'subagent_ended',
    { name: 'event-plugin.subagent-ended', description: 'Broadcast subagent.ended events' },
    async (rawEvent, rawCtx) => {
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const ctx = toContext(rawCtx);
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const agentId =
        resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, ctx, sessionRefs }) ??
        readString(raw.agentId);
      const childSessionKey = readString(raw.targetSessionKey) ?? readString(raw.childSessionKey);

      const event = createSubagentEndedEvent({
        agentId,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        runId: readString(raw.runId) ?? readString(ctx?.runId),
        childSessionKey,
        endReason: normalizeSubagentEndReason(readString(raw.reason)),
        data: {
          ...raw,
          parentAgentId: agentId,
          parentSessionId: sessionRefs.sessionId,
          parentSessionKey: sessionRefs.sessionKey,
          childAgentId: readString(raw.agentId),
          childSessionKey,
        },
      });
      await ops.broadcastEvent(event);

      if (childSessionKey) {
        state.subagentTracker.markEnded(childSessionKey);
        const childAgent = state.sessionTracker.getAgentIdBySession({ sessionKey: childSessionKey });
        if (childAgent) {
          state.statusReducer.removeSession(childAgent, childSessionKey);
        }
        state.sessionTracker.endSession(childSessionKey);
      }

      await ops.emitAgentActivity({
        agentId,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        correlationId: event.correlationId,
        sourceEventType: 'subagent.ended',
        activity: 'Subagent Ended',
        activityDetail: 'Subagent lifecycle ended',
      });
    },
  );
}
