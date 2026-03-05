/**
 * Session and identity tracking helpers.
 */

import { SessionEvent } from '../events/types';
import { createCanonicalEvent } from './event-factory';

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

type SessionRecord = {
  startTime: number;
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  parentSessionId?: string;
};

/**
 * Tracks active sessions and helper maps for identity resolution.
 */
export class SessionTracker {
  private bySessionKey: Map<string, SessionRecord> = new Map();
  private bySessionId: Map<string, SessionRecord> = new Map();

  startSession(
    sessionKey: string,
    agentId?: string,
    parentSessionId?: string,
  ): void;
  startSession(params: {
    sessionId?: string;
    sessionKey?: string;
    agentId?: string;
    parentSessionId?: string;
  }): void;
  startSession(
    input:
      | string
      | {
          sessionId?: string;
          sessionKey?: string;
          agentId?: string;
          parentSessionId?: string;
        },
    agentIdArg?: string,
    parentSessionIdArg?: string,
  ): void {
    if (typeof input !== 'string' && (!input || typeof input !== 'object')) {
      throw new Error('Session key must be a non-empty string');
    }

    const params = (typeof input === 'string'
      ? {
          sessionKey: input,
          sessionId: undefined,
          agentId: agentIdArg,
          parentSessionId: parentSessionIdArg,
        }
      : input) as {
      sessionId?: string;
      sessionKey?: string;
      agentId?: string;
      parentSessionId?: string;
    };

    const hasSessionKey = typeof params.sessionKey === 'string' && params.sessionKey.trim().length > 0;
    const hasSessionId = typeof params.sessionId === 'string' && params.sessionId.trim().length > 0;
    if (!hasSessionId && !hasSessionKey) {
      throw new Error('Session key must be a non-empty string');
    }
    const record: SessionRecord = {
      startTime: Date.now(),
      agentId: params.agentId,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      parentSessionId: params.parentSessionId,
    };
    if (params.sessionKey) {
      this.bySessionKey.set(params.sessionKey, record);
    }
    if (params.sessionId) {
      this.bySessionId.set(params.sessionId, record);
    }
  }

  touchSession(params: {
    sessionId?: string;
    sessionKey?: string;
    agentId?: string;
  }): void {
    const current = this.getRecord(params.sessionId ?? params.sessionKey);
    if (current) {
      if (params.agentId && !current.agentId) {
        current.agentId = params.agentId;
      }
      if (params.sessionId && !current.sessionId) {
        current.sessionId = params.sessionId;
        this.bySessionId.set(params.sessionId, current);
      }
      if (params.sessionKey && !current.sessionKey) {
        current.sessionKey = params.sessionKey;
        this.bySessionKey.set(params.sessionKey, current);
      }
      return;
    }

    if (params.sessionId !== undefined || params.sessionKey !== undefined) {
      this.startSession({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        agentId: params.agentId,
      });
    }
  }

  endSession(sessionIdentifier: string): {
    durationMs: number;
    agentId?: string;
    sessionId?: string;
    sessionKey?: string;
    parentSessionId?: string;
  } | null {
    const record = this.getRecord(sessionIdentifier);
    if (!record) {
      return null;
    }

    if (record.sessionId) {
      this.bySessionId.delete(record.sessionId);
    }
    if (record.sessionKey) {
      this.bySessionKey.delete(record.sessionKey);
    }

    return {
      durationMs: Date.now() - record.startTime,
      agentId: record.agentId,
      sessionId: record.sessionId,
      sessionKey: record.sessionKey,
      parentSessionId: record.parentSessionId,
    };
  }

  private getRecord(sessionIdentifier?: string): SessionRecord | null {
    if (!sessionIdentifier) {
      return null;
    }
    return this.bySessionId.get(sessionIdentifier) ?? this.bySessionKey.get(sessionIdentifier) ?? null;
  }

  getSession(sessionIdentifier?: string): {
    agentId?: string;
    parentSessionId?: string;
    durationMs: number;
    sessionId?: string;
    sessionKey?: string;
  } | null {
    const record = this.getRecord(sessionIdentifier);
    if (!record) {
      return null;
    }
    return {
      agentId: record.agentId,
      parentSessionId: record.parentSessionId,
      durationMs: Date.now() - record.startTime,
      sessionId: record.sessionId,
      sessionKey: record.sessionKey,
    };
  }

  getAgentIdBySession(params: { sessionId?: string; sessionKey?: string }): string | undefined {
    if (params.sessionId) {
      const byId = this.bySessionId.get(params.sessionId);
      if (byId?.agentId) {
        return byId.agentId;
      }
    }
    if (params.sessionKey) {
      return this.bySessionKey.get(params.sessionKey)?.agentId;
    }
    return undefined;
  }

  getActiveSessions(): string[] {
    const sessions = new Set<string>();
    for (const key of this.bySessionKey.keys()) {
      sessions.add(key);
    }
    for (const key of this.bySessionId.keys()) {
      sessions.add(key);
    }
    return Array.from(sessions);
  }

  getActiveSessionCount(): number {
    const records = new Set<SessionRecord>();
    for (const value of this.bySessionId.values()) {
      records.add(value);
    }
    for (const value of this.bySessionKey.values()) {
      records.add(value);
    }
    return records.size;
  }

  clear(): void {
    this.bySessionId.clear();
    this.bySessionKey.clear();
  }
}
