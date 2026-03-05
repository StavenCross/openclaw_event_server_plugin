/**
 * Integration tests for plugin hook handlers.
 */

import {
  MockOpenClawApi,
  createMockCommand,
  createMockGatewayStartup,
  createMockMessageReceived,
  createMockMessageSent,
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

  const waitForRequest = async (
    predicate: (request: { body: unknown }) => boolean,
    timeoutMs = 1500,
  ): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (receiver.requests.some((request) => predicate(request))) {
        return;
      }
      await wait(25);
    }
    throw new Error('Timed out waiting for matching webhook request');
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

  it('registers expected internal hooks', () => {
    const hooks = api.getHooks();
    const expectedInternal = [
      'message:received',
      'message:transcribed',
      'message:preprocessed',
      'message:sent',
      'command:new',
      'command:reset',
      'command:stop',
      'agent:bootstrap',
      'agent:error',
      'agent:session:start',
      'agent:session:end',
      'gateway:startup',
    ];

    for (const event of expectedInternal) {
      expect(hooks.find((h) => h.event === event && h.kind === 'internal')).toBeDefined();
    }
  });

  it('registers expected typed plugin hooks', () => {
    const hooks = api.getHooks();
    const expectedTyped = [
      'before_tool_call',
      'after_tool_call',
      'tool_result_persist',
      'session_start',
      'session_end',
      'subagent_spawning',
      'subagent_spawned',
      'subagent_ended',
      'gateway_start',
      'gateway_stop',
    ];

    for (const event of expectedTyped) {
      expect(hooks.find((h) => h.event === event && h.kind === 'typed')).toBeDefined();
    }
  });

  it('broadcasts message received/sent from message hooks', async () => {
    await api.triggerHook('message:received', createMockMessageReceived());
    await api.triggerHook('message:sent', createMockMessageSent());
    await waitForEvents(2);

    expect(latestEventByType('message.received').eventCategory).toBe('message');
    expect(latestEventByType('message.sent').eventCategory).toBe('message');
  });

  it('broadcasts message.transcribed and message.preprocessed only from message hooks', async () => {
    await api.triggerHook('message:transcribed', {
      type: 'message',
      action: 'transcribed',
      sessionKey: 'session-transcribed-1',
      context: {
        from: '+123',
        content: 'voice message',
        channelId: 'whatsapp',
        transcript: 'transcribed text',
      },
    });

    await api.triggerHook('message:preprocessed', {
      type: 'message',
      action: 'preprocessed',
      sessionKey: 'session-preprocessed-1',
      context: {
        from: '+123',
        content: 'normalized message',
        channelId: 'whatsapp',
      },
    });

    await waitForEvents(2);

    expect(latestEventByType('message.transcribed').eventName).toBe('message:transcribed');
    expect(latestEventByType('message.preprocessed').eventName).toBe('message:preprocessed');
  });

  it('keeps command events as command.* (no synthetic session spawn/end reinterpretation)', async () => {
    await api.triggerHook('command:new', createMockCommand('new', { sessionKey: 'command-session-1' }));
    await api.triggerHook('command:reset', createMockCommand('reset', { sessionKey: 'command-session-1' }));
    await api.triggerHook('command:stop', createMockCommand('stop', { sessionKey: 'command-session-1' }));
    await waitForEvents(3);

    expect(latestEventByType('command.new').eventCategory).toBe('command');
    expect(latestEventByType('command.reset').eventCategory).toBe('command');
    expect(latestEventByType('command.stop').eventCategory).toBe('command');
    expect(receiver.receivedEvents.some((event) => event.type === 'session.spawned')).toBe(false);
    expect(receiver.receivedEvents.some((event) => event.type === 'session.completed')).toBe(false);
  });

  it('broadcasts tool lifecycle and tool_result_persist from plugin hooks', async () => {
    await api.triggerTypedHook(
      'before_tool_call',
      { toolName: 'read', params: { path: 'README.md' }, toolCallId: 'call-42' },
      { agentId: 'quinn', sessionId: 'tool-session-1', sessionKey: 'tool-session-1' },
    );
    await api.triggerTypedHook(
      'after_tool_call',
      { toolName: 'read', result: { ok: true }, toolCallId: 'call-42' },
      { agentId: 'quinn', sessionId: 'tool-session-1', sessionKey: 'tool-session-1' },
    );
    await api.triggerTypedHook(
      'tool_result_persist',
      { toolName: 'read', toolCallId: 'call-42', message: { type: 'toolResult' }, isSynthetic: false },
      { agentId: 'quinn', sessionId: 'tool-session-1', sessionKey: 'tool-session-1' },
    );
    await waitForEvents(7);

    expect(latestEventByType('tool.called').eventCategory).toBe('tool');
    expect(latestEventByType('tool.completed').eventCategory).toBe('tool');
    expect(latestEventByType('tool.result_persist').eventCategory).toBe('tool');
    expect(latestEventByType('tool.called').eventName).toBe('before_tool_call');
    expect(latestEventByType('tool.completed').eventName).toBe('after_tool_call');
    expect(latestEventByType('tool.result_persist').eventName).toBe('tool_result_persist');
  });

  it('dispatches hook bridge webhook action for matching tool.called event', async () => {
    await plugin.deactivate();

    api.config = {
      queue: {
        flushIntervalMs: 100,
      },
      hookBridge: {
        enabled: true,
        dryRun: false,
        allowedActionDirs: [],
        localScriptDefaults: {
          timeoutMs: 10000,
          maxPayloadBytes: 65536,
        },
        actions: {
          notify: {
            type: 'webhook',
            url: process.env.EVENT_PLUGIN_WEBHOOKS,
            method: 'POST',
          },
        },
        rules: [
          {
            id: 'exec-sudo',
            when: {
              eventType: 'tool.called',
              toolName: 'exec',
              contains: {
                'data.params.command': 'sudo',
              },
            },
            action: 'notify',
          },
        ],
      },
    };
    plugin.activate(api);
    receiver.clear();

    await api.triggerTypedHook(
      'before_tool_call',
      {
        toolName: 'exec',
        params: { command: 'sudo whoami' },
        toolCallId: 'hook-bridge-1',
      },
      { agentId: 'hook-agent', sessionId: 'hook-session', sessionKey: 'hook-session' },
    );

    await waitForRequest((request) => {
      if (typeof request.body !== 'object' || request.body === null) {
        return false;
      }
      const body = request.body as Record<string, unknown>;
      return body.ruleId === 'exec-sudo';
    });
  });

});
