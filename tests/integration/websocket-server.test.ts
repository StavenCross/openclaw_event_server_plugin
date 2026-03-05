import * as net from 'net';
import WebSocket from 'ws';
import {
  BroadcastWebSocketServer,
  broadcastEvent,
  getBroadcastServer,
  startBroadcastServer,
  stopBroadcastServer,
} from '../../src/broadcast/websocketServer';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await wait(20);
  }
  if (!predicate()) {
    throw new Error('Timed out waiting for condition');
  }
}

async function reservePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to reserve port');
  }
  const port = address.port;

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  return port;
}

async function connectClient(port: number): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${port}/`);
  await new Promise<void>((resolve, reject) => {
    client.once('open', () => resolve());
    client.once('error', reject);
  });
  return client;
}

async function waitForMessage(
  client: WebSocket,
  predicate: (payload: Record<string, unknown>) => boolean,
  timeoutMs = 1500,
): Promise<Record<string, unknown>> {
  const decodeRawData = (raw: WebSocket.RawData): string => {
    if (typeof raw === 'string') {
      return raw;
    }
    if (raw instanceof ArrayBuffer) {
      return Buffer.from(raw).toString('utf8');
    }
    if (Array.isArray(raw)) {
      return Buffer.concat(raw.map((chunk) => Buffer.from(chunk))).toString('utf8');
    }
    return raw.toString('utf8');
  };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for matching message'));
    }, timeoutMs);

    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const payload = JSON.parse(decodeRawData(raw)) as Record<string, unknown>;
        if (!predicate(payload)) {
          return;
        }
        cleanup();
        resolve(payload);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      client.off('message', onMessage);
    };

    client.on('message', onMessage);
  });
}

describe('WebSocket broadcast server', () => {
  afterEach(async () => {
    await stopBroadcastServer();
  });

  it('broadcasts object and primitive payloads to connected clients', async () => {
    const port = await reservePort();
    const server = new BroadcastWebSocketServer({ port, fallbackPorts: [port + 1, port + 2] });

    try {
      server.start();
      await waitFor(() => server.isServerRunning());

      const client = await connectClient(server.getPort());
      await waitFor(() => server.getClientCount() === 1);
      await wait(50);

      const objectMessagePromise = waitForMessage(client, (payload) => payload.type === 'message.sent');
      server.broadcast({ type: 'message.sent', data: { ok: true } });
      const objectMessage = await objectMessagePromise;
      expect(objectMessage.type).toBe('message.sent');
      expect(objectMessage.broadcastAt).toBeDefined();

      const primitiveMessagePromise = waitForMessage(client, (payload) => payload.event === 'raw-event');
      server.broadcast('raw-event');
      const primitiveMessage = await primitiveMessagePromise;
      expect(primitiveMessage.event).toBe('raw-event');

      const closed = new Promise<void>((resolve) => {
        client.once('close', () => resolve());
      });
      client.close();
      await closed;
      await waitFor(() => server.getClientCount() === 0);
    } finally {
      await server.stop();
    }

    expect(server.isServerRunning()).toBe(false);
  });

  it('supports singleton wrapper lifecycle', async () => {
    const port = await reservePort();

    // No-op path before singleton startup.
    expect(() => broadcastEvent({ hello: 'world' })).not.toThrow();

    const server = startBroadcastServer({ port, fallbackPorts: [port + 1] });
    await waitFor(() => server.isServerRunning());

    const singleton = getBroadcastServer();
    expect(singleton).toBe(server);

    const client = await connectClient(server.getPort());
    await waitFor(() => server.getClientCount() === 1);
    await wait(50);

    const eventMessagePromise = waitForMessage(client, (payload) => payload.type === 'tool.called');
    broadcastEvent({ type: 'tool.called', data: { toolName: 'read' } });
    const eventMessage = await eventMessagePromise;
    expect(eventMessage.type).toBe('tool.called');

    const closed = new Promise<void>((resolve) => {
      client.once('close', () => resolve());
    });
    client.close();
    await closed;
    await waitFor(() => server.getClientCount() === 0);

    await stopBroadcastServer();
    await stopBroadcastServer();
  });
});
