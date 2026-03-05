/**
 * Agent event builders.
 */

import { AgentEvent, AgentSyntheticStatus, EventType } from '../events/types';
import { createCanonicalEvent } from './event-factory';

export function createAgentStatusEvent(context: {
  agentId: string;
  status: AgentSyntheticStatus;
  activity?: string;
  activityDetail?: string;
  sessionId?: string;
  sessionKey?: string;
  correlationId?: string;
  sourceEventType?: EventType;
  metadata?: Record<string, unknown>;
}): AgentEvent {
  return createCanonicalEvent({
    type: 'agent.status',
    eventCategory: 'synthetic',
    eventName: 'agent.status',
    source: 'synthetic',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    correlationId: context.correlationId,
    data: {
      agentId: context.agentId,
      status: context.status,
      activity: context.activity,
      activityDetail: context.activityDetail,
      sourceEventType: context.sourceEventType,
    },
    metadata: context.metadata,
  });
}

export function createAgentActivityEvent(context: {
  agentId: string;
  activity: string;
  activityDetail?: string;
  sessionId?: string;
  sessionKey?: string;
  correlationId?: string;
  sourceEventType?: EventType;
  toolName?: string;
  toolStatus?: 'called' | 'completed' | 'error';
  metadata?: Record<string, unknown>;
}): AgentEvent {
  return createCanonicalEvent({
    type: 'agent.activity',
    eventCategory: 'synthetic',
    eventName: 'agent.activity',
    source: 'synthetic',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    correlationId: context.correlationId,
    data: {
      agentId: context.agentId,
      activity: context.activity,
      activityDetail: context.activityDetail,
      sourceEventType: context.sourceEventType,
      toolName: context.toolName,
      toolStatus: context.toolStatus,
    },
    metadata: context.metadata,
  });
}

export function createAgentBootstrapEvent(context: {
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  data?: Record<string, unknown>;
}): AgentEvent {
  return createCanonicalEvent({
    type: 'agent.bootstrap',
    eventCategory: 'agent',
    eventName: 'agent:bootstrap',
    source: 'internal-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    data: context.data ?? {},
  });
}

export function createAgentErrorEvent(context: {
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  error: string;
  stack?: string;
  data?: Record<string, unknown>;
}): AgentEvent {
  return createCanonicalEvent({
    type: 'agent.error',
    eventCategory: 'agent',
    eventName: 'agent:error',
    source: 'internal-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    error: {
      message: context.error,
      stack: context.stack,
      kind: 'agent',
    },
    data: context.data ?? {},
  });
}

export function createAgentSessionEvent(context: {
  type: 'agent.session_start' | 'agent.session_end';
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  data?: Record<string, unknown>;
}): AgentEvent {
  return createCanonicalEvent({
    type: context.type,
    eventCategory: 'agent',
    eventName: context.type === 'agent.session_start' ? 'agent:session:start' : 'agent:session:end',
    source: 'internal-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    data: context.data ?? {},
  });
}

export function createAgentSubAgentSpawnEvent(context: {
  parentAgentId?: string;
  childAgentId?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  childSessionKey?: string;
  runId?: string;
  mode?: string;
  data?: Record<string, unknown>;
}): AgentEvent {
  return createCanonicalEvent({
    type: 'agent.sub_agent_spawn',
    eventCategory: 'synthetic',
    eventName: 'agent.sub_agent_spawn',
    source: 'synthetic',
    agentId: context.parentAgentId,
    sessionId: context.parentSessionId,
    sessionKey: context.parentSessionKey,
    runId: context.runId,
    data: {
      parentAgentId: context.parentAgentId,
      childAgentId: context.childAgentId,
      parentSessionId: context.parentSessionId,
      parentSessionKey: context.parentSessionKey,
      childSessionKey: context.childSessionKey,
      mode: context.mode,
      ...(context.data ?? {}),
    },
  });
}

