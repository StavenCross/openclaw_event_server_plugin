import { EventQueue, broadcastToWebhooks } from '../broadcast';
import { broadcastEvent as broadcastWebSocket } from '../broadcast/websocketServer';
import { shouldFilterEvent } from '../config';
import { redactEvent } from '../events/redaction';
import { signEvent } from '../events/signing';
import { EventType, OpenClawEvent } from '../events/types';
import { createAgentActivityEvent, createAgentStatusEvent } from '../hooks/agent-hooks';
import { createSubagentIdleEvent } from '../hooks/subagent-hooks';
import { PluginState, RuntimeLogger } from './types';
import {
  EmitAgentActivityParams,
  getEventChannelId,
  getEventToolName,
  normalizeError,
  resolveSessionRefForStatus,
} from './utils';

async function transportEvent(state: PluginState, logger: RuntimeLogger, event: OpenClawEvent): Promise<void> {
  // Hook bridge rules should evaluate against canonical event payload before
  // transport-level redaction/signing so rule predicates remain functional.
  if (state.hookBridge) {
    try {
      state.hookBridge.onEvent(event);
    } catch (error) {
      logger.error('Hook bridge dispatch failed:', event.type, normalizeError(error).message);
    }
  }

  const redactedEvent = redactEvent(event, state.config.redaction);
  const outboundEvent = signEvent(redactedEvent, state.config.security.hmac);
  await state.eventFileLoggerReady?.catch(() => undefined);
  state.eventFileLogger?.logEvent(outboundEvent);

  if (state.websocketEnabled) {
    broadcastWebSocket(outboundEvent);
  }

  if (state.config.webhooks.length === 0) {
    logger.debug('No webhooks configured, WebSocket broadcast only');
    return;
  }

  const channelId = getEventChannelId(event);
  const toolName = getEventToolName(event);
  const sessionId = event.sessionId;

  if (shouldFilterEvent(state.config, event.type, channelId, toolName, sessionId)) {
    logger.debug('Event filtered out for HTTP webhooks:', event.type);
    return;
  }

  if (state.queue) {
    state.queue.enqueue(outboundEvent);
    logger.queue('Event queued:', outboundEvent.type, outboundEvent.eventId);
    return;
  }

  try {
    const results = await broadcastToWebhooks(
      outboundEvent,
      state.config.webhooks,
      state.config.retry,
      state.config.webhookTimeoutMs,
      state.config.correlationIdHeader,
    );
    const successCount = results.filter((result) => result.success).length;
    if (state.config.logging.logSuccess && successCount > 0) {
      logger.info('Event broadcast successfully:', event.type, event.eventId);
    }
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('Failed to broadcast event:', event.type, normalized.message);
  }
}

async function broadcastEvent(state: PluginState, logger: RuntimeLogger, event: OpenClawEvent): Promise<void> {
  if (state.transportManager) {
    await state.transportManager.dispatch(event);
    return;
  }

  await transportEvent(state, logger, event);
}

function maybeInitializeQueue(state: PluginState, logger: RuntimeLogger): void {
  if (state.transportRole === 'follower' || state.queue !== undefined || state.config.webhooks.length === 0) {
    return;
  }

  state.queue = new EventQueue(
    state.config.queue,
    state.config.webhooks,
    state.config.retry,
    state.config.webhookTimeoutMs,
    state.config.correlationIdHeader,
  );
  logger.info('Event queue initialized');
}

async function emitAgentStatusTransitions(
  state: PluginState,
  logger: RuntimeLogger,
  sourceEventType?: EventType,
): Promise<void> {
  const transitions = state.statusReducer.evaluateTransitions();
  for (const transition of transitions) {
    await broadcastEvent(
      state,
      logger,
      createAgentStatusEvent({
        agentId: transition.agentId,
        status: transition.status,
        activity: transition.activity,
        activityDetail: transition.activityDetail,
        sourceEventType,
        metadata: {
          reason: transition.reason,
          activeSessionCount: transition.activeSessionCount,
          lastActiveAt: transition.lastActiveAt,
        },
      }),
    );
  }
}

async function emitSubagentIdleTransitions(
  state: PluginState,
  logger: RuntimeLogger,
  sourceEventType?: EventType,
): Promise<void> {
  const transitions = state.subagentTracker.evaluateIdleTransitions(
    state.config.status.subagentIdleWindowMs,
  );
  for (const transition of transitions) {
    await broadcastEvent(
      state,
      logger,
      createSubagentIdleEvent({
        parentAgentId: transition.parentAgentId,
        parentSessionId: transition.parentSessionId,
        parentSessionKey: transition.parentSessionKey,
        childAgentId: transition.childAgentId,
        childSessionKey: transition.childSessionKey,
        runId: transition.runId,
        mode: transition.mode,
        idleForMs: state.config.status.subagentIdleWindowMs,
        lastActiveAt: new Date(transition.lastActiveAt).toISOString(),
      }),
    );

    const activityAgentId = transition.parentAgentId ?? transition.childAgentId;
    if (!activityAgentId) {
      logger.debug(
        'Skipping agent.activity emission for subagent.idle transition without parent/child agent identity',
        transition.subagentKey,
      );
      continue;
    }

    await broadcastEvent(
      state,
      logger,
      createAgentActivityEvent({
        agentId: activityAgentId,
        sessionId: transition.parentSessionId,
        sessionKey: transition.parentSessionKey,
        sourceEventType: sourceEventType ?? 'subagent.idle',
        activity: 'Subagent Idle',
        activityDetail: `Subagent ${transition.childSessionKey} idle for ${Math.floor(
          state.config.status.subagentIdleWindowMs / 1000,
        )}s`,
        metadata: {
          subagentKey: transition.subagentKey,
          childAgentId: transition.childAgentId,
          childSessionKey: transition.childSessionKey,
          parentAgentId: transition.parentAgentId,
        },
      }),
    );
  }
}

async function emitAgentActivity(
  state: PluginState,
  logger: RuntimeLogger,
  params: EmitAgentActivityParams,
): Promise<void> {
  if (!params.agentId) {
    return;
  }

  const sessionRef = resolveSessionRefForStatus(params.sessionId, params.sessionKey);
  state.statusReducer.observeActivity(params.agentId, sessionRef);
  state.subagentTracker.observeActivity(params.sessionKey);
  state.statusReducer.markAgentError(params.agentId, false);
  state.statusReducer.markAgentOffline(params.agentId, false);

  await broadcastEvent(
    state,
    logger,
    createAgentActivityEvent({
      agentId: params.agentId,
      activity: params.activity,
      activityDetail: params.activityDetail,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      correlationId: params.correlationId,
      sourceEventType: params.sourceEventType,
      toolName: params.toolName,
      toolStatus: params.toolStatus,
      metadata: params.metadata,
    }),
  );

  await emitAgentStatusTransitions(state, logger, params.sourceEventType);
  await emitSubagentIdleTransitions(state, logger, params.sourceEventType);
}

function startStatusTimer(state: PluginState, intervalMs: number, tick: () => void): void {
  if (state.statusTimer) {
    clearInterval(state.statusTimer);
  }
  state.statusTimer = setInterval(() => {
    tick();
  }, intervalMs);
}

function stopStatusTimer(state: PluginState): void {
  if (!state.statusTimer) {
    return;
  }
  clearInterval(state.statusTimer);
  state.statusTimer = undefined;
}

export function createRuntimeEventOps(state: PluginState, logger: RuntimeLogger) {
  return {
    broadcastEvent: (event: OpenClawEvent) => broadcastEvent(state, logger, event),
    transportEvent: (event: OpenClawEvent) => transportEvent(state, logger, event),
    maybeInitializeQueue: () => maybeInitializeQueue(state, logger),
    emitAgentActivity: (params: EmitAgentActivityParams) => emitAgentActivity(state, logger, params),
    emitAgentStatusTransitions: (sourceEventType?: EventType) =>
      emitAgentStatusTransitions(state, logger, sourceEventType),
    emitSubagentIdleTransitions: (sourceEventType?: EventType) =>
      emitSubagentIdleTransitions(state, logger, sourceEventType),
    startStatusTimer: (intervalMs: number, tick: () => void) => startStatusTimer(state, intervalMs, tick),
    stopStatusTimer: () => stopStatusTimer(state),
  };
}

export type RuntimeEventOps = ReturnType<typeof createRuntimeEventOps>;
