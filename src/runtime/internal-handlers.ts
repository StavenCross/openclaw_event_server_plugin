import {
  fromOpenClawMessagePreprocessed,
  fromOpenClawMessageReceived,
  fromOpenClawMessageSent,
  fromOpenClawMessageTranscribed,
} from '../hooks/message-hooks';
import { createCommandEvent } from '../hooks/command-hooks';
import {
  createAgentBootstrapEvent,
  createAgentErrorEvent,
  createAgentSessionEvent,
} from '../hooks/agent-hooks';
import { createGatewayStartupEvent } from '../hooks/gateway-hooks';
import { PluginState } from './types';
import { observeSessionProvenance } from './provenance';
import { RuntimeEventOps } from './runtime-events';
import {
  classifyAgentError,
  isRecord,
  readNumber,
  readObject,
  readString,
  resolveAgentId,
  resolveSessionRefs,
} from './utils';

interface InternalHandlersDeps {
  state: PluginState;
  ops: RuntimeEventOps;
}

export function createInternalHandlers(deps: InternalHandlersDeps) {
  const { state, ops } = deps;

  async function handleMessageReceived(hookEvent: unknown): Promise<void> {
    const event = fromOpenClawMessageReceived(hookEvent);
    if (!event) {
      return;
    }

    await ops.broadcastEvent(event);
    const raw = isRecord(hookEvent) ? hookEvent : undefined;
    const sessionRefs = resolveSessionRefs(raw);
    const agentId = resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, sessionRefs });
    observeSessionProvenance({
      sessionTracker: state.sessionTracker,
      sessionRefs,
      hookEvent: raw,
      agentId,
      direction: 'inbound',
    });
    await ops.emitAgentActivity({
      agentId,
      sessionId: event.sessionId ?? sessionRefs.sessionId,
      sessionKey: event.sessionKey ?? sessionRefs.sessionKey,
      correlationId: event.correlationId,
      sourceEventType: 'message.received',
      activity: 'Message Received',
      activityDetail: 'Inbound message accepted by agent pipeline',
    });
  }

  async function handleMessageTranscribed(hookEvent: unknown): Promise<void> {
    const event = fromOpenClawMessageTranscribed(hookEvent);
    if (!event) {
      return;
    }

    await ops.broadcastEvent(event);
    const raw = isRecord(hookEvent) ? hookEvent : undefined;
    const sessionRefs = resolveSessionRefs(raw);
    const agentId = resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, sessionRefs });
    observeSessionProvenance({
      sessionTracker: state.sessionTracker,
      sessionRefs,
      hookEvent: raw,
      agentId,
      direction: 'inbound',
    });
    await ops.emitAgentActivity({
      agentId,
      sessionId: event.sessionId ?? sessionRefs.sessionId,
      sessionKey: event.sessionKey ?? sessionRefs.sessionKey,
      correlationId: event.correlationId,
      sourceEventType: 'message.transcribed',
      activity: 'Transcribing Message',
      activityDetail: 'Inbound message transcription completed',
    });
  }

  async function handleMessagePreprocessed(hookEvent: unknown): Promise<void> {
    const event = fromOpenClawMessagePreprocessed(hookEvent);
    if (!event) {
      return;
    }

    await ops.broadcastEvent(event);
    const raw = isRecord(hookEvent) ? hookEvent : undefined;
    const sessionRefs = resolveSessionRefs(raw);
    const agentId = resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, sessionRefs });
    observeSessionProvenance({
      sessionTracker: state.sessionTracker,
      sessionRefs,
      hookEvent: raw,
      agentId,
      direction: 'inbound',
    });
    await ops.emitAgentActivity({
      agentId,
      sessionId: event.sessionId ?? sessionRefs.sessionId,
      sessionKey: event.sessionKey ?? sessionRefs.sessionKey,
      correlationId: event.correlationId,
      sourceEventType: 'message.preprocessed',
      activity: 'Processing Message',
      activityDetail: 'Inbound message preprocessing complete',
    });
  }

  async function handleMessageSent(hookEvent: unknown): Promise<void> {
    const event = fromOpenClawMessageSent(hookEvent);
    if (!event) {
      return;
    }

    await ops.broadcastEvent(event);
    const raw = isRecord(hookEvent) ? hookEvent : undefined;
    const sessionRefs = resolveSessionRefs(raw);
    const agentId = resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, sessionRefs });
    observeSessionProvenance({
      sessionTracker: state.sessionTracker,
      sessionRefs,
      hookEvent: raw,
      agentId,
      direction: 'outbound',
    });
    await ops.emitAgentActivity({
      agentId,
      sessionId: event.sessionId ?? sessionRefs.sessionId,
      sessionKey: event.sessionKey ?? sessionRefs.sessionKey,
      correlationId: event.correlationId,
      sourceEventType: 'message.sent',
      activity: 'Response Sent',
      activityDetail: 'Outbound message delivered',
    });
  }

  async function handleCommand(action: 'new' | 'reset' | 'stop', hookEvent: unknown): Promise<void> {
    const raw = isRecord(hookEvent) ? hookEvent : {};
    const context = readObject(raw.context) ?? {};
    const sessionRefs = resolveSessionRefs(raw);
    const agentId = resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, sessionRefs });
    const typeMap = {
      new: 'command.new',
      reset: 'command.reset',
      stop: 'command.stop',
    } as const;

    const commandEvent = createCommandEvent({
      type: typeMap[action],
      sessionId: sessionRefs.sessionId,
      sessionKey: sessionRefs.sessionKey,
      agentId,
      commandSource: readString(context.commandSource),
      senderId: readString(context.senderId),
      data: context,
    });
    observeSessionProvenance({
      sessionTracker: state.sessionTracker,
      sessionRefs,
      hookEvent: raw,
      agentId,
      direction: 'internal',
    });
    await ops.broadcastEvent(commandEvent);

    if (!agentId) {
      return;
    }

    await ops.emitAgentActivity({
      agentId,
      sessionId: sessionRefs.sessionId,
      sessionKey: sessionRefs.sessionKey,
      correlationId: commandEvent.correlationId,
      sourceEventType: typeMap[action],
      activity: `Command ${action.toUpperCase()}`,
      activityDetail: `Processed /${action} command`,
    });
  }

  async function handleAgentBootstrap(hookEvent: unknown): Promise<void> {
    const raw = isRecord(hookEvent) ? hookEvent : {};
    const context = readObject(raw.context) ?? {};
    const sessionRefs = resolveSessionRefs(raw);
    const agentId = resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, sessionRefs });
    const bootstrapEvent = createAgentBootstrapEvent({
      sessionId: sessionRefs.sessionId,
      sessionKey: sessionRefs.sessionKey,
      agentId,
      data: context,
    });
    observeSessionProvenance({
      sessionTracker: state.sessionTracker,
      sessionRefs,
      hookEvent: raw,
      agentId,
      direction: 'internal',
    });
    await ops.broadcastEvent(bootstrapEvent);

    if (!agentId) {
      return;
    }

    await ops.emitAgentActivity({
      agentId,
      sessionId: sessionRefs.sessionId,
      sessionKey: sessionRefs.sessionKey,
      correlationId: bootstrapEvent.correlationId,
      sourceEventType: 'agent.bootstrap',
      activity: 'Bootstrapping',
      activityDetail: 'Agent bootstrap hook executed',
    });
  }

  async function handleAgentError(hookEvent: unknown): Promise<void> {
    const raw = isRecord(hookEvent) ? hookEvent : {};
    const context = readObject(raw.context) ?? {};
    const sessionRefs = resolveSessionRefs(raw);
    const agentId = resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, sessionRefs });
    const message =
      readString(context.error) ??
      readString(raw.error) ??
      readString(context.message) ??
      'Agent error';
    const errorEvent = createAgentErrorEvent({
      sessionId: sessionRefs.sessionId,
      sessionKey: sessionRefs.sessionKey,
      agentId,
      error: message,
      stack: readString(context.stack) ?? readString(raw.stack),
      data: context,
    });
    observeSessionProvenance({
      sessionTracker: state.sessionTracker,
      sessionRefs,
      hookEvent: raw,
      agentId,
      direction: 'internal',
    });
    await ops.broadcastEvent(errorEvent);

    if (!agentId) {
      return;
    }

    const classification = classifyAgentError(message);
    if (classification === 'offline') {
      state.statusReducer.markAgentOffline(agentId, true);
    } else {
      state.statusReducer.markAgentError(agentId, true);
    }
    await ops.emitAgentStatusTransitions('agent.error');
  }

  async function handleAgentSessionEvent(
    type: 'agent.session_start' | 'agent.session_end',
    hookEvent: unknown,
  ): Promise<void> {
    const raw = isRecord(hookEvent) ? hookEvent : {};
    const context = readObject(raw.context) ?? {};
    const sessionRefs = resolveSessionRefs(raw);
    const agentId = resolveAgentId({ sessionTracker: state.sessionTracker, hookEvent: raw, sessionRefs });

    const event = createAgentSessionEvent({
      type,
      sessionId: sessionRefs.sessionId,
      sessionKey: sessionRefs.sessionKey,
      agentId,
      data: context,
    });
    observeSessionProvenance({
      sessionTracker: state.sessionTracker,
      sessionRefs,
      hookEvent: raw,
      agentId,
      direction: 'internal',
    });
    await ops.broadcastEvent(event);

    if (!agentId) {
      return;
    }

    await ops.emitAgentActivity({
      agentId,
      sessionId: sessionRefs.sessionId,
      sessionKey: sessionRefs.sessionKey,
      correlationId: event.correlationId,
      sourceEventType: type,
      activity: type === 'agent.session_start' ? 'Agent Session Start' : 'Agent Session End',
      activityDetail:
        type === 'agent.session_start'
          ? 'Agent session lifecycle started'
          : 'Agent session lifecycle ended',
    });
  }

  async function handleGatewayStartup(hookEvent: unknown): Promise<void> {
    const raw = isRecord(hookEvent) ? hookEvent : {};
    const context = readObject(raw.context) ?? {};
    const event = createGatewayStartupEvent({
      port: readNumber(context.port),
      data: context,
    });
    await ops.broadcastEvent(event);
    ops.maybeInitializeQueue();
  }

  return {
    handleMessageReceived,
    handleMessageTranscribed,
    handleMessagePreprocessed,
    handleMessageSent,
    handleCommand,
    handleAgentBootstrap,
    handleAgentError,
    handleAgentSessionEvent,
    handleGatewayStartup,
  };
}

export type InternalHandlers = ReturnType<typeof createInternalHandlers>;
