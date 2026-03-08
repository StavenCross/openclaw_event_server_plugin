import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../../src/config';
import type { OpenClawEvent } from '../../src/events/types';
import { TransportManager } from '../../src/transport/manager';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await wait(25);
  }

  throw new Error('timed out waiting for condition');
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

function createEvent(eventId: string): OpenClawEvent {
  return {
    eventId,
    schemaVersion: '1.0.0',
    type: 'message.sent',
    timestamp: new Date().toISOString(),
    pluginVersion: '1.0.0',
    data: {
      content: 'transport test',
    },
  };
}

describe('TransportManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'transport-manager-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('does not unlink the active owner socket when a follower stops', async () => {
    const socketPath = join(tempDir, 'transport.sock');
    const lockPath = join(tempDir, 'transport.lock');
    const ownerEvents: OpenClawEvent[] = [];
    const ownerLogger = createLogger();
    const followerLogger = createLogger();
    const relayLogger = createLogger();

    const owner = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'owner',
        socketPath,
        lockPath,
        lockStaleMs: 1000,
        heartbeatMs: 250,
        reconnectBackoffMs: 50,
      },
      logger: ownerLogger,
      runtimeId: 'owner-runtime',
      onOwnerEvent: async (event) => {
        ownerEvents.push(event);
      },
    });

    const follower = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'follower',
        socketPath,
        lockPath,
        reconnectBackoffMs: 50,
      },
      logger: followerLogger,
      runtimeId: 'follower-runtime',
      onOwnerEvent: async () => undefined,
    });

    const relay = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'follower',
        socketPath,
        lockPath,
        relayTimeoutMs: 500,
        reconnectBackoffMs: 50,
      },
      logger: relayLogger,
      runtimeId: 'relay-runtime',
      onOwnerEvent: async () => undefined,
    });

    owner.start();
    follower.start();
    relay.start();
    await wait(100);

    await follower.stop();
    await relay.dispatch(createEvent('relay-after-follower-stop'));

    await waitFor(() => ownerEvents.length === 1);
    expect(ownerEvents[0]?.eventId).toBe('relay-after-follower-stop');

    await relay.stop();
    await owner.stop();
  });

  it('demotes a broken owner and releases the transport lock when the ingest socket cannot bind', async () => {
    const socketPath = join(tempDir, 'socket-dir');
    const lockPath = join(tempDir, 'transport.lock');
    const logger = createLogger();
    const roleChanges: string[] = [];

    await mkdir(socketPath);

    const owner = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'owner',
        socketPath,
        lockPath,
        lockStaleMs: 1000,
        heartbeatMs: 250,
      },
      logger,
      runtimeId: 'owner-runtime',
      onOwnerEvent: async () => undefined,
      onRoleChange: (role) => {
        roleChanges.push(role);
      },
    });

    owner.start();

    await waitFor(() => owner.getRole() === 'follower');
    await expect(access(lockPath)).rejects.toThrow();
    expect(roleChanges).toContain('owner');
    expect(roleChanges).toContain('follower');

    await owner.stop();
  });

  it('logs when the owner relay server is actively listening', async () => {
    const socketPath = join(tempDir, 'transport.sock');
    const lockPath = join(tempDir, 'transport.lock');
    const logger = createLogger();

    const owner = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'owner',
        socketPath,
        lockPath,
        lockStaleMs: 1000,
        heartbeatMs: 250,
        reconnectBackoffMs: 50,
      },
      logger,
      runtimeId: 'owner-runtime',
      onOwnerEvent: async () => undefined,
    });

    owner.start();

    await waitFor(() =>
      logger.info.mock.calls.some(
        ([message]) =>
          typeof message === 'string' && message.includes('Owner relay server is listening'),
      ),
    );

    expect(logger.info).toHaveBeenCalledWith(
      '[Transport] Owner relay server is listening',
      expect.objectContaining({
        runtimeId: 'owner-runtime',
        transportMode: 'owner',
        role: 'owner',
        socketPath,
        lockPath,
      }),
    );

    await owner.stop();
  });

  it('retries owner acquisition after a transient relay socket bind failure', async () => {
    const socketPath = join(tempDir, 'transport.sock');
    const lockPath = join(tempDir, 'transport.lock');
    const ownerEvents: OpenClawEvent[] = [];

    // Creating a directory at the socket path forces the first bind attempt to
    // fail, which lets the test verify that owner recovery happens without a
    // process restart.
    await mkdir(socketPath);

    const owner = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'owner',
        socketPath,
        lockPath,
        lockStaleMs: 1000,
        heartbeatMs: 250,
        reconnectBackoffMs: 50,
      },
      logger: createLogger(),
      runtimeId: 'owner-runtime',
      onOwnerEvent: async (event) => {
        ownerEvents.push(event);
      },
    });

    const follower = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'follower',
        socketPath,
        lockPath,
        relayTimeoutMs: 250,
        reconnectBackoffMs: 50,
      },
      logger: createLogger(),
      runtimeId: 'follower-runtime',
      onOwnerEvent: async () => undefined,
    });

    owner.start();
    follower.start();

    await waitFor(() => owner.getRole() === 'follower');
    await follower.dispatch(createEvent('queued-during-owner-recovery'));

    await rm(socketPath, { recursive: true, force: true });

    await waitFor(() => owner.getRole() === 'owner');
    await waitFor(() => ownerEvents.length === 1);
    expect(ownerEvents[0]?.eventId).toBe('queued-during-owner-recovery');

    await follower.stop();
    await owner.stop();
  });

  it('reclaims a fresh transport lock immediately when the recorded owner pid is dead', async () => {
    const socketPath = join(tempDir, 'transport.sock');
    const lockPath = join(tempDir, 'transport.lock');
    const logger = createLogger();

    await mkdir(join(tempDir, 'placeholder'));
    await rm(join(tempDir, 'placeholder'), { recursive: true, force: true });

    await writeFile(
      lockPath,
      JSON.stringify({
        runtimeId: 'dead-runtime',
        pid: 999999,
        updatedAt: Date.now(),
        socketPath,
      }),
      'utf8',
    );

    const owner = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'owner',
        socketPath,
        lockPath,
        lockStaleMs: 60_000,
        heartbeatMs: 250,
        reconnectBackoffMs: 50,
      },
      logger,
      runtimeId: 'owner-runtime',
      onOwnerEvent: async () => undefined,
    });

    owner.start();

    await waitFor(() => owner.getRole() === 'owner');
    expect(logger.warn).toHaveBeenCalledWith(
      '[Transport] Existing owner lock belongs to a dead PID; reclaiming transport lock immediately',
      expect.objectContaining({
        runtimeId: 'owner-runtime',
        previousRuntimeId: 'dead-runtime',
        previousPid: 999999,
        reason: 'stale lock pid is no longer alive',
      }),
    );

    await owner.stop();
  });

  it('logs actionable recovery context when owner transport startup fails', async () => {
    const socketPath = join(tempDir, 'socket-dir');
    const lockPath = join(tempDir, 'transport.lock');
    const logger = createLogger();

    await mkdir(socketPath);

    const owner = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'owner',
        socketPath,
        lockPath,
        lockStaleMs: 1000,
        heartbeatMs: 250,
        reconnectBackoffMs: 50,
      },
      logger,
      runtimeId: 'owner-runtime',
      onOwnerEvent: async () => undefined,
    });

    owner.start();

    await waitFor(() =>
      logger.warn.mock.calls.some(
        ([message]) =>
          typeof message === 'string' &&
          message.includes('Demoting owner runtime to follower; follower relays may temporarily report ECONNREFUSED'),
      ),
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Demoting owner runtime to follower'),
      expect.objectContaining({
        runtimeId: 'owner-runtime',
        transportMode: 'owner',
        reason: 'owner ingest server error',
        socketPath,
        lockPath,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[Transport] Scheduling owner transport recovery attempt',
      expect.objectContaining({
        runtimeId: 'owner-runtime',
        reason: 'owner transport recovery scheduled',
        delayMs: 50,
      }),
    );

    await owner.stop();
  });

  it('logs queue depth and socket details when follower relay attempts fail', async () => {
    const socketPath = join(tempDir, 'transport.sock');
    const lockPath = join(tempDir, 'transport.lock');
    const logger = createLogger();

    const follower = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'follower',
        socketPath,
        lockPath,
        relayTimeoutMs: 100,
        reconnectBackoffMs: 50,
      },
      logger,
      runtimeId: 'follower-runtime',
      onOwnerEvent: async () => undefined,
    });

    follower.start();
    await follower.dispatch(createEvent('relay-log-context'));

    await waitFor(() =>
      logger.warn.mock.calls.some(
        ([message]) =>
          typeof message === 'string' &&
          message.includes('Failed to relay event to owner; event remains queued while transport recovery is pending'),
      ),
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to relay event to owner; event remains queued'),
      expect.objectContaining({
        runtimeId: 'follower-runtime',
        transportMode: 'follower',
        reason: 'follower relay attempt failed',
        socketPath,
        lockPath,
        pendingEvents: 1,
        error: expect.stringContaining('ENOENT'),
      }),
    );

    await follower.stop();
  });

  it('can disable semantic dedupe while keeping eventId dedupe active', async () => {
    const socketPath = join(tempDir, 'transport.sock');
    const lockPath = join(tempDir, 'transport.lock');
    const ownerEvents: OpenClawEvent[] = [];

    const owner = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'owner',
        socketPath,
        lockPath,
        semanticDedupeEnabled: false,
      },
      logger: createLogger(),
      runtimeId: 'owner-runtime',
      onOwnerEvent: async (event) => {
        ownerEvents.push(event);
      },
    });

    owner.start();
    await wait(100);

    await owner.dispatch(createEvent('repeat-a'));
    await owner.dispatch(createEvent('repeat-b'));

    expect(ownerEvents.map((event) => event.eventId)).toEqual(['repeat-a', 'repeat-b']);

    await owner.stop();
  });
});
