import { createConnection, createServer, type Server } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenClawEvent } from '../../src/events/types';
import { sendRelayEvent } from '../../src/transport/relay-client';
import { startRelayServer } from '../../src/transport/relay-server';

function createEvent(eventId: string): OpenClawEvent {
  return {
    eventId,
    schemaVersion: '1.0.0',
    type: 'message.sent',
    timestamp: new Date().toISOString(),
    pluginVersion: '1.0.0',
    data: {
      content: 'relay test',
    },
  };
}

function createLogger() {
  return {
    debug: jest.fn<void, unknown[]>(),
    info: jest.fn<void, unknown[]>(),
    warn: jest.fn<void, unknown[]>(),
    error: jest.fn<void, unknown[]>(),
    queue: jest.fn<void, unknown[]>(),
  };
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function readRawRelayResponse(socketPath: string, payload: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let buffer = '';
    const socket = createConnection(socketPath);

    socket.setEncoding('utf8');
    socket.once('connect', () => {
      socket.end(payload, 'utf8');
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
    });
    socket.once('error', reject);
    socket.once('close', () => resolve(buffer.trim()));
  });
}

describe('relay transport socket layer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'relay-transport-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('accepts a valid relay envelope and forwards the event to the owner handler', async () => {
    const socketPath = join(tempDir, 'relay.sock');
    const received: OpenClawEvent[] = [];
    const server = startRelayServer({
      socketPath,
      maxPayloadBytes: 4096,
      authToken: 'shared-secret',
      logger: createLogger(),
      onEvent: async (event) => {
        received.push(event);
      },
      onFatalError: jest.fn(),
    });

    try {
      await sendRelayEvent({
        socketPath,
        authToken: 'shared-secret',
        maxPayloadBytes: 4096,
        relayTimeoutMs: 500,
        event: createEvent('accepted-event'),
      });

      expect(received).toHaveLength(1);
      expect(received[0]?.eventId).toBe('accepted-event');
    } finally {
      await closeServer(server);
    }
  });

  it('rejects relay envelopes with an invalid auth token', async () => {
    const socketPath = join(tempDir, 'relay.sock');
    const received: OpenClawEvent[] = [];
    const server = startRelayServer({
      socketPath,
      maxPayloadBytes: 4096,
      authToken: 'expected-secret',
      logger: createLogger(),
      onEvent: async (event) => {
        received.push(event);
      },
      onFatalError: jest.fn(),
    });

    try {
      const response = await readRawRelayResponse(
        socketPath,
        `${JSON.stringify({ authToken: 'wrong-secret', event: createEvent('rejected-event') })}\n`,
      );

      expect(response).toContain('"ok":false');
      expect(response).toContain('invalid transport auth token');
      expect(received).toHaveLength(0);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects oversized relay payloads before decoding the envelope', async () => {
    const socketPath = join(tempDir, 'relay.sock');
    const server = startRelayServer({
      socketPath,
      maxPayloadBytes: 64,
      logger: createLogger(),
      onEvent: async () => undefined,
      onFatalError: jest.fn(),
    });

    try {
      const largeContent = 'x'.repeat(512);
      const response = await readRawRelayResponse(
        socketPath,
        `${JSON.stringify({ event: createEvent(`oversized-${largeContent}`) })}\n`,
      );

      expect(response).toContain('"ok":false');
      expect(response).toContain('payload too large');
    } finally {
      await closeServer(server);
    }
  });

  it('surfaces relay acknowledgement failures from the owner socket', async () => {
    const socketPath = join(tempDir, 'ack.sock');
    const server = createServer((socket) => {
      socket.once('data', () => {
        socket.end(`${JSON.stringify({ ok: false, error: 'relay denied by owner' })}\n`);
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    try {
      await expect(
        sendRelayEvent({
          socketPath,
          maxPayloadBytes: 4096,
          relayTimeoutMs: 500,
          event: createEvent('denied-event'),
        }),
      ).rejects.toThrow('relay denied by owner');
    } finally {
      await closeServer(server);
    }
  });

  it('rejects relay connections that close without an acknowledgement', async () => {
    const socketPath = join(tempDir, 'silent.sock');
    const server = createServer((socket) => {
      socket.once('data', () => {
        socket.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    try {
      await expect(
        sendRelayEvent({
          socketPath,
          maxPayloadBytes: 4096,
          relayTimeoutMs: 500,
          event: createEvent('silent-event'),
        }),
      ).rejects.toThrow('relay closed without acknowledgement');
    } finally {
      await closeServer(server);
    }
  });
});
