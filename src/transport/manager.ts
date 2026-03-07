import { rmSync, unlinkSync } from 'node:fs';
import { type Server } from 'node:net';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { TransportConfig } from '../config';
import { OpenClawEvent } from '../events/types';
import { RuntimeLogger } from '../runtime/types';
import {
  isLockStale,
  overwriteLock,
  removeLockIfOwned,
  writeNewLock,
  type LockFilePayload,
} from './lock';
import {
  buildSemanticKey,
  cloneEventWithTransportMetadata,
  type TransportRole,
} from './protocol';
import { sendRelayEvent } from './relay-client';
import { startRelayServer } from './relay-server';

export type { TransportRole } from './protocol';

/**
 * Coordinates single-owner transport responsibilities across multiple
 * long-lived OpenClaw runtimes on the same host.
 */
export class TransportManager {
  private readonly config: TransportConfig;
  private readonly logger: RuntimeLogger;
  private readonly runtimeId: string;
  private readonly onOwnerEvent: (event: OpenClawEvent) => Promise<void>;
  private readonly onRoleChange?: (role: TransportRole) => void;
  private readonly seenEventIds: Map<string, number> = new Map();
  private readonly seenSemanticKeys: Map<string, number> = new Map();

  private role: TransportRole = 'follower';
  private server?: Server;
  private heartbeatTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private pendingEvents: OpenClawEvent[] = [];
  private flushing = false;
  private stopped = false;
  private ownsLock = false;

  constructor(params: {
    config: TransportConfig;
    logger: RuntimeLogger;
    runtimeId: string;
    onOwnerEvent: (event: OpenClawEvent) => Promise<void>;
    onRoleChange?: (role: TransportRole) => void;
  }) {
    this.config = params.config;
    this.logger = params.logger;
    this.runtimeId = params.runtimeId;
    this.onOwnerEvent = params.onOwnerEvent;
    this.onRoleChange = params.onRoleChange;
  }

  start(): void {
    this.stopped = false;

    if (this.config.mode === 'follower') {
      this.setRole('follower');
      return;
    }

    if (this.tryBecomeOwner()) {
      return;
    }

    if (this.config.mode === 'owner') {
      this.logger.warn(
        '[Transport] Owner mode could not acquire transport lock. Falling back to follower relay mode.',
      );
    }

    this.setRole('follower');
  }

  getRole(): TransportRole {
    return this.role;
  }

  async dispatch(event: OpenClawEvent): Promise<void> {
    const annotated = cloneEventWithTransportMetadata(event, {
      runtimeId: this.runtimeId,
      role: this.role === 'owner' ? 'owner' : 'follower',
      route: 'local',
    });

    if (this.role === 'owner') {
      await this.processOwnerEvent(annotated, 'local');
      return;
    }

    this.enqueueForFollowerRelay(annotated);
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    const server = this.server;
    this.server = undefined;
    const hadServer = Boolean(server);
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    if (this.ownsLock) {
      this.releaseLock();
    }

    if (hadServer) {
      this.cleanupSocketPath();
    }
  }

  private enqueueForFollowerRelay(event: OpenClawEvent): void {
    if (this.pendingEvents.length >= this.config.maxPendingEvents) {
      this.pendingEvents.shift();
      this.logger.warn('[Transport] Follower relay queue full, dropping oldest pending event');
    }

    this.pendingEvents.push(event);
    this.scheduleFlush(0);
  }

  private scheduleFlush(delayMs: number): void {
    if (this.retryTimer !== undefined || this.stopped) {
      return;
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.flushPendingFollowerEvents();
    }, delayMs);

    if (this.retryTimer.unref) {
      this.retryTimer.unref();
    }
  }

  private async flushPendingFollowerEvents(): Promise<void> {
    if (this.flushing || this.stopped) {
      return;
    }

    this.flushing = true;
    try {
      while (this.pendingEvents.length > 0 && !this.stopped) {
        if (this.role === 'owner') {
          const next = this.pendingEvents.shift();
          if (next) {
            await this.processOwnerEvent(next, 'local');
          }
          continue;
        }

        const next = this.pendingEvents[0];
        if (!next) {
          break;
        }

        try {
          await this.sendToOwner(next);
          this.pendingEvents.shift();
        } catch (error) {
          this.logger.warn('[Transport] Failed to relay event to owner', String(error));
          if (this.config.mode === 'auto' && this.tryPromoteFromFollower()) {
            continue;
          }
          this.scheduleFlush(this.config.reconnectBackoffMs);
          break;
        }
      }
    } finally {
      this.flushing = false;
      if (this.pendingEvents.length > 0 && !this.retryTimer && !this.stopped) {
        this.scheduleFlush(this.config.reconnectBackoffMs);
      }
    }
  }

  private async sendToOwner(event: OpenClawEvent): Promise<void> {
    await sendRelayEvent({
      socketPath: this.config.socketPath,
      authToken: this.config.authToken,
      maxPayloadBytes: this.config.maxPayloadBytes,
      relayTimeoutMs: this.config.relayTimeoutMs,
      event,
    });
  }

  private tryPromoteFromFollower(): boolean {
    if (this.role !== 'follower') {
      return false;
    }

    return this.tryBecomeOwner();
  }

  private tryBecomeOwner(): boolean {
    if (!this.acquireLock()) {
      this.setRole('follower');
      return false;
    }

    this.setRole('owner');
    this.startOwnerServer();
    this.startHeartbeat();
    this.logger.info('[Transport] This runtime is the active transport owner', {
      runtimeId: this.runtimeId,
      socketPath: this.config.socketPath,
    });
    return true;
  }

  private acquireLock(): boolean {
    const payload = this.getLockPayload();

    try {
      writeNewLock(this.config.lockPath, payload);
      this.ownsLock = true;
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') {
        this.logger.warn('[Transport] Failed to acquire transport lock', err.message);
        return false;
      }
    }

    if (!isLockStale(this.config.lockPath, this.config.lockStaleMs)) {
      return false;
    }

    try {
      unlinkSync(this.config.lockPath);
    } catch {
      return false;
    }

    try {
      writeNewLock(this.config.lockPath, payload);
      this.ownsLock = true;
      return true;
    } catch {
      return false;
    }
  }

  private startOwnerServer(): void {
    if (this.server) {
      return;
    }

    this.prepareSocketPath();

    this.server = startRelayServer({
      socketPath: this.config.socketPath,
      maxPayloadBytes: this.config.maxPayloadBytes,
      authToken: this.config.authToken,
      logger: this.logger,
      onEvent: async (event) => {
        await this.processOwnerEvent(
          cloneEventWithTransportMetadata(event, {
            runtimeId: this.runtimeId,
            role: 'owner',
            route: 'relay',
            ownerRuntimeId: this.runtimeId,
          }),
          'relay',
        );
      },
      onFatalError: (reason) => {
        this.handleOwnerFailure(reason);
      },
    });
  }

  private prepareSocketPath(): void {
    if (process.platform === 'win32') {
      return;
    }

    mkdirSync(dirname(this.config.socketPath), { recursive: true });
    try {
      rmSync(this.config.socketPath, { force: true });
    } catch {
      // ignore stale socket cleanup failures
    }
  }

  private cleanupSocketPath(): void {
    if (process.platform === 'win32') {
      return;
    }

    try {
      unlinkSync(this.config.socketPath);
    } catch {
      // ignore socket cleanup races
    }
  }

  private async processOwnerEvent(event: OpenClawEvent, route: 'local' | 'relay'): Promise<void> {
    if (!this.shouldProcess(event)) {
      return;
    }

    const processed = cloneEventWithTransportMetadata(event, {
      runtimeId: this.runtimeId,
      role: 'owner',
      route,
      ownerRuntimeId: this.runtimeId,
    });
    await this.onOwnerEvent(processed);
  }

  private shouldProcess(event: OpenClawEvent): boolean {
    const now = Date.now();
    this.pruneDedupe(now);

    if (this.seenEventIds.has(event.eventId)) {
      this.logger.debug('[Transport] Dropping duplicate relayed eventId', event.eventId);
      return false;
    }
    this.seenEventIds.set(event.eventId, now + this.config.dedupeTtlMs);

    if (this.config.semanticDedupeEnabled) {
      const semanticKey = buildSemanticKey(event);
      if (semanticKey) {
        if (this.seenSemanticKeys.has(semanticKey)) {
          this.logger.debug('[Transport] Dropping duplicate semantic event', semanticKey);
          return false;
        }
        this.seenSemanticKeys.set(semanticKey, now + this.config.dedupeTtlMs);
      }
    }

    return true;
  }

  private pruneDedupe(now: number): void {
    for (const [key, expiresAt] of this.seenEventIds) {
      if (expiresAt <= now) {
        this.seenEventIds.delete(key);
      }
    }
    for (const [key, expiresAt] of this.seenSemanticKeys) {
      if (expiresAt <= now) {
        this.seenSemanticKeys.delete(key);
      }
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    if (!this.writeHeartbeat()) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      if (!this.writeHeartbeat()) {
        this.handleOwnerFailure('transport heartbeat write failure');
      }
    }, this.config.heartbeatMs);
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  private writeHeartbeat(): boolean {
    if (!this.ownsLock) {
      return false;
    }

    try {
      overwriteLock(this.config.lockPath, this.getLockPayload());
      return true;
    } catch (error) {
      this.logger.warn('[Transport] Failed to update transport heartbeat', String(error));
      return false;
    }
  }

  private releaseLock(): void {
    removeLockIfOwned(this.config.lockPath, this.runtimeId);
    this.ownsLock = false;
  }

  private getLockPayload(): LockFilePayload {
    return {
      runtimeId: this.runtimeId,
      pid: process.pid,
      updatedAt: Date.now(),
      socketPath: this.config.socketPath,
    };
  }

  private handleOwnerFailure(reason: string): void {
    if (this.stopped || this.role !== 'owner') {
      return;
    }

    const server = this.server;
    this.server = undefined;
    if (server) {
      server.close();
      this.cleanupSocketPath();
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.ownsLock) {
      this.releaseLock();
    }

    this.logger.warn('[Transport] Demoting owner runtime to follower', {
      runtimeId: this.runtimeId,
      reason,
    });

    this.setRole('follower');
    if (this.pendingEvents.length > 0) {
      this.scheduleFlush(this.config.reconnectBackoffMs);
    }
  }

  private setRole(role: TransportRole): void {
    if (this.role === role) {
      return;
    }
    this.role = role;
    this.onRoleChange?.(role);
  }
}
