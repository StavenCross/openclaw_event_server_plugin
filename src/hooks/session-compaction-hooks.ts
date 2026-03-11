/**
 * Session compaction hook builders.
 *
 * Compaction acts on a session transcript first and is only secondarily an
 * agent concern, so these events remain in the session family while still
 * carrying agent identity when available.
 */

import { SessionEvent } from '../events/types';
import { createCanonicalEvent } from './event-factory';
import {
  buildAfterCompactionData,
  buildBeforeCompactionData,
} from './modern-lifecycle-payloads';
import type { ModernLifecyclePrivacyConfig } from '../config';

export function createBeforeCompactionEvent(context: {
  messageCount: number;
  compactingCount?: number;
  tokenCount?: number;
  messages?: unknown[];
  sessionFile?: string;
  privacy: ModernLifecyclePrivacyConfig;
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}): SessionEvent {
  return createCanonicalEvent({
    type: 'session.before_compaction',
    eventCategory: 'session',
    eventName: 'before_compaction',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    correlationId: context.correlationId,
    data: buildBeforeCompactionData({
      messageCount: context.messageCount,
      compactingCount: context.compactingCount,
      tokenCount: context.tokenCount,
      messages: context.messages,
      sessionFile: context.sessionFile,
      privacy: context.privacy,
    }),
    metadata: context.metadata,
  });
}

export function createAfterCompactionEvent(context: {
  messageCount: number;
  compactedCount: number;
  tokenCount?: number;
  sessionFile?: string;
  privacy: ModernLifecyclePrivacyConfig;
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}): SessionEvent {
  return createCanonicalEvent({
    type: 'session.after_compaction',
    eventCategory: 'session',
    eventName: 'after_compaction',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    correlationId: context.correlationId,
    data: buildAfterCompactionData({
      messageCount: context.messageCount,
      compactedCount: context.compactedCount,
      tokenCount: context.tokenCount,
      sessionFile: context.sessionFile,
      privacy: context.privacy,
    }),
    metadata: context.metadata,
  });
}
