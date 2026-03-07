/**
 * Ensures reliability queue is initialized on activation, not only on gateway:startup.
 */

import * as net from 'net';
import { createPlugin } from '../../src/index';
import { stopBroadcastServer } from '../../src/broadcast/websocketServer';
import { MockOpenClawApi, MockWebhookReceiver, createMockMessageSent } from '../mocks/openclaw-runtime';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function reservePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to reserve test port');
  }
  const port = address.port;

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return port;
}

describe('Queue initialization', () => {
  it('should enqueue and deliver events before any gateway:startup hook', async () => {
    const port = await reservePort();
    const tempDir = await mkdtemp(join(tmpdir(), 'event-plugin-queue-'));
    const plugin = createPlugin();
    const api = new MockOpenClawApi();
    api.config = {
      transport: {
        mode: 'owner',
      },
      queue: {
        flushIntervalMs: 100,
      },
    };

    process.env.EVENT_PLUGIN_WEBHOOKS = `http://127.0.0.1:${port}/events`;
    process.env.EVENT_PLUGIN_DISABLE_WS = 'true';
    process.env.EVENT_PLUGIN_DISABLE_STATUS_TICKER = 'true';
    process.env.OPENCLAW_STATE_DIR = tempDir;

    const receiver = new MockWebhookReceiver();

    try {
      plugin.activate(api);

      // Emit a message event immediately; receiver is still offline so queueing is required.
      await api.triggerHook('message:sent', createMockMessageSent());
      await wait(120);

      await receiver.start(port);

      const start = Date.now();
      while (receiver.receivedEvents.length < 1 && Date.now() - start < 3000) {
        await wait(25);
      }

      expect(receiver.receivedEvents.length).toBeGreaterThanOrEqual(1);
      expect(receiver.receivedEvents[0]?.type).toBe('message.sent');
    } finally {
      await plugin.deactivate();
      await receiver.stop();
      await stopBroadcastServer();
      await rm(tempDir, { recursive: true, force: true });
      delete process.env.EVENT_PLUGIN_WEBHOOKS;
      delete process.env.EVENT_PLUGIN_DISABLE_WS;
      delete process.env.EVENT_PLUGIN_DISABLE_STATUS_TICKER;
      delete process.env.OPENCLAW_STATE_DIR;
    }
  });
});
