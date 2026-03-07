/**
 * Integration tests for WebSocket port fallback behavior
 */

import * as net from 'net';
import WebSocket from 'ws';
import { BroadcastWebSocketServer } from '../../src/broadcast/websocketServer';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1500,
  pollMs = 25,
): Promise<void> {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await wait(pollMs);
  }

  if (!predicate()) {
    throw new Error('Timed out waiting for condition');
  }
}

function occupyPort(port: number): Promise<net.Server> {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

function closeNetServer(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe('WebSocket Broadcast Server Fallback', () => {
  it('should start on fallback port when primary is occupied', async () => {
    const primaryPort = 9210;
    const fallbackPort = 9211;
    const blocker = await occupyPort(primaryPort);
    const server = new BroadcastWebSocketServer({
      port: primaryPort,
      fallbackPorts: [fallbackPort],
    });

    try {
      server.start();
      await waitFor(() => server.isServerRunning());

      expect(server.getPort()).toBe(fallbackPort);

      const client = new WebSocket(`ws://127.0.0.1:${fallbackPort}/`);
      await new Promise<void>((resolve, reject) => {
        client.once('open', () => resolve());
        client.once('error', reject);
      });

      await waitFor(() => server.getClientCount() === 1);
      client.close();
      await waitFor(() => server.getClientCount() === 0);
    } finally {
      await server.stop();
      await wait(25);
      await closeNetServer(blocker);
    }
  });

  it('should remain stopped when all configured ports are occupied', async () => {
    const primaryPort = 9220;
    const fallbackPort = 9221;
    const blockerOne = await occupyPort(primaryPort);
    const blockerTwo = await occupyPort(fallbackPort);
    const server = new BroadcastWebSocketServer({
      port: primaryPort,
      fallbackPorts: [fallbackPort],
    });

    try {
      server.start();
      await wait(200);
      expect(server.isServerRunning()).toBe(false);
    } finally {
      await server.stop();
      await wait(25);
      await closeNetServer(blockerOne);
      await closeNetServer(blockerTwo);
    }
  });

  it('should retry startup after transient full port exhaustion', async () => {
    const primaryPort = 9225;
    const fallbackPort = 9226;
    const blockerOne = await occupyPort(primaryPort);
    const blockerTwo = await occupyPort(fallbackPort);
    const server = new BroadcastWebSocketServer({
      port: primaryPort,
      fallbackPorts: [fallbackPort],
      startupRetryMs: 50,
    });

    try {
      server.start();
      await wait(120);
      expect(server.isServerRunning()).toBe(false);

      await closeNetServer(blockerOne);
      await closeNetServer(blockerTwo);

      await waitFor(() => server.isServerRunning(), 1500);
      expect([primaryPort, fallbackPort]).toContain(server.getPort());

      const client = new WebSocket(`ws://127.0.0.1:${server.getPort()}/`);
      await new Promise<void>((resolve, reject) => {
        client.once('open', () => resolve());
        client.once('error', reject);
      });
      client.close();
    } finally {
      await server.stop();
      await wait(25);
    }
  });

  it('should reuse configured port sequence on server restart', async () => {
    const primaryPort = 9230;
    const fallbackPort = 9231;
    const server = new BroadcastWebSocketServer({
      port: primaryPort,
      fallbackPorts: [fallbackPort],
    });

    server.start();
    await waitFor(() => server.isServerRunning());
    expect(server.getPort()).toBe(primaryPort);
    await server.stop();

    const blocker = await occupyPort(primaryPort);
    try {
      server.start();
      await waitFor(() => server.isServerRunning());
      expect(server.getPort()).toBe(fallbackPort);
    } finally {
      await server.stop();
      await wait(25);
      await closeNetServer(blocker);
    }
  });

  it('should remain running on fallback port after startup settles', async () => {
    const primaryPort = 9240;
    const fallbackPort = 9241;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const blocker = await occupyPort(primaryPort);
      const server = new BroadcastWebSocketServer({
        port: primaryPort,
        fallbackPorts: [fallbackPort],
      });

      try {
        server.start();
        await waitFor(() => server.isServerRunning());
        expect(server.getPort()).toBe(fallbackPort);

        // Give stale close/error handlers time to run; server should remain healthy.
        await wait(150);
        expect(server.isServerRunning()).toBe(true);

        const client = new WebSocket(`ws://127.0.0.1:${fallbackPort}/`);
        await new Promise<void>((resolve, reject) => {
          client.once('open', () => resolve());
          client.once('error', reject);
        });
        const closed = new Promise<void>((resolve) => {
          client.once('close', () => resolve());
        });
        client.close();
        await closed;
      } finally {
        await server.stop();
        await wait(25);
        await closeNetServer(blocker);
      }
    }
  });
});
