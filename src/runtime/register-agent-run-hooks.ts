import {
  createAgentEndEvent,
  createBeforeModelResolveEvent,
  createBeforePromptBuildEvent,
  createLlmInputEvent,
  createLlmOutputEvent,
} from '../hooks/agent-run-hooks';
import type { OpenClawPluginApi } from './types';
import type { TypedHookDeps } from './typed-hooks';
import {
  isRecord,
  readNumber,
  readObject,
  readString,
  registerTypedHook,
  resolveAgentId,
  resolveSessionRefs,
  toContext,
} from './utils';
import { observeSessionProvenance } from './provenance';

export function registerAgentRunHooks(api: OpenClawPluginApi, deps: TypedHookDeps): void {
  const { state, logger, ops } = deps;

  registerTypedHook(
    logger,
    api,
    'before_model_resolve',
    { name: 'event-plugin.before-model-resolve', description: 'Broadcast agent.before_model_resolve events' },
    async (rawEvent, rawCtx) => {
      // Model resolution happens before prompt construction, so the emitted
      // event intentionally carries only the steering input plus identity.
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const ctx = toContext(rawCtx);
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const prompt = readString(raw.prompt) ?? '';
      const runId = readString(ctx?.runId);
      const agentId = resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, ctx, sessionRefs });
      observeSessionProvenance({
        sessionTracker: state.sessionTracker,
        sessionRefs,
        hookEvent: raw,
        ctx,
        agentId,
        runId,
        direction: 'internal',
      });
      state.agentRunTracker.observeBeforeModelResolve({
        runId,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        promptLength: prompt.length,
      });

      await ops.broadcastEvent(
        createBeforeModelResolveEvent({
          prompt,
          privacy: state.config.privacy,
          agentId,
          sessionId: sessionRefs.sessionId,
          sessionKey: sessionRefs.sessionKey,
          runId,
        }),
      );
    },
  );

  registerTypedHook(
    logger,
    api,
    'before_prompt_build',
    { name: 'event-plugin.before-prompt-build', description: 'Broadcast agent.before_prompt_build events' },
    async (rawEvent, rawCtx) => {
      // Preserve the raw message list here because this is the last upstream
      // hook before the model-facing prompt is assembled.
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const ctx = toContext(rawCtx);
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const prompt = readString(raw.prompt) ?? '';
      const messages = Array.isArray(raw.messages) ? raw.messages : [];
      const runId = readString(ctx?.runId);
      const agentId = resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, ctx, sessionRefs });
      observeSessionProvenance({
        sessionTracker: state.sessionTracker,
        sessionRefs,
        hookEvent: raw,
        ctx,
        agentId,
        runId,
        direction: 'internal',
      });
      state.agentRunTracker.observeBeforePromptBuild({
        runId,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
        promptLength: prompt.length,
        messageCount: messages.length,
      });

      await ops.broadcastEvent(
        createBeforePromptBuildEvent({
          prompt,
          messages,
          privacy: state.config.privacy,
          agentId,
          sessionId: sessionRefs.sessionId,
          sessionKey: sessionRefs.sessionKey,
          runId,
        }),
      );
    },
  );

  registerTypedHook(
    logger,
    api,
    'llm_input',
    { name: 'event-plugin.llm-input', description: 'Broadcast agent.llm_input events' },
    async (rawEvent, rawCtx) => {
      // OpenClaw only considers this hook meaningful once a session has been
      // resolved, so skip orphaned payloads rather than minting fake IDs. When
      // upstream does not provide a runId, keep tracker correlation anchored to
      // the session identity instead of forcing a synthetic run key.
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const ctx = toContext(rawCtx);
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const sessionId = readString(raw.sessionId) ?? sessionRefs.sessionId;
      if (!sessionId) {
        return;
      }
      const agentId = resolveAgentId({
        sessionTracker: state.sessionTracker,
        hookEvent: raw,
        ctx,
        sessionRefs: { sessionId, sessionKey: sessionRefs.sessionKey },
      });
      const runId = readString(raw.runId) ?? readString(ctx?.runId);
      observeSessionProvenance({
        sessionTracker: state.sessionTracker,
        sessionRefs: { ...sessionRefs, sessionId },
        hookEvent: raw,
        ctx,
        agentId,
        runId,
        direction: 'internal',
      });
      const prompt = readString(raw.prompt) ?? '';
      const historyMessages = Array.isArray(raw.historyMessages) ? raw.historyMessages : [];
      const snapshot = state.agentRunTracker.getSnapshot({
        runId,
        sessionId,
        sessionKey: sessionRefs.sessionKey,
      });

      await ops.broadcastEvent(
        createLlmInputEvent({
          runId,
          sessionId,
          sessionKey: sessionRefs.sessionKey,
          provider: readString(raw.provider) ?? 'unknown-provider',
          model: readString(raw.model) ?? 'unknown-model',
          systemPrompt: readString(raw.systemPrompt),
          prompt,
          historyMessages,
          imagesCount: readNumber(raw.imagesCount) ?? 0,
          privacy: state.config.privacy,
          audit: {
            ...(snapshot?.beforePromptBuildPromptLength !== undefined
              ? {
                  promptChangedFromBeforePromptBuild: snapshot.beforePromptBuildPromptLength !== prompt.length,
                  promptLengthDeltaFromBeforePromptBuild: prompt.length - snapshot.beforePromptBuildPromptLength,
                }
              : {}),
            ...(snapshot?.beforeModelResolvePromptLength !== undefined
              ? {
                  promptLengthDeltaFromBeforeModelResolve: prompt.length - snapshot.beforeModelResolvePromptLength,
                }
              : {}),
            ...(snapshot?.beforePromptBuildMessageCount !== undefined
              ? {
                  historyMessageCountDeltaFromBeforePromptBuild:
                    historyMessages.length - snapshot.beforePromptBuildMessageCount,
                }
              : {}),
          },
          agentId,
        }),
      );
    },
  );

  registerTypedHook(
    logger,
    api,
    'llm_output',
    { name: 'event-plugin.llm-output', description: 'Broadcast agent.llm_output events' },
    async (rawEvent, rawCtx) => {
      // Keep the same session requirement as llm_input so model I/O can be
      // correlated cleanly across downstream bridge rules and replay logs. Use
      // the same optional runId handling as llm_input so snapshot lookup does
      // not drift onto a shared synthetic fallback key.
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const ctx = toContext(rawCtx);
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const sessionId = readString(raw.sessionId) ?? sessionRefs.sessionId;
      if (!sessionId) {
        return;
      }
      const agentId = resolveAgentId({
        sessionTracker: state.sessionTracker,
        hookEvent: raw,
        ctx,
        sessionRefs: { sessionId, sessionKey: sessionRefs.sessionKey },
      });
      const runId = readString(raw.runId) ?? readString(ctx?.runId);
      observeSessionProvenance({
        sessionTracker: state.sessionTracker,
        sessionRefs: { ...sessionRefs, sessionId },
        hookEvent: raw,
        ctx,
        agentId,
        runId,
        direction: 'internal',
      });

      await ops.broadcastEvent(
        createLlmOutputEvent({
          runId,
          sessionId,
          sessionKey: sessionRefs.sessionKey,
          provider: readString(raw.provider) ?? 'unknown-provider',
          model: readString(raw.model) ?? 'unknown-model',
          assistantTexts: Array.isArray(raw.assistantTexts)
            ? raw.assistantTexts.filter((value): value is string => typeof value === 'string')
            : [],
          lastAssistant: raw.lastAssistant,
          usage: readObject(raw.usage) as
            | {
                input?: number;
                output?: number;
                cacheRead?: number;
                cacheWrite?: number;
                total?: number;
              }
            | undefined,
          privacy: state.config.privacy,
          agentId,
        }),
      );
    },
  );

  registerTypedHook(
    logger,
    api,
    'agent_end',
    { name: 'event-plugin.agent-end', description: 'Broadcast agent.end events' },
    async (rawEvent, rawCtx) => {
      // agent_end is the stable plugin hook for "run finished", which is more
      // useful to downstream consumers than scraping runtime debug log lines.
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const ctx = toContext(rawCtx);
      const sessionRefs = resolveSessionRefs(raw, ctx);
      const runId = readString(ctx?.runId);
      const agentId = resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, ctx, sessionRefs });
      observeSessionProvenance({
        sessionTracker: state.sessionTracker,
        sessionRefs,
        hookEvent: raw,
        ctx,
        agentId,
        runId,
        direction: 'internal',
      });

      await ops.broadcastEvent(
        createAgentEndEvent({
          messages: Array.isArray(raw.messages) ? raw.messages : [],
          success: raw.success === true,
          error: readString(raw.error),
          durationMs: readNumber(raw.durationMs),
          privacy: state.config.privacy,
          agentId,
          sessionId: sessionRefs.sessionId,
          sessionKey: sessionRefs.sessionKey,
          runId,
        }),
      );
      state.agentRunTracker.clearSnapshot({
        runId,
        sessionId: sessionRefs.sessionId,
        sessionKey: sessionRefs.sessionKey,
      });
    },
  );
}
