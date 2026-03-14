import { createSessionEndEvent, createSessionStartEvent } from '../hooks/session-hooks';
import { observeSessionProvenance } from './provenance';
import type { OpenClawPluginApi } from './types';
import type { TypedHookDeps } from './typed-hooks';
import {
  isRecord,
  readNumber,
  readString,
  registerTypedHook,
  resolveAgentId,
  resolveSessionRefs,
  resolveSessionRefForStatus,
  toContext,
} from './utils';

export function registerSessionHooks(api: OpenClawPluginApi, deps: TypedHookDeps): void {
  const { state, logger, ops } = deps;

  registerTypedHook(
    logger,
    api,
    'session_start',
    { name: 'event-plugin.session-start', description: 'Broadcast session.start events' },
    async (rawEvent, rawCtx) => {
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const ctx = toContext(rawCtx);
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const sessionId = sessionRefs.sessionId ?? readString(raw.sessionId) ?? readString(ctx?.sessionId);
      if (!sessionId) {
        return;
      }
      const sessionKey = sessionRefs.sessionKey ?? readString(raw.sessionKey) ?? readString(ctx?.sessionKey);
      const agentId = resolveAgentId({
        sessionTracker: state.sessionTracker,
        hookEvent: raw,
        ctx,
        sessionRefs: { ...sessionRefs, sessionId, sessionKey },
      });

      observeSessionProvenance({
        sessionTracker: state.sessionTracker,
        sessionRefs: { ...sessionRefs, sessionId, sessionKey },
        hookEvent: raw,
        ctx,
        agentId,
        direction: 'internal',
      });
      const event = createSessionStartEvent({
        sessionId,
        sessionKey,
        agentId,
        resumedFrom: readString(raw.resumedFrom),
      });
      await ops.broadcastEvent(event);
      await ops.emitAgentActivity({
        agentId,
        sessionId,
        sessionKey,
        correlationId: event.correlationId,
        sourceEventType: 'session.start',
        activity: 'Session Started',
        activityDetail: 'Agent session lifecycle started',
      });
    },
  );

  registerTypedHook(
    logger,
    api,
    'session_end',
    { name: 'event-plugin.session-end', description: 'Broadcast session.end events' },
    async (rawEvent, rawCtx) => {
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const ctx = toContext(rawCtx);
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const sessionId = sessionRefs.sessionId ?? readString(raw.sessionId) ?? readString(ctx?.sessionId);
      if (!sessionId) {
        return;
      }
      const sessionKey = sessionRefs.sessionKey ?? readString(raw.sessionKey) ?? readString(ctx?.sessionKey);
      const ended =
        state.sessionTracker.endSession(sessionId) ??
        state.sessionTracker.endSession(sessionKey ?? '');
      const agentId =
        ended?.agentId ??
        resolveAgentId({
          sessionTracker: state.sessionTracker,
          hookEvent: raw,
          ctx,
          sessionRefs: { ...sessionRefs, sessionId, sessionKey },
        });

      if (agentId) {
        state.statusReducer.removeSession(agentId, resolveSessionRefForStatus(sessionId, sessionKey));
      }

      const event = createSessionEndEvent({
        sessionId,
        sessionKey,
        agentId,
        messageCount: readNumber(raw.messageCount),
        durationMs: readNumber(raw.durationMs) ?? ended?.durationMs,
      });
      await ops.broadcastEvent(event);
      if (agentId) {
        await ops.emitAgentActivity({
          agentId,
          sessionId,
          sessionKey,
          correlationId: event.correlationId,
          sourceEventType: 'session.end',
          activity: 'Session Ended',
          activityDetail: 'Agent session lifecycle ended',
        });
      } else {
        await ops.emitAgentStatusTransitions('session.end');
      }
    },
  );
}
