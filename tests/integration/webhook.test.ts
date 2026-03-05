/**
 * Integration tests for webhook delivery
 */

import { type Server, createServer } from 'node:http';
import { broadcastToWebhooks, sendToWebhook } from '../../src/broadcast/webhook';
import { OpenClawEvent, WebhookConfig, RetryConfig } from '../../src/events/types';
import { MockWebhookReceiver } from '../mocks/openclaw-runtime';

describe('Webhook Delivery', () => {
  let receiver: MockWebhookReceiver;
  const testPort = 3456;
  const testUrl = `http://localhost:${testPort}/events`;

  const testEvent: OpenClawEvent = {
    eventId: 'test-event-123',
    schemaVersion: '1.1.0',
    type: 'message.sent',
    timestamp: new Date().toISOString(),
    pluginVersion: '1.0.0',
    sessionId: 'test-session',
    correlationId: 'corr-123',
    data: {
      to: '+1234567890',
      content: 'Test message',
      channelId: 'whatsapp',
    },
  };

  const retryConfig: RetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
  };

  beforeEach(async () => {
    receiver = new MockWebhookReceiver();
    await receiver.start(testPort);
  });

  afterEach(async () => {
    await receiver.stop();
    receiver.clear();
  });

  describe('sendToWebhook', () => {
    it('should successfully send event to webhook', async () => {
      const webhook: WebhookConfig = {
        url: testUrl,
        method: 'POST',
      };

      const result = await sendToWebhook(
        testEvent,
        webhook,
        retryConfig,
        5000,
        'X-Correlation-ID'
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.responseStatus).toBe(200);
      expect(receiver.getEventCount()).toBe(1);
      expect(receiver.receivedEvents[0].eventId).toBe('test-event-123');
    });

    it('should include correlation ID header', async () => {
      const webhook: WebhookConfig = {
        url: testUrl,
        method: 'POST',
      };

      await sendToWebhook(
        testEvent,
        webhook,
        retryConfig,
        5000,
        'X-Correlation-ID'
      );

      const request = receiver.requests[0];
      expect(request.headers['x-correlation-id']).toBe('corr-123');
    });

    it('should include auth token header', async () => {
      const webhook: WebhookConfig = {
        url: testUrl,
        method: 'POST',
        authToken: 'test-token',
      };

      await sendToWebhook(
        testEvent,
        webhook,
        retryConfig,
        5000,
        'X-Correlation-ID'
      );

      const request = receiver.requests[0];
      expect(request.headers['authorization']).toBe('Bearer test-token');
    });

    it('should include custom headers', async () => {
      const webhook: WebhookConfig = {
        url: testUrl,
        method: 'POST',
        headers: {
          'X-Custom-Header': 'custom-value',
        },
      };

      await sendToWebhook(
        testEvent,
        webhook,
        retryConfig,
        5000,
        'X-Correlation-ID'
      );

      const request = receiver.requests[0];
      expect(request.headers['x-custom-header']).toBe('custom-value');
    });
  });

  describe('broadcastToWebhooks', () => {
    it('should broadcast to multiple webhooks in parallel', async () => {
      const webhooks: WebhookConfig[] = [
        { url: testUrl },
        { url: testUrl },
        { url: testUrl },
      ];

      const results = await broadcastToWebhooks(
        testEvent,
        webhooks,
        retryConfig,
        5000,
        'X-Correlation-ID'
      );

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
      expect(receiver.getEventCount()).toBe(3);
    });

    it('should handle empty webhook list', async () => {
      const results = await broadcastToWebhooks(
        testEvent,
        [],
        retryConfig,
        5000,
        'X-Correlation-ID'
      );

      expect(results).toHaveLength(0);
    });
  });

  describe('Retry Logic', () => {
    it('should retry on server errors', async () => {
      // Create a receiver that fails the first two requests
      let requestCount = 0;
      const retryPort = testPort + 10;
      
      let retryServer: Server | undefined;
      
      await new Promise<void>((resolve) => {
        retryServer = createServer((_req, res) => {
          requestCount++;
          if (requestCount <= 2) {
            res.writeHead(500);
            res.end('Server Error');
          } else {
            res.writeHead(200);
            res.end(JSON.stringify({ received: true }));
          }
        });
        retryServer.listen(retryPort, () => {
          resolve();
        });
      });

      try {
        const webhook: WebhookConfig = {
          url: `http://localhost:${retryPort}/events`,
        };

        const result = await sendToWebhook(
          testEvent,
          webhook,
          { ...retryConfig, initialDelayMs: 50, maxDelayMs: 100 },
          5000,
          'X-Correlation-ID'
        );

        expect(result.success).toBe(true);
        expect(result.attempts).toBe(3);
      } finally {
        await closeServer(retryServer);
      }
    });

    it('should not retry on client errors (4xx)', async () => {
      const clientErrorPort = testPort + 20;
      let clientErrorServer: Server | undefined;
      
      await new Promise<void>((resolve) => {
        clientErrorServer = createServer((_req, res) => {
          res.writeHead(400);
          res.end('Bad Request');
        });
        clientErrorServer.listen(clientErrorPort, () => {
          resolve();
        });
      });

      try {
        const webhook: WebhookConfig = {
          url: `http://localhost:${clientErrorPort}/events`,
        };

        const result = await sendToWebhook(
          testEvent,
          webhook,
          retryConfig,
          5000,
          'X-Correlation-ID'
        );

        expect(result.success).toBe(false);
        expect(result.attempts).toBe(1); // Should not retry
      } finally {
        await closeServer(clientErrorServer);
      }
    });

    it('should retry on rate limit (429)', async () => {
      let requestCount = 0;
      const rateLimitPort = testPort + 30;
      let rateLimitServer: Server | undefined;
      
      await new Promise<void>((resolve) => {
        rateLimitServer = createServer((_req, res) => {
          requestCount++;
          if (requestCount === 1) {
            res.writeHead(429);
            res.end('Rate Limited');
          } else {
            res.writeHead(200);
            res.end(JSON.stringify({ received: true }));
          }
        });
        rateLimitServer.listen(rateLimitPort, () => {
          resolve();
        });
      });

      try {
        const webhook: WebhookConfig = {
          url: `http://localhost:${rateLimitPort}/events`,
        };

        const result = await sendToWebhook(
          testEvent,
          webhook,
          { ...retryConfig, initialDelayMs: 50, maxDelayMs: 100 },
          5000,
          'X-Correlation-ID'
        );

        expect(result.success).toBe(true);
        expect(result.attempts).toBe(2);
      } finally {
        await closeServer(rateLimitServer);
      }
    });
  });

  describe('Input Validation', () => {
    it('should fail with empty URL', async () => {
      const webhook: WebhookConfig = {
        url: '',
      };

      const result = await sendToWebhook(
        testEvent,
        webhook,
        retryConfig,
        5000,
        'X-Correlation-ID'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid webhook URL');
      expect(result.attempts).toBe(0);
    });

    it('should fail with whitespace-only URL', async () => {
      const webhook: WebhookConfig = {
        url: '   ',
      };

      const result = await sendToWebhook(
        testEvent,
        webhook,
        retryConfig,
        5000,
        'X-Correlation-ID'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid webhook URL');
    });

    it('should fail with malformed URL', async () => {
      const webhook: WebhookConfig = {
        url: '::not-valid::',
      };

      const result = await sendToWebhook(
        testEvent,
        webhook,
        retryConfig,
        5000,
        'X-Correlation-ID'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid webhook URL format');
      expect(result.attempts).toBe(0);
    });

    it('should fail with unsupported protocol', async () => {
      const webhook: WebhookConfig = {
        url: 'ftp://example.com/events',
      };

      const result = await sendToWebhook(
        testEvent,
        webhook,
        retryConfig,
        5000,
        'X-Correlation-ID'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Only HTTP and HTTPS webhook URLs are supported');
      expect(result.attempts).toBe(0);
    });
  });
});
  const closeServer = (server: Server | undefined): Promise<void> => {
    if (!server) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  };
