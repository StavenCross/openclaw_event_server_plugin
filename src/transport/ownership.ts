import { rmSync, unlinkSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { type TransportConfig } from '../config';
import { type RuntimeLogger } from '../runtime/types';
import {
  isLockStale,
  isProcessAlive,
  readLockPayload,
  overwriteLock,
  removeLockIfOwned,
  writeNewLock,
  type LockFilePayload,
} from './lock';
import { logTransportWarn } from './log-context';
import { type TransportRole } from './protocol';

export type TransportLockAcquireResult =
  | { acquired: true }
  | { acquired: false; reason: 'live_owner'; existingLock: LockFilePayload }
  | { acquired: false; reason: 'busy_lock' }
  | { acquired: false; reason: 'error' };

/**
 * Resolve the ownership lock payload that tells followers which runtime should
 * currently be serving the relay socket.
 */
export function buildLockPayload(runtimeId: string, socketPath: string): LockFilePayload {
  return {
    runtimeId,
    pid: process.pid,
    updatedAt: Date.now(),
    socketPath,
  };
}

/**
 * Acquire the cross-process owner lock, reclaiming it only when it is stale.
 * When acquisition fails because another runtime still owns a healthy lock, log
 * that owner identity explicitly so transport incidents can be correlated to a
 * concrete process instead of a generic "could not acquire lock" warning.
 */
export function acquireTransportLock(params: {
  config: TransportConfig;
  logger: RuntimeLogger;
  runtimeId: string;
  role: TransportRole;
  pendingEvents: number;
}): TransportLockAcquireResult {
  const payload = buildLockPayload(params.runtimeId, params.config.socketPath);

  try {
    writeNewLock(params.config.lockPath, payload);
    return { acquired: true };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'EEXIST') {
      logTransportWarn(params.logger, '[Transport] Failed to acquire transport lock', {
        config: params.config,
        runtimeId: params.runtimeId,
        role: params.role,
        pendingEvents: params.pendingEvents,
        reason: 'lock acquisition threw a non-EEXIST error',
        error: err.message,
      });
      return { acquired: false, reason: 'error' };
    }
  }

  const existingLock = readLockPayload(params.config.lockPath);
  if (existingLock && !isProcessAlive(existingLock.pid)) {
    logTransportWarn(
      params.logger,
      '[Transport] Existing owner lock belongs to a dead PID; reclaiming transport lock immediately',
      {
        config: params.config,
        runtimeId: params.runtimeId,
        role: params.role,
        pendingEvents: params.pendingEvents,
        reason: 'stale lock pid is no longer alive',
        extra: {
          previousRuntimeId: existingLock.runtimeId,
          previousPid: existingLock.pid,
          previousUpdatedAt: existingLock.updatedAt,
        },
      },
    );
  }

  if (existingLock && isProcessAlive(existingLock.pid)) {
    return { acquired: false, reason: 'live_owner', existingLock };
  }

  if (!isLockStale(params.config.lockPath, params.config.lockStaleMs)) {
    return { acquired: false, reason: 'busy_lock' };
  }

  try {
    unlinkSync(params.config.lockPath);
  } catch (error) {
    logTransportWarn(params.logger, '[Transport] Failed to remove stale transport lock before reclaim', {
      config: params.config,
      runtimeId: params.runtimeId,
      role: params.role,
      pendingEvents: params.pendingEvents,
      reason: 'stale lock unlink failed during owner reclaim',
      error: String(error),
      extra: {
        previousRuntimeId: existingLock?.runtimeId,
        previousPid: existingLock?.pid,
      },
    });
    return { acquired: false, reason: 'error' };
  }

  try {
    writeNewLock(params.config.lockPath, payload);
    return { acquired: true };
  } catch (error) {
    logTransportWarn(params.logger, '[Transport] Failed to create transport lock after reclaiming stale owner', {
      config: params.config,
      runtimeId: params.runtimeId,
      role: params.role,
      pendingEvents: params.pendingEvents,
      reason: 'lock create failed after stale owner reclaim',
      error: String(error),
      extra: {
        previousRuntimeId: existingLock?.runtimeId,
        previousPid: existingLock?.pid,
      },
    });
    return { acquired: false, reason: 'error' };
  }
}

/**
 * Refresh the owner lock heartbeat so followers can tell the current owner is
 * still healthy without needing to touch the relay socket.
 */
export function writeTransportHeartbeat(params: {
  config: TransportConfig;
  logger: RuntimeLogger;
  runtimeId: string;
  role: TransportRole;
  pendingEvents: number;
}): boolean {
  try {
    overwriteLock(params.config.lockPath, buildLockPayload(params.runtimeId, params.config.socketPath));
    return true;
  } catch (error) {
    logTransportWarn(params.logger, '[Transport] Failed to update transport heartbeat', {
      config: params.config,
      runtimeId: params.runtimeId,
      role: params.role,
      pendingEvents: params.pendingEvents,
      reason: 'owner heartbeat write failed',
      error: String(error),
    });
    return false;
  }
}

/**
 * Remove the owner lock only when this runtime still owns it.
 */
export function releaseTransportLock(lockPath: string, runtimeId: string): void {
  removeLockIfOwned(lockPath, runtimeId);
}

/**
 * Ensure stale Unix socket files do not block a fresh owner bind.
 */
export function prepareTransportSocketPath(socketPath: string): void {
  if (process.platform === 'win32') {
    return;
  }

  mkdirSync(dirname(socketPath), { recursive: true });
  try {
    rmSync(socketPath, { force: true });
  } catch {
    // ignore stale socket cleanup failures
  }
}

/**
 * Best-effort cleanup for the Unix domain socket path after owner shutdown or
 * demotion.
 */
export function cleanupTransportSocketPath(socketPath: string): void {
  if (process.platform === 'win32') {
    return;
  }

  try {
    unlinkSync(socketPath);
  } catch {
    // ignore socket cleanup races
  }
}
