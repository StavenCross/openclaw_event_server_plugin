/**
 * Event queue for reliable delivery
 */

import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { OpenClawEvent, QueueConfig, WebhookConfig, RetryConfig } from '../events/types';
import { broadcastToWebhooks, DeliveryResult } from './webhook';
import { getErrorMessage, getRuntimeLogger } from '../logging';

/**
 * Queued event with metadata
 */
interface QueuedEvent {
  event: OpenClawEvent;
  enqueuedAt: number;
  attempts: number;
  lastError?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isQueuedEvent(value: unknown): value is QueuedEvent {
  if (!isRecord(value)) {
    return false;
  }

  const event = value.event;
  return (
    typeof value.enqueuedAt === 'number' &&
    typeof value.attempts === 'number' &&
    isRecord(event) &&
    typeof event.eventId === 'string' &&
    typeof event.type === 'string' &&
    typeof event.timestamp === 'string'
  );
}

/**
 * Event queue manager
 */
export class EventQueue {
  private queue: QueuedEvent[] = [];
  private maxSize: number;
  private flushIntervalMs: number;
  private persistToDisk: boolean;
  private persistPath?: string;
  private flushTimer?: NodeJS.Timeout;
  private webhooks: WebhookConfig[] = [];
  private retryConfig: RetryConfig;
  private timeoutMs: number;
  private correlationIdHeader: string;
  private isFlushing = false;
  private persistChain: Promise<void> = Promise.resolve();
  private persistSequence = 0;

  constructor(
    config: QueueConfig,
    webhooks: WebhookConfig[],
    retryConfig: RetryConfig,
    timeoutMs: number,
    correlationIdHeader: string,
  ) {
    this.maxSize = config.maxSize;
    this.flushIntervalMs = config.flushIntervalMs;
    this.persistToDisk = config.persistToDisk;
    this.persistPath = config.persistPath;
    this.webhooks = webhooks;
    this.retryConfig = retryConfig;
    this.timeoutMs = timeoutMs;
    this.correlationIdHeader = correlationIdHeader;

    if (this.persistToDisk) {
      void this.loadPersistedQueue().finally(() => {
        this.startFlushTimer();
      });
      return;
    }

    // Start periodic flush
    this.startFlushTimer();
  }

  /**
   * Add event to queue
   */
  enqueue(event: OpenClawEvent): boolean {
    if (this.queue.length >= this.maxSize) {
      // Queue is full, drop oldest event
      this.queue.shift();
    }

    this.queue.push({
      event,
      enqueuedAt: Date.now(),
      attempts: 0,
    });

    // Trigger immediate flush if queue is getting large
    if (this.queue.length >= this.maxSize * 0.8) {
      this.flush().catch((error: unknown) => {
        getRuntimeLogger().error('[EventQueue] Flush failed:', getErrorMessage(error));
      });
    }

    void this.persistQueue();
    return true;
  }

  /**
   * Flush queue to webhooks
   */
  async flush(): Promise<DeliveryResult[]> {
    if (this.isFlushing || this.queue.length === 0) {
      return [];
    }

    this.isFlushing = true;
    const results: DeliveryResult[] = [];

    try {
      // Process events in batches - collect indices to remove after processing
      const batchSize = 10;
      const indicesToRemove: number[] = [];

      for (let i = 0; i < this.queue.length; i += batchSize) {
        const batch = this.queue.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (queuedEvent, batchIndex) => {
            const deliveryResults = await broadcastToWebhooks(
              queuedEvent.event,
              this.webhooks,
              this.retryConfig,
              this.timeoutMs,
              this.correlationIdHeader,
            );

            // Check if all webhooks failed. If no webhooks exist, remove event.
            const allFailed =
              deliveryResults.length > 0 && deliveryResults.every((result) => !result.success);
            if (allFailed && queuedEvent.attempts < this.retryConfig.maxAttempts) {
              // Re-queue for later retry
              queuedEvent.attempts++;
              queuedEvent.lastError = deliveryResults[0]?.error;
              return deliveryResults;
            }

            // Mark for removal (success, max attempts reached, or no webhooks)
            indicesToRemove.push(i + batchIndex);
            return deliveryResults;
          }),
        );
        results.push(...batchResults.flat());
      }

      // Remove processed events from queue (in reverse order to preserve indices)
      for (let i = indicesToRemove.length - 1; i >= 0; i--) {
        this.queue.splice(indicesToRemove[i], 1);
      }

      await this.persistQueue();
    } finally {
      this.isFlushing = false;
    }

    return results;
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    oldestEventAge: number;
    isFlushing: boolean;
  } {
    const oldestEvent = this.queue[0];
    return {
      size: this.queue.length,
      maxSize: this.maxSize,
      oldestEventAge: oldestEvent ? Date.now() - oldestEvent.enqueuedAt : 0,
      isFlushing: this.isFlushing,
    };
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue = [];
    void this.persistQueue();
  }

  /**
   * Update webhooks configuration
   */
  updateWebhooks(webhooks: WebhookConfig[]): void {
    const logger = getRuntimeLogger();
    // Validate webhooks before updating
    const validWebhooks = webhooks.filter((webhook) => {
      if (!webhook.url || webhook.url.trim() === '') {
        logger.error('[EventQueue] Invalid webhook URL, skipping');
        return false;
      }
      try {
        const parsed = new URL(webhook.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          logger.error('[EventQueue] Only HTTP(S) webhook URLs are allowed:', webhook.url);
          return false;
        }
        return true;
      } catch {
        logger.error('[EventQueue] Invalid webhook URL format:', webhook.url);
        return false;
      }
    });
    this.webhooks = validWebhooks;
  }

  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (!this.isFlushing && this.queue.length > 0) {
        this.flush().catch((error: unknown) => {
          getRuntimeLogger().error('[EventQueue] Flush failed:', getErrorMessage(error));
        });
      }
    }, this.flushIntervalMs);

    // Keep timers referenced in tests so Jest can observe queued webhook delivery.
    if (process.env.NODE_ENV !== 'test' && this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  /**
   * Stop the flush timer
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    void this.persistQueue();
  }

  private getPersistPath(): string {
    return this.persistPath ?? `${process.cwd()}/.event-plugin-queue.json`;
  }

  private async loadPersistedQueue(): Promise<void> {
    const persistPath = this.getPersistPath();

    try {
      const raw = await readFile(persistPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return;
      }

      const restored = parsed.filter((item): item is QueuedEvent => isQueuedEvent(item));
      this.mergeRestoredQueue(restored);
    } catch {
      // No persisted queue file or invalid content; start fresh.
    }
  }

  private mergeRestoredQueue(restored: QueuedEvent[]): void {
    if (restored.length === 0) {
      return;
    }

    const existingEventIds = new Set(this.queue.map((item) => item.event.eventId));
    for (const item of restored) {
      if (existingEventIds.has(item.event.eventId)) {
        continue;
      }
      this.queue.push(item);
    }

    if (this.queue.length > this.maxSize) {
      this.queue = this.queue.slice(this.queue.length - this.maxSize);
    }
  }

  private async persistQueue(): Promise<void> {
    if (!this.persistToDisk) {
      return;
    }

    const snapshot = JSON.stringify(this.queue);
    this.persistChain = this.persistChain
      .catch(() => undefined)
      .then(() => this.writeQueueAtomically(snapshot))
      .catch((error) => {
        getRuntimeLogger().error('[EventQueue] Failed to persist queue:', getErrorMessage(error));
      });
    await this.persistChain;
  }

  private async writeQueueAtomically(serializedQueue: string): Promise<void> {
    const persistPath = this.getPersistPath();
    const tempPath = `${persistPath}.${process.pid}.${Date.now()}.${this.persistSequence}.tmp`;
    this.persistSequence += 1;

    await writeFile(tempPath, serializedQueue, 'utf8');
    try {
      await rename(tempPath, persistPath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
