/**
 * Session and identity tracking helpers.
 */

import { SessionEvent } from '../events/types';
import { createCanonicalEvent } from './event-factory';
export { SessionTracker } from './session-tracker';

export function createSessionStartEvent(context: {
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  resumedFrom?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}): SessionEvent {
  return createCanonicalEvent({
    type: 'session.start',
    eventCategory: 'session',
    eventName: 'session_start',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    correlationId: context.correlationId,
    data: {
      sessionId: context.sessionId,
      sessionKey: context.sessionKey,
      agentId: context.agentId,
      resumedFrom: context.resumedFrom,
      ...context.metadata,
    },
  });
}

export function createSessionEndEvent(context: {
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  messageCount?: number;
  durationMs?: number;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}): SessionEvent {
  return createCanonicalEvent({
    type: 'session.end',
    eventCategory: 'session',
    eventName: 'session_end',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    correlationId: context.correlationId,
    data: {
      sessionId: context.sessionId,
      sessionKey: context.sessionKey,
      agentId: context.agentId,
      messageCount: context.messageCount,
      durationMs: context.durationMs,
      ...context.metadata,
    },
  });
}

// Legacy compatibility aliases retained for existing consumers/tests.
export function createSessionSpawnedEvent(context: {
  sessionKey: string;
  parentSessionId?: string;
  agentId?: string;
  workspaceDir?: string;
  channel?: string;
  requester?: string;
  sessionId?: string;
  correlationId?: string;
}): SessionEvent {
  return createCanonicalEvent({
    type: 'session.spawned',
    eventCategory: 'session',
    eventName: 'session_start',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId ?? context.sessionKey,
    sessionKey: context.sessionKey,
    correlationId: context.correlationId,
    data: {
      sessionKey: context.sessionKey,
      parentSessionId: context.parentSessionId,
      agentId: context.agentId,
      metadata: {
        workspaceDir: context.workspaceDir,
        channel: context.channel,
        requester: context.requester,
      },
    },
  });
}

export function createSessionCompletedEvent(context: {
  sessionKey: string;
  parentSessionId?: string;
  agentId?: string;
  sessionId?: string;
  correlationId?: string;
}): SessionEvent {
  return createCanonicalEvent({
    type: 'session.completed',
    eventCategory: 'session',
    eventName: 'session_end',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId ?? context.sessionKey,
    sessionKey: context.sessionKey,
    correlationId: context.correlationId,
    data: {
      sessionKey: context.sessionKey,
      parentSessionId: context.parentSessionId,
      agentId: context.agentId,
    },
  });
}

export function createSessionErrorEvent(context: {
  sessionKey: string;
  error: string;
  stackTrace?: string;
  parentSessionId?: string;
  agentId?: string;
  sessionId?: string;
  correlationId?: string;
}): SessionEvent {
  return createCanonicalEvent({
    type: 'session.error',
    eventCategory: 'session',
    eventName: 'session_end',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId ?? context.sessionKey,
    sessionKey: context.sessionKey,
    correlationId: context.correlationId,
    error: {
      message: context.error,
      stack: context.stackTrace,
      kind: 'agent',
    },
    data: {
      sessionKey: context.sessionKey,
      parentSessionId: context.parentSessionId,
      agentId: context.agentId,
      error: context.error,
      stackTrace: context.stackTrace,
    },
  });
}
