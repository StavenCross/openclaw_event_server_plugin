import { type Server } from 'node:net';
import { TransportConfig } from '../config';
import { OpenClawEvent } from '../events/types';
import { RuntimeLogger } from '../runtime/types';
import { buildSemanticKey, cloneEventWithTransportMetadata, type TransportRole } from './protocol';
import { logTransportInfo, logTransportWarn } from './log-context';
import {
  acquireTransportLock,
  cleanupTransportSocketPath,
  prepareTransportSocketPath,
  releaseTransportLock,
  writeTransportHeartbeat,
} from './ownership';
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
  private ownerRecoveryTimer?: NodeJS.Timeout;
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
      logTransportWarn(
        this.logger,
        '[Transport] Owner mode could not acquire transport lock. Falling back to follower relay mode.',
        {
          config: this.config,
          runtimeId: this.runtimeId,
          role: this.role,
          pendingEvents: this.pendingEvents.length,
          reason: 'initial owner lock acquisition failed',
        },
      );
    }
    this.setRole('follower');
    this.scheduleOwnerRecovery(this.config.reconnectBackoffMs);
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
    if (this.ownerRecoveryTimer) {
      clearTimeout(this.ownerRecoveryTimer);
      this.ownerRecoveryTimer = undefined;
    }
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
      cleanupTransportSocketPath(this.config.socketPath);
    }
  }

  private enqueueForFollowerRelay(event: OpenClawEvent): void {
    if (this.pendingEvents.length >= this.config.maxPendingEvents) {
      this.pendingEvents.shift();
      logTransportWarn(
        this.logger,
        '[Transport] Follower relay queue full, dropping oldest pending event',
        {
          config: this.config,
          runtimeId: this.runtimeId,
          role: this.role,
          pendingEvents: this.pendingEvents.length,
          reason: 'pending follower relay queue reached capacity',
        },
      );
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
          logTransportWarn(
            this.logger,
            '[Transport] Failed to relay event to owner; event remains queued while transport recovery is pending',
            {
              config: this.config,
              runtimeId: this.runtimeId,
              role: this.role,
              pendingEvents: this.pendingEvents.length,
              reason: 'follower relay attempt failed',
              error: String(error),
            },
          );
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
    return this.role === 'follower' && this.tryBecomeOwner();
  }

  private tryBecomeOwner(): boolean {
    if (!this.acquireLock()) {
      this.setRole('follower');
      return false;
    }

    if (this.ownerRecoveryTimer) {
      clearTimeout(this.ownerRecoveryTimer);
      this.ownerRecoveryTimer = undefined;
    }
    this.setRole('owner');
    this.startOwnerServer();
    this.startHeartbeat();
    logTransportInfo(
      this.logger,
      '[Transport] This runtime is the active transport owner',
      {
        config: this.config,
        runtimeId: this.runtimeId,
        role: this.role,
        pendingEvents: this.pendingEvents.length,
      },
    );
    return true;
  }

  private acquireLock(): boolean {
    const acquired = acquireTransportLock({
      config: this.config,
      logger: this.logger,
      runtimeId: this.runtimeId,
      role: this.role,
      pendingEvents: this.pendingEvents.length,
    });
    if (acquired) {
      this.ownsLock = true;
    }
    return acquired;
  }

  private startOwnerServer(): void {
    if (this.server) {
      return;
    }

    prepareTransportSocketPath(this.config.socketPath);

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
      onListening: () => {
        logTransportInfo(this.logger, '[Transport] Owner relay server is listening', {
          config: this.config,
          runtimeId: this.runtimeId,
          role: this.role,
          pendingEvents: this.pendingEvents.length,
        });
      },
      onClose: () => {
        this.handleOwnerFailure('owner ingest server closed');
      },
      onFatalError: (reason) => {
        this.handleOwnerFailure(reason);
      },
    });
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

    return writeTransportHeartbeat({
      config: this.config,
      logger: this.logger,
      runtimeId: this.runtimeId,
      role: this.role,
      pendingEvents: this.pendingEvents.length,
    });
  }

  private releaseLock(): void {
    releaseTransportLock(this.config.lockPath, this.runtimeId);
    this.ownsLock = false;
  }

  private handleOwnerFailure(reason: string): void {
    if (this.stopped || this.role !== 'owner') {
      return;
    }

    const server = this.server;
    this.server = undefined;
    if (server) {
      server.close();
      cleanupTransportSocketPath(this.config.socketPath);
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.ownsLock) {
      this.releaseLock();
    }

    logTransportWarn(
      this.logger,
      '[Transport] Demoting owner runtime to follower; follower relays may temporarily report ECONNREFUSED until recovery succeeds',
      {
        config: this.config,
        runtimeId: this.runtimeId,
        role: this.role,
        pendingEvents: this.pendingEvents.length,
        reason,
      },
    );

    this.setRole('follower');
    this.scheduleOwnerRecovery(this.config.reconnectBackoffMs);
    if (this.pendingEvents.length > 0) {
      this.scheduleFlush(this.config.reconnectBackoffMs);
    }
  }

  private scheduleOwnerRecovery(delayMs: number): void {
    if (this.config.mode === 'follower' || this.stopped || this.ownerRecoveryTimer) {
      return;
    }

    logTransportInfo(
      this.logger,
      '[Transport] Scheduling owner transport recovery attempt',
      {
        config: this.config,
        runtimeId: this.runtimeId,
        role: this.role,
        pendingEvents: this.pendingEvents.length,
        reason: 'owner transport recovery scheduled',
        extra: { delayMs },
      },
    );

    this.ownerRecoveryTimer = setTimeout(() => {
      this.ownerRecoveryTimer = undefined;
      if (this.stopped || this.role === 'owner') {
        return;
      }

      logTransportInfo(
        this.logger,
        '[Transport] Attempting owner transport recovery',
        {
          config: this.config,
          runtimeId: this.runtimeId,
          role: this.role,
          pendingEvents: this.pendingEvents.length,
          reason: 'owner transport recovery starting',
          extra: { delayMs },
        },
      );
      if (!this.tryBecomeOwner()) {
        this.scheduleOwnerRecovery(this.config.reconnectBackoffMs);
      }
    }, delayMs);

    if (this.ownerRecoveryTimer.unref) {
      this.ownerRecoveryTimer.unref();
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
