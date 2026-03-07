import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type PluginConfig } from '../../src/config';
import { stopBroadcastServer } from '../../src/broadcast/websocketServer';
import { createPlugin } from '../../src/index';
import type { OpenClawEvent } from '../../src/events/types';
import {
  MockOpenClawApi,
  MockWebhookReceiver,
  createMockMessageReceived,
  createMockMessageSent,
} from '../mocks/openclaw-runtime';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForEventType(
  receiver: MockWebhookReceiver,
  expectedType: string,
  count = 1,
  timeoutMs = 4000,
): Promise<OpenClawEvent[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matches = receiver.receivedEvents.filter((event) => event.type === expectedType);
    if (matches.length >= count) {
      return matches;
    }
    await wait(25);
  }

  throw new Error(`Timed out waiting for ${count} event(s) of type ${expectedType}`);
}

async function waitForLogContains(path: string, expectedType: string, timeoutMs = 4000): Promise<string[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const raw = await readFile(path, 'utf8');
      const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.some((line) => JSON.parse(line).type === expectedType)) {
        return lines;
      }
    } catch {
      // wait for file creation
    }

    await wait(25);
  }

  throw new Error(`Timed out waiting for event log line containing type ${expectedType}`);
}

async function readLogLines(path: string): Promise<string[]> {
  try {
    const raw = await readFile(path, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function waitForPathMissing(path: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await access(path);
    } catch {
      return;
    }

    await wait(25);
  }

  throw new Error(`Timed out waiting for path removal: ${path}`);
}

describe('single-owner transport', () => {
  let tempDir: string;
  let lockPath: string;
  let socketPath: string;
  let eventLogPath: string;
  let receiver: MockWebhookReceiver;
  let receiverPort: number;
  let ownerPlugin: ReturnType<typeof createPlugin> | undefined;
  let followerPlugin: ReturnType<typeof createPlugin> | undefined;
  let ownerApi: MockOpenClawApi | undefined;
  let followerApi: MockOpenClawApi | undefined;

  type BuildConfigOverrides = Omit<Partial<PluginConfig>, 'transport' | 'queue' | 'eventLog' | 'webhooks'> & {
    transport?: Partial<PluginConfig['transport']>;
    queue?: Partial<PluginConfig['queue']>;
    eventLog?: Partial<PluginConfig['eventLog']>;
    webhooks?: PluginConfig['webhooks'];
  };

  function buildConfig(overrides?: BuildConfigOverrides): PluginConfig {
    return {
      ...DEFAULT_CONFIG,
      ...overrides,
      transport: {
        ...DEFAULT_CONFIG.transport,
        mode: 'auto',
        lockPath,
        socketPath,
        lockStaleMs: 1000,
        heartbeatMs: 250,
        relayTimeoutMs: 500,
        reconnectBackoffMs: 50,
        maxPendingEvents: 100,
        maxPayloadBytes: 65536,
        dedupeTtlMs: 5000,
        ...(overrides?.transport ?? {}),
      },
      queue: {
        ...DEFAULT_CONFIG.queue,
        flushIntervalMs: 100,
        ...(overrides?.queue ?? {}),
      },
      eventLog: {
        ...DEFAULT_CONFIG.eventLog,
        enabled: true,
        path: eventLogPath,
        format: 'summary',
        includeRuntimeLogs: false,
        ...(overrides?.eventLog ?? {}),
      },
      webhooks: overrides?.webhooks ?? [{ url: `http://127.0.0.1:${receiverPort}/events`, method: 'POST' }],
    };
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'event-plugin-transport-'));
    lockPath = join(tempDir, 'transport.lock');
    socketPath = join(tempDir, 'transport.sock');
    eventLogPath = join(tempDir, 'events.ndjson');

    receiver = new MockWebhookReceiver();
    receiverPort = await receiver.start(0);

    process.env.EVENT_PLUGIN_DISABLE_WS = 'true';
    process.env.EVENT_PLUGIN_DISABLE_STATUS_TICKER = 'true';
  });

  afterEach(async () => {
    await ownerPlugin?.deactivate();
    await followerPlugin?.deactivate();
    await receiver.stop();
    await rm(tempDir, { recursive: true, force: true });
    await stopBroadcastServer();
    delete process.env.EVENT_PLUGIN_DISABLE_WS;
    delete process.env.EVENT_PLUGIN_DISABLE_STATUS_TICKER;
  });

  it('relays follower events through a single owner and logs them once', async () => {
    ownerPlugin = createPlugin();
    followerPlugin = createPlugin();
    ownerApi = new MockOpenClawApi();
    followerApi = new MockOpenClawApi();

    ownerApi.config = buildConfig() as unknown as Record<string, unknown>;
    followerApi.config = buildConfig() as unknown as Record<string, unknown>;

    ownerPlugin.activate(ownerApi);
    followerPlugin.activate(followerApi);
    await wait(200);
    receiver.clear();

    await followerApi.triggerHook(
      'message:sent',
      createMockMessageSent({ content: 'single-owner transport relay' }),
    );

    const relayed = await waitForEventType(receiver, 'message.sent');
    expect(relayed).toHaveLength(1);
    expect(relayed[0].metadata?.transport).toMatchObject({
      route: 'relay',
      emittedByRole: 'follower',
    });

    const logLines = await waitForLogContains(eventLogPath, 'message.sent');
    const parsed = logLines.map((line) => JSON.parse(line) as { type: string; kind: string });
    expect(parsed.filter((line) => line.kind === 'event' && line.type === 'message.sent')).toHaveLength(1);
  });

  it('keeps tool guard local in follower runtimes while owner transports the resulting guard events', async () => {
    ownerPlugin = createPlugin();
    followerPlugin = createPlugin();
    ownerApi = new MockOpenClawApi();
    followerApi = new MockOpenClawApi();

    const guardScriptPath = join(tempDir, 'guard.sh');
    await writeFile(
      guardScriptPath,
      '#!/bin/sh\nprintf \'{"block":true,"blockReason":"owner relay still blocked"}\'\n',
      'utf8',
    );
    await chmod(guardScriptPath, 0o755);

    ownerApi.config = buildConfig() as unknown as Record<string, unknown>;
    followerApi.config = buildConfig({
      hookBridge: {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: false,
        dryRun: false,
        allowedActionDirs: [tempDir],
        localScriptDefaults: {
          timeoutMs: 10000,
          maxPayloadBytes: 65536,
        },
        actions: {
          guardLocal: {
            type: 'local_script',
            path: guardScriptPath,
            args: [],
          },
        },
        rules: [],
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          retryBackoffMs: 0,
          rules: [
            {
              id: 'guard-exec',
              when: { toolName: 'exec' },
              action: 'guardLocal',
            },
          ],
        },
      },
    }) as unknown as Record<string, unknown>;

    ownerPlugin.activate(ownerApi);
    followerPlugin.activate(followerApi);
    await wait(200);
    receiver.clear();

    const decision = await followerApi.triggerTypedHook(
      'before_tool_call',
      {
        toolName: 'exec',
        params: { command: 'sudo whoami' },
        toolCallId: 'relay-guard-1',
      },
      { agentId: 'guard-agent', sessionId: 'guard-session', sessionKey: 'guard-session' },
    );

    expect(decision).toMatchObject({
      block: true,
      blockReason: 'owner relay still blocked',
    });

    const blockedEvents = await waitForEventType(receiver, 'tool.guard.blocked');
    expect(blockedEvents).toHaveLength(1);
    expect(blockedEvents[0].metadata?.transport).toMatchObject({
      route: 'relay',
      emittedByRole: 'follower',
    });
  });

  it('promotes a follower to owner after the original owner stops and continues delivery', async () => {
    ownerPlugin = createPlugin();
    followerPlugin = createPlugin();
    ownerApi = new MockOpenClawApi();
    followerApi = new MockOpenClawApi();

    ownerApi.config = buildConfig() as unknown as Record<string, unknown>;
    followerApi.config = buildConfig() as unknown as Record<string, unknown>;

    ownerPlugin.activate(ownerApi);
    followerPlugin.activate(followerApi);
    await wait(200);
    receiver.clear();

    await ownerPlugin.deactivate();
    ownerPlugin = undefined;
    await wait(100);

    await followerApi.triggerHook(
      'message:received',
      createMockMessageReceived({ content: 'failover relay' }),
    );

    const delivered = await waitForEventType(receiver, 'message.received');
    expect(delivered).toHaveLength(1);

    const logLines = await waitForLogContains(eventLogPath, 'message.received');
    const parsed = logLines.map((line) => JSON.parse(line) as { type: string; kind: string });
    expect(parsed.filter((line) => line.kind === 'event' && line.type === 'message.received')).toHaveLength(1);
  });

  it('accepts follower relay only when the transport auth token matches', async () => {
    ownerPlugin = createPlugin();
    followerPlugin = createPlugin();
    ownerApi = new MockOpenClawApi();
    followerApi = new MockOpenClawApi();

    ownerApi.config = buildConfig({
      queue: {
        ...DEFAULT_CONFIG.queue,
        maxSize: 10,
      },
      transport: {
        authToken: 'shared-transport-token',
      },
    }) as unknown as Record<string, unknown>;
    followerApi.config = buildConfig({
      queue: {
        ...DEFAULT_CONFIG.queue,
        maxSize: 10,
      },
      transport: {
        authToken: 'shared-transport-token',
      },
    }) as unknown as Record<string, unknown>;

    ownerPlugin.activate(ownerApi);
    followerPlugin.activate(followerApi);
    await wait(200);
    receiver.clear();

    for (let index = 0; index < 8; index += 1) {
      await followerApi.triggerHook(
        'message:sent',
        createMockMessageSent({ content: `auth-protected relay ${index}` }),
      );
    }

    const logLines = await waitForLogContains(eventLogPath, 'message.sent');
    const parsed = logLines.map((line) => JSON.parse(line) as { type?: string; kind?: string });
    expect(parsed.filter((line) => line.kind === 'event' && line.type === 'message.sent').length).toBeGreaterThanOrEqual(1);
  });

  it('rejects follower relay events when the transport auth token is wrong', async () => {
    ownerPlugin = createPlugin();
    followerPlugin = createPlugin();
    ownerApi = new MockOpenClawApi();
    followerApi = new MockOpenClawApi();

    ownerApi.config = buildConfig({
      transport: {
        authToken: 'expected-token',
      },
    }) as unknown as Record<string, unknown>;
    followerApi.config = buildConfig({
      transport: {
        mode: 'follower',
        authToken: 'wrong-token',
      },
    }) as unknown as Record<string, unknown>;

    ownerPlugin.activate(ownerApi);
    followerPlugin.activate(followerApi);
    await wait(200);
    receiver.clear();

    await followerApi.triggerHook(
      'message:sent',
      createMockMessageSent({ content: 'rejected relay' }),
    );

    await wait(400);
    expect(receiver.receivedEvents.filter((event) => event.type === 'message.sent')).toHaveLength(0);

    const logLines = await readLogLines(eventLogPath);
    const parsed = logLines.map((line) => JSON.parse(line) as { type?: string; kind?: string });
    expect(parsed.filter((line) => line.kind === 'event' && line.type === 'message.sent')).toHaveLength(0);
  });

  it('fails over after heartbeat write failure and preserves delivery plus event logging', async () => {
    lockPath = join(tempDir, 'locks', 'transport.lock');
    socketPath = join(tempDir, 'transport.sock');
    eventLogPath = join(tempDir, 'events.ndjson');

    ownerPlugin = createPlugin();
    followerPlugin = createPlugin();
    ownerApi = new MockOpenClawApi();
    followerApi = new MockOpenClawApi();

    ownerApi.config = buildConfig() as unknown as Record<string, unknown>;
    followerApi.config = buildConfig() as unknown as Record<string, unknown>;

    ownerPlugin.activate(ownerApi);
    followerPlugin.activate(followerApi);
    await wait(200);
    receiver.clear();

    await mkdir(join(tempDir, 'locks'), { recursive: true });
    await rm(join(tempDir, 'locks'), { recursive: true, force: true });
    await waitForPathMissing(socketPath);

    await followerApi.triggerHook(
      'message:received',
      createMockMessageReceived({ content: 'heartbeat failover relay' }),
    );

    const delivered = await waitForEventType(receiver, 'message.received');
    expect(delivered).toHaveLength(1);

    const logLines = await waitForLogContains(eventLogPath, 'message.received');
    const parsed = logLines.map((line) => JSON.parse(line) as { type: string; kind: string });
    expect(parsed.filter((line) => line.kind === 'event' && line.type === 'message.received')).toHaveLength(1);
  });
});
