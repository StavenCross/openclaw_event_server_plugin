import { access, mkdtemp, mkdir, rm } from 'node:fs/promises';
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
