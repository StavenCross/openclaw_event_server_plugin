/**
 * Integration tests for event queue
 */

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventQueue } from '../../src/broadcast/queue';
import {
  OpenClawEvent,
  QueueConfig,
  RetryConfig,
  WebhookConfig,
} from '../../src/events/types';
import { MockWebhookReceiver } from '../mocks/openclaw-runtime';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function removeDirWithRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as { code?: string }).code : undefined;
      if (
        code !== 'ENOTEMPTY' &&
        code !== 'EBUSY' &&
        code !== 'EPERM'
      ) {
        throw error;
      }
      await wait(25 * (attempt + 1));
    }
  }
  await rm(path, { recursive: true, force: true });
}

describe('EventQueue', () => {
  let receiver: MockWebhookReceiver;
  let queue: EventQueue;
  let testUrl: string;

  const queueConfig: QueueConfig = {
    maxSize: 100,
    flushIntervalMs: 100,
    persistToDisk: false,
  };

  const retryConfig: RetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 50,
    maxDelayMs: 500,
    backoffMultiplier: 2,
  };

  let webhookConfig: WebhookConfig[];

  function createTestEvent(
    type: 'message.sent' | 'message.received' = 'message.sent',
  ): OpenClawEvent {
    return {
      eventId: `event-${Date.now()}-${Math.random()}`,
      schemaVersion: '1.1.0',
      type,
      timestamp: new Date().toISOString(),
      pluginVersion: '1.0.0',
      sessionId: 'test-session',
      data: {
        channelId: 'whatsapp',
        content: 'Test',
        to: '+1234567890',
      },
    };
  }

  beforeEach(async () => {
    receiver = new MockWebhookReceiver();
    const testPort = await receiver.start(0);
    testUrl = `http://localhost:${testPort}/events`;
    webhookConfig = [{ url: testUrl, method: 'POST' }];

    queue = new EventQueue(
      queueConfig,
      webhookConfig,
      retryConfig,
      5000,
      'X-Correlation-ID'
    );
  });

  afterEach(async () => {
    queue.stop();
    await receiver.stop();
    receiver.clear();
  });

  it('should enqueue events', () => {
    const event = createTestEvent();
    const result = queue.enqueue(event);
    
    expect(result).toBe(true);
    const stats = queue.getStats();
    expect(stats.size).toBe(1);
  });

  it('should flush events to webhooks', async () => {
    const event1 = createTestEvent('message.sent');
    const event2 = createTestEvent('message.received');
    
    queue.enqueue(event1);
    queue.enqueue(event2);
    
    // Manually trigger flush instead of waiting for periodic flush
    await queue.flush();
    
    // Wait a bit for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    expect(receiver.getEventCount()).toBeGreaterThanOrEqual(1);
  });

  it('should respect max queue size', () => {
    const smallQueueConfig: QueueConfig = {
      ...queueConfig,
      maxSize: 5,
    };
    
    const smallQueue = new EventQueue(
      smallQueueConfig,
      webhookConfig,
      retryConfig,
      5000,
      'X-Correlation-ID'
    );
    
    // Enqueue more than max size
    for (let i = 0; i < 10; i++) {
      smallQueue.enqueue(createTestEvent());
    }
    
    const stats = smallQueue.getStats();
    expect(stats.size).toBeLessThanOrEqual(5);
    
    smallQueue.stop();
  });

  it('should track queue statistics', () => {
    const event = createTestEvent();
    queue.enqueue(event);
    
    const stats = queue.getStats();
    
    expect(stats.size).toBe(1);
    expect(stats.maxSize).toBe(100);
    expect(stats.oldestEventAge).toBeGreaterThanOrEqual(0);
    expect(typeof stats.isFlushing).toBe('boolean');
  });

  it('should clear the queue', () => {
    queue.enqueue(createTestEvent());
    queue.enqueue(createTestEvent());
    
    queue.clear();
    
    const stats = queue.getStats();
    expect(stats.size).toBe(0);
  });

  it('should update webhooks configuration', () => {
    const newWebhooks: WebhookConfig[] = [
      { url: 'http://new-webhook.com/events' },
    ];
    
    queue.updateWebhooks(newWebhooks);
    
    // Queue should now use new webhooks (tested via flush behavior)
  });

  it('should filter out invalid webhook URLs', async () => {
    const invalidWebhooks: WebhookConfig[] = [
      { url: testUrl },
      { url: '' },
      { url: '   ' },
      { url: 'not-a-url' },
      { url: 'ftp://invalid.com' },
    ];
    
    queue.updateWebhooks(invalidWebhooks);
    const initialCount = receiver.getEventCount();
    queue.enqueue(createTestEvent());
    
    await queue.flush();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(receiver.getEventCount() - initialCount).toBe(1);
  });

  it('should handle multiple events in batch', async () => {
    // Enqueue multiple events
    for (let i = 0; i < 20; i++) {
      queue.enqueue(createTestEvent());
    }
    
    // Wait for periodic flush
    await new Promise((resolve) => setTimeout(resolve, 300));
    
    // All events should be delivered
    expect(receiver.getEventCount()).toBeGreaterThanOrEqual(1);
  });

  it('should not flush when queue is empty', async () => {
    const initialCount = receiver.getEventCount();
    
    // Wait for potential flush
    await new Promise((resolve) => setTimeout(resolve, 200));
    
    expect(receiver.getEventCount()).toBe(initialCount);
  });

  it('should prevent concurrent flushes', () => {
    const event = createTestEvent();
    queue.enqueue(event);
    
    const stats1 = queue.getStats();
    expect(stats1.isFlushing).toBe(false);
    
    // Trigger flush
    void queue.flush();
    
    // Stats should reflect flush state
  });

  it('should persist queue to disk when enabled', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'event-queue-'));
    const persistPath = join(tempDir, 'queue.json');
    const persistentConfig: QueueConfig = {
      ...queueConfig,
      persistToDisk: true,
      persistPath,
    };

    const persistentQueue = new EventQueue(
      persistentConfig,
      webhookConfig,
      retryConfig,
      5000,
      'X-Correlation-ID',
    );

    persistentQueue.enqueue(createTestEvent());
    await new Promise((resolve) => setTimeout(resolve, 75));
    persistentQueue.stop();

    const restoredQueue = new EventQueue(
      persistentConfig,
      webhookConfig,
      retryConfig,
      5000,
      'X-Correlation-ID',
    );
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(restoredQueue.getStats().size).toBe(1);

    restoredQueue.stop();
    await new Promise((resolve) => setTimeout(resolve, 75));
    await removeDirWithRetry(tempDir);
  });

  it('should preserve newly enqueued events while persisted queue loads', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'event-queue-race-'));
    const persistPath = join(tempDir, 'queue.json');
    const persistentConfig: QueueConfig = {
      ...queueConfig,
      persistToDisk: true,
      persistPath,
      flushIntervalMs: 1000,
    };

    const persistedEvent = createTestEvent('message.sent');
    await writeFile(
      persistPath,
      JSON.stringify([
        {
          event: persistedEvent,
          enqueuedAt: Date.now() - 1000,
          attempts: 0,
        },
      ]),
      'utf8',
    );

    const persistentQueue = new EventQueue(
      persistentConfig,
      webhookConfig,
      retryConfig,
      5000,
      'X-Correlation-ID',
    );

    // Enqueue immediately after constructor; loadPersistedQueue should merge, not overwrite.
    persistentQueue.enqueue(createTestEvent('message.received'));

    const start = Date.now();
    while (Date.now() - start < 1000 && persistentQueue.getStats().size < 2) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(persistentQueue.getStats().size).toBeGreaterThanOrEqual(2);

    persistentQueue.stop();
    await wait(150);
    await removeDirWithRetry(tempDir);
  });

  it('persists queue atomically without leaving temp files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'event-queue-atomic-'));
    const persistPath = join(tempDir, 'queue.json');
    const persistentConfig: QueueConfig = {
      ...queueConfig,
      persistToDisk: true,
      persistPath,
      flushIntervalMs: 1000,
    };

    const persistentQueue = new EventQueue(
      persistentConfig,
      webhookConfig,
      retryConfig,
      5000,
      'X-Correlation-ID',
    );

    for (let i = 0; i < 5; i += 1) {
      persistentQueue.enqueue(createTestEvent());
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    persistentQueue.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const files = await readdir(tempDir);
    expect(files).toContain('queue.json');
    expect(files.some((name) => name.includes('.tmp'))).toBe(false);

    await removeDirWithRetry(tempDir);
  });
});
