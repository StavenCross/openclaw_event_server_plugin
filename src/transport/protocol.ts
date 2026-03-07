import { hostname } from 'node:os';
import { OpenClawEvent } from '../events/types';

export type TransportRole = 'owner' | 'follower';

export type RelayEnvelope = {
  authToken?: string;
  event: OpenClawEvent;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isOpenClawEvent(value: unknown): value is OpenClawEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.eventId === 'string' &&
    typeof value.type === 'string' &&
    typeof value.timestamp === 'string' &&
    typeof value.pluginVersion === 'string' &&
    isRecord(value.data)
  );
}

export function serializeEnvelope(envelope: RelayEnvelope): string {
  return `${JSON.stringify(envelope)}\n`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (!isRecord(value)) {
    return JSON.stringify(value);
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(',')}}`;
}

export function buildSemanticKey(event: OpenClawEvent): string | undefined {
  const meaningfulValues = [
    event.correlationId,
    event.toolCallId,
    event.runId,
    event.sessionId,
    event.sessionKey,
    event.agentId,
  ].filter((value): value is string => typeof value === 'string' && value.trim() !== '');

  if (meaningfulValues.length === 0) {
    return undefined;
  }

  return [
    event.type,
    event.eventName ?? '',
    event.correlationId ?? '',
    event.toolCallId ?? '',
    event.runId ?? '',
    event.sessionId ?? '',
    event.sessionKey ?? '',
    event.agentId ?? '',
    stableStringify(event.data),
    stableStringify(event.error),
    stableStringify(event.result),
  ].join('|');
}

/**
 * Preserve the original emitter identity while the owner annotates the route it
 * took to transport the event.
 */
export function cloneEventWithTransportMetadata(
  event: OpenClawEvent,
  params: {
    runtimeId: string;
    role: TransportRole;
    route: 'local' | 'relay';
    ownerRuntimeId?: string;
  },
): OpenClawEvent {
  const existingMetadata = isRecord(event.metadata) ? event.metadata : {};
  const existingTransport = isRecord(existingMetadata.transport) ? existingMetadata.transport : {};

  return {
    ...event,
    metadata: {
      ...existingMetadata,
      transport: {
        ...existingTransport,
        runtimeId: existingTransport.runtimeId ?? params.runtimeId,
        pid: existingTransport.pid ?? process.pid,
        hostname: existingTransport.hostname ?? hostname(),
        emittedByRole: existingTransport.emittedByRole ?? params.role,
        route: params.route,
        ...(params.ownerRuntimeId ? { ownerRuntimeId: params.ownerRuntimeId } : {}),
      },
    },
  };
}
