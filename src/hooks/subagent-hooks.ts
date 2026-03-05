import { SubagentEvent } from '../events/types';
import { createCanonicalEvent } from './event-factory';

export function createSubagentSpawningEvent(context: {
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  childSessionKey?: string;
  data?: Record<string, unknown>;
}): SubagentEvent {
  return createCanonicalEvent({
    type: 'subagent.spawning',
    eventCategory: 'subagent',
    eventName: 'subagent_spawning',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    data: {
      childSessionKey: context.childSessionKey,
      ...(context.data ?? {}),
    },
  });
}

export function createSubagentSpawnedEvent(context: {
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  childSessionKey?: string;
  data?: Record<string, unknown>;
}): SubagentEvent {
  return createCanonicalEvent({
    type: 'subagent.spawned',
    eventCategory: 'subagent',
    eventName: 'subagent_spawned',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    data: {
      childSessionKey: context.childSessionKey,
      ...(context.data ?? {}),
    },
  });
}

export function createSubagentEndedEvent(context: {
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  childSessionKey?: string;
  data?: Record<string, unknown>;
}): SubagentEvent {
  return createCanonicalEvent({
    type: 'subagent.ended',
    eventCategory: 'subagent',
    eventName: 'subagent_ended',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    data: {
      childSessionKey: context.childSessionKey,
      ...(context.data ?? {}),
    },
  });
}

export function createSubagentIdleEvent(context: {
  parentAgentId?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  childAgentId?: string;
  childSessionKey: string;
  runId?: string;
  mode?: string;
  idleForMs: number;
  lastActiveAt: string;
}): SubagentEvent {
  return createCanonicalEvent({
    type: 'subagent.idle',
    eventCategory: 'synthetic',
    eventName: 'subagent.idle',
    source: 'synthetic',
    agentId: context.childAgentId ?? context.parentAgentId,
    sessionId: context.parentSessionId,
    sessionKey: context.parentSessionKey,
    runId: context.runId,
    data: {
      subagentKey: context.childSessionKey,
      parentAgentId: context.parentAgentId,
      parentSessionId: context.parentSessionId,
      parentSessionKey: context.parentSessionKey,
      childAgentId: context.childAgentId,
      childSessionKey: context.childSessionKey,
      mode: context.mode,
      idleForMs: context.idleForMs,
      lastActiveAt: context.lastActiveAt,
    },
  });
}
