import { type TransportConfig } from '../config';
import { type OpenClawEvent } from '../events/types';
import { type RuntimeLogger } from '../runtime/types';
import { buildSemanticKey } from './protocol';

/**
 * Removes expired event-id and semantic dedupe markers before a new event is
 * evaluated. Keeping this logic centralized makes it easier to reason about
 * which owner-runtime events are still eligible for suppression.
 */
export function pruneTransportDedupeEntries(params: {
  now: number;
  seenEventIds: Map<string, number>;
  seenSemanticKeys: Map<string, number>;
}): void {
  const { now, seenEventIds, seenSemanticKeys } = params;

  for (const [key, expiresAt] of seenEventIds) {
    if (expiresAt <= now) {
      seenEventIds.delete(key);
    }
  }

  for (const [key, expiresAt] of seenSemanticKeys) {
    if (expiresAt <= now) {
      seenSemanticKeys.delete(key);
    }
  }
}

/**
 * Applies both eventId-based dedupe and the optional semantic dedupe pass that
 * collapses equivalent relay payloads. Returning false means the owner runtime
 * has already processed an equivalent event inside the configured TTL window.
 */
export function shouldProcessTransportEvent(params: {
  config: TransportConfig;
  event: OpenClawEvent;
  logger: RuntimeLogger;
  now: number;
  seenEventIds: Map<string, number>;
  seenSemanticKeys: Map<string, number>;
}): boolean {
  const { config, event, logger, now, seenEventIds, seenSemanticKeys } = params;

  pruneTransportDedupeEntries({ now, seenEventIds, seenSemanticKeys });

  if (seenEventIds.has(event.eventId)) {
    logger.debug('[Transport] Dropping duplicate relayed eventId', event.eventId);
    return false;
  }
  seenEventIds.set(event.eventId, now + config.dedupeTtlMs);

  if (!config.semanticDedupeEnabled) {
    return true;
  }

  const semanticKey = buildSemanticKey(event);
  if (!semanticKey) {
    return true;
  }

  if (seenSemanticKeys.has(semanticKey)) {
    logger.debug('[Transport] Dropping duplicate semantic event', semanticKey);
    return false;
  }

  seenSemanticKeys.set(semanticKey, now + config.dedupeTtlMs);
  return true;
}
