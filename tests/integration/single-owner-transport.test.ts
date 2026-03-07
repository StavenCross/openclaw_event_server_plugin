import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

describe('single-owner transport', () => {
  const originalTitle = process.title;
  const originalArgv = [...process.argv];
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
        mode: 'follower',
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
    process.title = originalTitle;
    process.argv = [...originalArgv];
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

    ownerApi.config = buildConfig({ transport: { mode: 'owner' } }) as unknown as Record<string, unknown>;
    followerApi.config = buildConfig({ transport: { mode: 'follower' } }) as unknown as Record<string, unknown>;

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

  it('resolves auto mode end to end so gateway owns transport and agent relays into it', async () => {
    ownerPlugin = createPlugin();
    followerPlugin = createPlugin();
    ownerApi = new MockOpenClawApi();
    followerApi = new MockOpenClawApi();

    ownerApi.config = buildConfig({ transport: { mode: 'auto' } }) as unknown as Record<string, unknown>;
    followerApi.config = buildConfig({ transport: { mode: 'auto' } }) as unknown as Record<string, unknown>;

    process.title = 'openclaw-gateway';
    process.argv = ['node', 'dist/index.js', 'gateway', '--port', '18789'];
    ownerPlugin.activate(ownerApi);

    process.title = 'openclaw-agent';
    process.argv = ['node', 'dist/index.js', 'agent', '--task', 'heartbeat'];
    followerPlugin.activate(followerApi);

    await wait(200);
    receiver.clear();

    await followerApi.triggerHook(
      'message:sent',
      createMockMessageSent({ content: 'auto-mode relay from agent runtime' }),
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

    ownerApi.config = buildConfig({ transport: { mode: 'owner' } }) as unknown as Record<string, unknown>;
    followerApi.config = buildConfig({
      transport: {
        mode: 'follower',
      },
      hookBridge: {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: false,
        dryRun: false,
        allowedActionDirs: [tempDir],
        localScriptDefaults: {
          timeoutMs: 10000,
          maxPayloadBytes: 65536,
        },
        actions: {},
        rules: [],
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          retryBackoffMs: 0,
          rules: [
            {
              id: 'guard-exec',
              when: { toolName: 'exec' },
              decision: {
                block: true,
                blockReason: 'owner relay still blocked',
              },
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

  it('keeps explicit followers from taking over transport after the owner stops', async () => {
    ownerPlugin = createPlugin();
    followerPlugin = createPlugin();
    ownerApi = new MockOpenClawApi();
    followerApi = new MockOpenClawApi();

    ownerApi.config = buildConfig({ transport: { mode: 'owner' } }) as unknown as Record<string, unknown>;
    followerApi.config = buildConfig({ transport: { mode: 'follower' } }) as unknown as Record<string, unknown>;

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

    await wait(500);
    expect(receiver.receivedEvents.filter((event) => event.type === 'message.received')).toHaveLength(0);

    const logLines = await readLogLines(eventLogPath);
    const parsed = logLines.map((line) => JSON.parse(line) as { event?: OpenClawEvent; kind?: string });
    expect(parsed.filter((line) => line.kind === 'event' && line.event?.type === 'message.received')).toHaveLength(
      0,
    );
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
        mode: 'owner',
        authToken: 'shared-transport-token',
      },
    }) as unknown as Record<string, unknown>;
    followerApi.config = buildConfig({
      queue: {
        ...DEFAULT_CONFIG.queue,
        maxSize: 10,
      },
      transport: {
        mode: 'follower',
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

});
