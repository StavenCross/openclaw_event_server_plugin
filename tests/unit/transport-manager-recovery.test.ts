import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../../src/config';
import { TransportManager } from '../../src/transport/manager';
import { createLogger, wait, waitFor } from './transport-manager-test-helpers';

describe('TransportManager recovery coordination', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'transport-manager-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('backs off live-owner recovery attempts and suppresses duplicate takeover-skip logs', async () => {
    const socketPath = join(tempDir, 'transport.sock');
    const lockPath = join(tempDir, 'transport.lock');
    const ownerLogger = createLogger();
    const contenderLogger = createLogger();

    const owner = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'owner',
        socketPath,
        lockPath,
        lockStaleMs: 5_000,
        heartbeatMs: 250,
        reconnectBackoffMs: 50,
      },
      logger: ownerLogger,
      runtimeId: 'owner-runtime',
      onOwnerEvent: async () => undefined,
    });

    const contender = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'owner',
        socketPath,
        lockPath,
        lockStaleMs: 5_000,
        heartbeatMs: 250,
        reconnectBackoffMs: 50,
      },
      logger: contenderLogger,
      runtimeId: 'contender-runtime',
      onOwnerEvent: async () => undefined,
    });

    owner.start();
    await waitFor(() => owner.getRole() === 'owner');

    contender.start();
    await wait(350);

    const takeoverSkipLogs = contenderLogger.info.mock.calls.filter(
      ([message]) =>
        typeof message === 'string' &&
        message.includes('Transport lock is still owned by a live runtime; owner takeover skipped'),
    );
    const recoveryScheduleLogs = contenderLogger.info.mock.calls.filter(
      ([message]) =>
        typeof message === 'string' &&
        message.includes('Scheduling owner transport recovery attempt'),
    );
    const recoveryAttemptLogs = contenderLogger.info.mock.calls.filter(
      ([message]) =>
        typeof message === 'string' && message.includes('Attempting owner transport recovery'),
    );

    expect(takeoverSkipLogs).toHaveLength(1);
    expect(recoveryAttemptLogs).toHaveLength(0);
    expect(recoveryScheduleLogs).toEqual([
      [
        '[Transport] Scheduling owner transport recovery attempt',
        expect.objectContaining({
          runtimeId: 'contender-runtime',
          reason: 'owner transport recovery scheduled',
          delayMs: 1000,
        }),
      ],
    ]);

    await contender.stop();
    await owner.stop();
  });

  it('promotes a waiting owner after the active owner stops', async () => {
    const socketPath = join(tempDir, 'transport.sock');
    const lockPath = join(tempDir, 'transport.lock');
    const ownerLogger = createLogger();
    const contenderLogger = createLogger();

    const owner = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'owner',
        socketPath,
        lockPath,
        lockStaleMs: 5_000,
        heartbeatMs: 250,
        reconnectBackoffMs: 50,
      },
      logger: ownerLogger,
      runtimeId: 'owner-runtime',
      onOwnerEvent: async () => undefined,
    });

    const contender = new TransportManager({
      config: {
        ...DEFAULT_CONFIG.transport,
        mode: 'owner',
        socketPath,
        lockPath,
        lockStaleMs: 5_000,
        heartbeatMs: 250,
        reconnectBackoffMs: 50,
      },
      logger: contenderLogger,
      runtimeId: 'contender-runtime',
      onOwnerEvent: async () => undefined,
    });

    owner.start();
    await waitFor(() => owner.getRole() === 'owner');

    contender.start();
    await wait(150);
    expect(contender.getRole()).toBe('follower');

    await owner.stop();
    await waitFor(() => contender.getRole() === 'owner', 2_500);

    expect(contenderLogger.info).toHaveBeenCalledWith(
      '[Transport] This runtime is the active transport owner',
      expect.objectContaining({
        runtimeId: 'contender-runtime',
        role: 'owner',
      }),
    );

    await contender.stop();
  });

  it('retries owner acquisition after a transient relay socket bind failure', async () => {
    const socketPath = join(tempDir, 'transport.sock');
    const lockPath = join(tempDir, 'transport.lock');
    const ownerEvents: Array<{ eventId: string }> = [];

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
        ownerEvents.push({ eventId: event.eventId });
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
    await follower.dispatch({
      eventId: 'queued-during-owner-recovery',
      schemaVersion: '1.0.0',
      type: 'message.sent',
      timestamp: new Date().toISOString(),
      pluginVersion: '1.0.0',
      data: { content: 'transport test' },
    });

    await rm(socketPath, { recursive: true, force: true });

    await waitFor(() => owner.getRole() === 'owner');
    await waitFor(() => ownerEvents.length === 1);
    expect(ownerEvents[0]?.eventId).toBe('queued-during-owner-recovery');

    await follower.stop();
    await owner.stop();
  });
});
