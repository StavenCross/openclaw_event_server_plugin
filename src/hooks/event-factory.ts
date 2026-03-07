import { v4 as uuidv4 } from 'uuid';
import { EventCategory, EventError, EventSource, EventType, OpenClawEvent } from '../events/types';
import { PLUGIN_VERSION } from '../version';
const EVENT_SCHEMA_VERSION = '1.1.0';

export interface CanonicalEventInput {
  type: EventType;
  eventCategory: EventCategory;
  eventName: string;
  source: EventSource;
  agentId?: string;
  agentName?: string;
  sessionId?: string;
  sessionKey?: string;
  sessionName?: string;
  runId?: string;
  toolCallId?: string;
  correlationId?: string;
  result?: unknown;
  error?: EventError;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export function createCanonicalEvent(input: CanonicalEventInput): OpenClawEvent {
  return {
    eventId: uuidv4(),
    schemaVersion: EVENT_SCHEMA_VERSION,
    type: input.type,
    eventCategory: input.eventCategory,
    eventName: input.eventName,
    source: input.source,
    timestamp: new Date().toISOString(),
    agentId: input.agentId,
    agentName: input.agentName,
    sessionId: input.sessionId,
    sessionKey: input.sessionKey,
    sessionName: input.sessionName,
    runId: input.runId,
    toolCallId: input.toolCallId,
    correlationId: input.correlationId ?? uuidv4(),
    result: input.result,
    error: input.error,
    pluginVersion: PLUGIN_VERSION,
    data: input.data ?? {},
    metadata: input.metadata,
  };
}
