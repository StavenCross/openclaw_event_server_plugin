import { type TransportConfig } from '../config';
import { logTransportInfo } from './log-context';
import { type TransportLockAcquireResult } from './ownership';
import { type TransportRole } from './protocol';
import { type RuntimeLogger } from '../runtime/types';

/**
 * The live-owner recovery backoff deliberately respects both the heartbeat and
 * lock-staleness windows so contenders do not hammer the lock file while a
 * healthy owner is still refreshing it.
 */
export function getLiveOwnerRecoveryDelayMs(config: TransportConfig): number {
  return Math.max(
    config.reconnectBackoffMs,
    Math.min(config.lockStaleMs, Math.max(config.heartbeatMs, 1000)),
  );
}

/**
 * Normalizes lock-acquisition failures into the transport-manager state updates
 * needed for later recovery attempts. Returning the next delay keeps the class
 * logic small while preserving the same structured logging context.
 */
export function resolveOwnerAcquireFailure(params: {
  config: TransportConfig;
  logger: RuntimeLogger;
  pendingEvents: number;
  result: Exclude<TransportLockAcquireResult, { acquired: true }>;
  role: TransportRole;
  runtimeId: string;
  previousConflictKey?: string;
}): { lastLiveOwnerConflictKey?: string; nextOwnerRecoveryDelayMs: number } {
  const { config, logger, pendingEvents, result, role, runtimeId, previousConflictKey } = params;

  if (result.reason !== 'live_owner') {
    return {
      lastLiveOwnerConflictKey: undefined,
      nextOwnerRecoveryDelayMs: config.reconnectBackoffMs,
    };
  }

  const conflictKey = `${result.existingLock.runtimeId}:${result.existingLock.pid}`;
  if (previousConflictKey !== conflictKey) {
    logTransportInfo(
      logger,
      '[Transport] Transport lock is still owned by a live runtime; owner takeover skipped',
      {
        config,
        runtimeId,
        role,
        pendingEvents,
        reason: 'existing transport owner is still alive',
        extra: {
          previousRuntimeId: result.existingLock.runtimeId,
          previousPid: result.existingLock.pid,
          previousUpdatedAt: result.existingLock.updatedAt,
          lockAgeMs: Date.now() - result.existingLock.updatedAt,
        },
      },
    );
  }

  return {
    lastLiveOwnerConflictKey: conflictKey,
    nextOwnerRecoveryDelayMs: getLiveOwnerRecoveryDelayMs(config),
  };
}
