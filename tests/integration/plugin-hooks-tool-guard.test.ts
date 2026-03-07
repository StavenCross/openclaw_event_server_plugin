/**
 * Integration tests for plugin hook handlers.
 */

import {
  MockOpenClawApi,
} from '../mocks/openclaw-runtime';
import { MockWebhookReceiver } from '../mocks/openclaw-runtime';
import { createPlugin } from '../../src/index';
import { stopBroadcastServer } from '../../src/broadcast/websocketServer';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Plugin Hook Integration', () => {
  let plugin: ReturnType<typeof createPlugin>;
  let api: MockOpenClawApi;
  let receiver: MockWebhookReceiver;
  let tempDir: string;
  let nextWsPortBase = 9100;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(async () => {
    plugin = createPlugin();
    api = new MockOpenClawApi();
    api.config = {
      transport: {
        mode: 'owner',
      },
      queue: {
        flushIntervalMs: 100,
      },
    };
    receiver = new MockWebhookReceiver();
    const testPort = await receiver.start(0);
    tempDir = await mkdtemp(join(tmpdir(), 'event-plugin-integration-'));
    const wsBase = nextWsPortBase;
    nextWsPortBase += 3;

    process.env.EVENT_PLUGIN_WEBHOOKS = `http://localhost:${testPort}/events`;
    process.env.EVENT_PLUGIN_DEBUG = 'true';
    process.env.EVENT_PLUGIN_WS_PORTS = `${wsBase},${wsBase + 1},${wsBase + 2}`;
    process.env.EVENT_PLUGIN_DISABLE_WS = 'true';
    process.env.EVENT_PLUGIN_DISABLE_STATUS_TICKER = 'true';
    process.env.OPENCLAW_STATE_DIR = tempDir;

  });

  afterEach(async () => {
    await plugin.deactivate();
    await receiver.stop();
    receiver.clear();
    await rm(tempDir, { recursive: true, force: true });
    await stopBroadcastServer();
    delete process.env.EVENT_PLUGIN_WEBHOOKS;
    delete process.env.EVENT_PLUGIN_DEBUG;
    delete process.env.EVENT_PLUGIN_WS_PORTS;
    delete process.env.EVENT_PLUGIN_DISABLE_WS;
    delete process.env.EVENT_PLUGIN_DISABLE_STATUS_TICKER;
    delete process.env.OPENCLAW_STATE_DIR;
  });

  it('returns before_tool_call block decision from hookBridge toolGuard local script', async () => {
    const guardScriptPath = join(tempDir, 'tool-guard.sh');
    await writeFile(
      guardScriptPath,
      '#!/bin/sh\nread payload\nif echo "$payload" | grep -q "sudo"; then\n  printf \'{"block":true,"blockReason":"manual approval required"}\'\nfi\n',
      'utf8',
    );
    await chmod(guardScriptPath, 0o755);

    api.config = {
      transport: {
        mode: 'owner',
      },
      queue: {
        flushIntervalMs: 100,
      },
      hookBridge: {
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
          enabled: true,
          dryRun: false,
          timeoutMs: 15000,
          retryBackoffMs: 0,
          onError: 'allow',
          rules: [
            {
              id: 'guard-exec',
              when: { toolName: 'exec' },
              action: 'guardLocal',
            },
          ],
        },
      },
    };
    plugin.activate(api);
    const result = await api.triggerTypedHook(
      'before_tool_call',
      {
        toolName: 'exec',
        params: { command: 'sudo whoami' },
        toolCallId: 'tool-guard-1',
      },
      { agentId: 'guard-agent', sessionId: 'guard-session', sessionKey: 'guard-session' },
    );

    expect(result).toMatchObject({
      block: true,
      blockReason: 'manual approval required',
      params: {
        __toolGuardBlocked: true,
        command: null,
      },
    });
  });

  it('redacts tool.guard event params only when toolGuard redaction is enabled', async () => {
    const guardScriptPath = join(tempDir, 'tool-guard-redact.sh');
    await writeFile(
      guardScriptPath,
      '#!/bin/sh\nprintf \'{"block":true,"blockReason":"blocked"}\'\n',
      'utf8',
    );
    await chmod(guardScriptPath, 0o755);

    api.config = {
      transport: {
        mode: 'owner',
      },
      queue: {
        flushIntervalMs: 100,
      },
      hookBridge: {
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
          enabled: true,
          dryRun: false,
          timeoutMs: 15000,
          retryBackoffMs: 0,
          onError: 'allow',
          redaction: {
            enabled: true,
            replacement: '[REDACTED]',
            fields: ['command'],
          },
          rules: [
            {
              id: 'guard-exec',
              when: { toolName: 'exec' },
              action: 'guardLocal',
            },
          ],
        },
      },
    };
    plugin.activate(api);
    const result = await api.triggerTypedHook(
      'before_tool_call',
      {
        toolName: 'exec',
        params: { command: 'sudo whoami' },
        toolCallId: 'tool-guard-redact',
      },
      { agentId: 'guard-agent', sessionId: 'guard-session', sessionKey: 'guard-session' },
    );
    expect(result).toMatchObject({
      block: true,
      blockReason: 'blocked',
      params: {
        __toolGuardBlocked: true,
        command: null,
      },
    });
  });

  it('re-evaluates guard rules after retry backoff window expires', async () => {
    api = new MockOpenClawApi();
    api.config = {
      transport: {
        mode: 'owner',
      },
      queue: {
        flushIntervalMs: 100,
      },
      hookBridge: {
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
          enabled: true,
          dryRun: false,
          timeoutMs: 15000,
          retryBackoffMs: 150,
          retryBackoffReason: 'Retry blocked for {{toolName}}',
          onError: 'allow',
          rules: [
            {
              id: 'always-block-exec',
              when: { toolName: 'exec' },
              decision: {
                block: true,
                blockReason: 'manual approval required',
              },
            },
          ],
        },
      },
    };
    plugin.activate(api);
    receiver.clear();

    const first = await api.triggerTypedHook(
      'before_tool_call',
      { toolName: 'exec', params: { command: 'sudo whoami' }, toolCallId: 'backoff-1' },
      { agentId: 'guard-agent', sessionId: 'guard-session', sessionKey: 'guard-session' },
    );
    const second = await api.triggerTypedHook(
      'before_tool_call',
      { toolName: 'exec', params: { command: 'sudo whoami' }, toolCallId: 'backoff-2' },
      { agentId: 'guard-agent', sessionId: 'guard-session', sessionKey: 'guard-session' },
    );
    await wait(200);
    const third = await api.triggerTypedHook(
      'before_tool_call',
      { toolName: 'exec', params: { command: 'sudo whoami' }, toolCallId: 'backoff-3' },
      { agentId: 'guard-agent', sessionId: 'guard-session', sessionKey: 'guard-session' },
    );

    expect(first).toMatchObject({ block: true, blockReason: 'manual approval required' });
    expect(second).toMatchObject({ block: true, blockReason: 'Retry blocked for exec' });
    expect(third).toMatchObject({ block: true, blockReason: 'manual approval required' });
  });
});
