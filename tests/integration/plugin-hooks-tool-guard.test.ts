/**
 * Integration tests for plugin hook handlers.
 */

import {
  MockOpenClawApi,
} from '../mocks/openclaw-runtime';
import { MockWebhookReceiver } from '../mocks/openclaw-runtime';
import plugin from '../../src/index';
import { OpenClawEvent } from '../../src/events/types';
import { stopBroadcastServer } from '../../src/broadcast/websocketServer';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Plugin Hook Integration', () => {
  let api: MockOpenClawApi;
  let receiver: MockWebhookReceiver;
  let tempDir: string;
  let nextWsPortBase = 9100;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitForEvents = async (count: number, timeoutMs = 1500): Promise<void> => {
    const start = Date.now();
    while (receiver.receivedEvents.length < count && Date.now() - start < timeoutMs) {
      await wait(25);
    }
    if (receiver.receivedEvents.length < count) {
      throw new Error(`Timed out waiting for ${count} events, got ${receiver.receivedEvents.length}`);
    }
  };

  const latestEventByType = (expectedType: string): OpenClawEvent => {
    for (let index = receiver.receivedEvents.length - 1; index >= 0; index -= 1) {
      const event = receiver.receivedEvents[index];
      if (event.type === expectedType) {
        return event;
      }
    }
    throw new Error(`Expected emitted event of type ${expectedType}`);
  };

  const waitForEventType = async (expectedType: string, timeoutMs = 2000): Promise<OpenClawEvent> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (let index = receiver.receivedEvents.length - 1; index >= 0; index -= 1) {
        const event = receiver.receivedEvents[index];
        if (event.type === expectedType) {
          return event;
        }
      }
      await wait(25);
    }
    throw new Error(`Timed out waiting for emitted event of type ${expectedType}`);
  };

  beforeEach(async () => {
    api = new MockOpenClawApi();
    api.config = {
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

    plugin.activate(api);
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
  });

  it('returns before_tool_call block decision from hookBridge toolGuard local script', async () => {
    await plugin.deactivate();

    const guardScriptPath = join(tempDir, 'tool-guard.sh');
    await writeFile(
      guardScriptPath,
      '#!/bin/sh\nread payload\nif echo "$payload" | grep -q "sudo"; then\n  printf \'{"block":true,"blockReason":"manual approval required"}\'\nfi\n',
      'utf8',
    );
    await chmod(guardScriptPath, 0o755);

    api.config = {
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
    receiver.clear();

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
    });

    await waitForEventType('tool.guard.blocked');
    expect(receiver.receivedEvents.some((event) => event.type === 'tool.guard.matched')).toBe(true);
    const blocked = latestEventByType('tool.guard.blocked');
    const blockedParams = blocked.data.params as Record<string, unknown>;
    expect(blockedParams.__toolGuardBlocked).toBe(true);
    expect(blockedParams.command).toBeNull();
  });

  it('redacts tool.guard event params only when toolGuard redaction is enabled', async () => {
    await plugin.deactivate();

    const guardScriptPath = join(tempDir, 'tool-guard-redact.sh');
    await writeFile(
      guardScriptPath,
      '#!/bin/sh\nprintf \'{"block":true,"blockReason":"blocked"}\'\n',
      'utf8',
    );
    await chmod(guardScriptPath, 0o755);

    api.config = {
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
    receiver.clear();

    await api.triggerTypedHook(
      'before_tool_call',
      {
        toolName: 'exec',
        params: { command: 'sudo whoami' },
        toolCallId: 'tool-guard-redact',
      },
      { agentId: 'guard-agent', sessionId: 'guard-session', sessionKey: 'guard-session' },
    );

    await waitForEvents(4);
    let guardDecisionEvent: OpenClawEvent | undefined;
    for (let index = receiver.receivedEvents.length - 1; index >= 0; index -= 1) {
      const event = receiver.receivedEvents[index];
      if (event.type === 'tool.guard.blocked' || event.type === 'tool.guard.allowed') {
        guardDecisionEvent = event;
        break;
      }
    }
    if (!guardDecisionEvent) {
      throw new Error(
        `Expected a tool.guard decision event, saw: ${receiver.receivedEvents
          .map((event) => event.type)
          .join(', ')}`,
      );
    }
    const decisionParams = guardDecisionEvent.data.params as Record<string, unknown>;
    expect(decisionParams.command).toBe('[REDACTED]');
  });

  it('re-evaluates guard rules after retry backoff window expires', async () => {
    await plugin.deactivate();

    api = new MockOpenClawApi();
    api.config = {
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
