import { createAfterCompactionEvent, createBeforeCompactionEvent } from '../hooks/session-compaction-hooks';
import type { OpenClawPluginApi } from './types';
import type { TypedHookDeps } from './typed-hooks';
import {
  isRecord,
  readNumber,
  readString,
  registerTypedHook,
  resolveAgentId,
  resolveSessionRefs,
  toContext,
} from './utils';

export function registerCompactionHooks(api: OpenClawPluginApi, deps: TypedHookDeps): void {
  const { state, logger, ops } = deps;

  registerTypedHook(
    logger,
    api,
    'before_compaction',
    { name: 'event-plugin.before-compaction', description: 'Broadcast session.before_compaction events' },
    async (rawEvent, rawCtx) => {
      // Compaction mutates session transcript state, so keep these events in the
      // session family while still preserving the acting agent identity.
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const ctx = toContext(rawCtx);
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const agentId = resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, ctx, sessionRefs });
      state.sessionTracker.touchSession({ sessionId: sessionRefs.sessionId, sessionKey: sessionRefs.sessionKey, agentId });

      await ops.broadcastEvent(
        createBeforeCompactionEvent({
          messageCount: readNumber(raw.messageCount) ?? 0,
          compactingCount: readNumber(raw.compactingCount),
          tokenCount: readNumber(raw.tokenCount),
          messages: Array.isArray(raw.messages) ? raw.messages : undefined,
          sessionFile: readString(raw.sessionFile),
          privacy: state.config.privacy,
          agentId,
          sessionId: sessionRefs.sessionId,
          sessionKey: sessionRefs.sessionKey,
          runId: readString(ctx?.runId),
        }),
      );
    },
  );

  registerTypedHook(
    logger,
    api,
    'after_compaction',
    { name: 'event-plugin.after-compaction', description: 'Broadcast session.after_compaction events' },
    async (rawEvent, rawCtx) => {
      // The post-compaction event captures the resulting transcript counts so
      // bridge rules can reason about compaction impact without diffing state.
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const ctx = toContext(rawCtx);
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const agentId = resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, ctx, sessionRefs });
      state.sessionTracker.touchSession({ sessionId: sessionRefs.sessionId, sessionKey: sessionRefs.sessionKey, agentId });

      await ops.broadcastEvent(
        createAfterCompactionEvent({
          messageCount: readNumber(raw.messageCount) ?? 0,
          compactedCount: readNumber(raw.compactedCount) ?? 0,
          tokenCount: readNumber(raw.tokenCount),
          sessionFile: readString(raw.sessionFile),
          privacy: state.config.privacy,
          agentId,
          sessionId: sessionRefs.sessionId,
          sessionKey: sessionRefs.sessionKey,
          runId: readString(ctx?.runId),
        }),
      );
    },
  );
}
