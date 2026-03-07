import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

export type LockFilePayload = {
  runtimeId: string;
  pid: number;
  updatedAt: number;
  socketPath: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseLockPayload(raw: string): LockFilePayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    if (
      typeof parsed.runtimeId !== 'string' ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.updatedAt !== 'number' ||
      typeof parsed.socketPath !== 'string'
    ) {
      return null;
    }

    return {
      runtimeId: parsed.runtimeId,
      pid: parsed.pid,
      updatedAt: parsed.updatedAt,
      socketPath: parsed.socketPath,
    };
  } catch {
    return null;
  }
}

export function writeNewLock(lockPath: string, payload: LockFilePayload): boolean {
  mkdirSync(dirname(lockPath), { recursive: true });
  const serialized = JSON.stringify(payload);
  const fd = openSync(lockPath, 'wx');
  writeFileSync(fd, serialized, 'utf8');
  closeSync(fd);
  return true;
}

export function overwriteLock(lockPath: string, payload: LockFilePayload): void {
  writeFileSync(lockPath, JSON.stringify(payload), 'utf8');
}

export function isLockStale(lockPath: string, staleAfterMs: number): boolean {
  try {
    const raw = readFileSync(lockPath, 'utf8');
    const payload = parseLockPayload(raw);
    if (payload) {
      return Date.now() - payload.updatedAt > staleAfterMs;
    }
  } catch {
    // fall back to stat when JSON cannot be read
  }

  try {
    const stat = statSync(lockPath);
    return Date.now() - stat.mtimeMs > staleAfterMs;
  } catch {
    return true;
  }
}

export function removeLockIfOwned(lockPath: string, runtimeId: string): void {
  try {
    const raw = readFileSync(lockPath, 'utf8');
    const payload = parseLockPayload(raw);
    if (payload && payload.runtimeId !== runtimeId) {
      return;
    }
  } catch {
    // ignore lock read failure on shutdown
  }

  try {
    unlinkSync(lockPath);
  } catch {
    // ignore shutdown cleanup races
  }
}
