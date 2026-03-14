/**
 * Integration tests for plugin hook handlers.
 */

import {
  MockOpenClawApi,
  createMockCommand,
  createMockMessageReceived,
  createMockMessageSent,
} from '../mocks/openclaw-runtime';
import { MockWebhookReceiver } from '../mocks/openclaw-runtime';
import { createPlugin } from '../../src/index';
import { OpenClawEvent } from '../../src/events/types';
import { stopBroadcastServer } from '../../src/broadcast/websocketServer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Plugin Hook Integration', () => {
  let plugin: ReturnType<typeof createPlugin>;
  let api: MockOpenClawApi;
  let receiver: MockWebhookReceiver;
  let tempDir: string;
  let nextWsPortBase = 9100;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const readLoggedEvents = async (): Promise<OpenClawEvent[]> => {
    const logPath = join(tempDir, '.event-server', 'events.ndjson');
    try {
      const raw = await readFile(logPath, 'utf8');
      return raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { kind?: string; event?: OpenClawEvent })
        .filter((entry) => entry.kind === 'event' && entry.event !== undefined)
        .map((entry) => entry.event as OpenClawEvent);
    } catch {
      return [];
    }
  };

  const getObservedEvents = async (): Promise<OpenClawEvent[]> => {
    const logged = await readLoggedEvents();
    return logged.length > 0 ? logged : receiver.receivedEvents;
  };

  const waitForEvents = async (count: number, timeoutMs = 5000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const events = await getObservedEvents();
      if (events.length >= count) {
        return;
      }
      await wait(25);
    }
    const events = await getObservedEvents();
    throw new Error(`Timed out waiting for ${count} events, got ${events.length}`);
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

  const latestEventByType = async (expectedType: string): Promise<OpenClawEvent> => {
    const events = await getObservedEvents();
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type === expectedType) {
        return event;
      }
    }
    throw new Error(`Expected emitted event of type ${expectedType}`);
  };

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
    delete process.env.OPENCLAW_STATE_DIR;
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
      'before_model_resolve',
      'before_prompt_build',
      'llm_input',
      'llm_output',
      'agent_end',
      'before_compaction',
      'after_compaction',
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

    expect((await latestEventByType('message.received')).eventCategory).toBe('message');
    expect((await latestEventByType('message.sent')).eventCategory).toBe('message');
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

    expect((await latestEventByType('message.transcribed')).eventName).toBe('message:transcribed');
    expect((await latestEventByType('message.preprocessed')).eventName).toBe('message:preprocessed');
  });

  it('keeps command events as command.* (no synthetic session spawn/end reinterpretation)', async () => {
    await api.triggerHook('command:new', createMockCommand('new', { sessionKey: 'command-session-1' }));
    await api.triggerHook('command:reset', createMockCommand('reset', { sessionKey: 'command-session-1' }));
    await api.triggerHook('command:stop', createMockCommand('stop', { sessionKey: 'command-session-1' }));
    await waitForEvents(3);

    const loggedEvents = await readLoggedEvents();
    expect((await latestEventByType('command.new')).eventCategory).toBe('command');
    expect((await latestEventByType('command.reset')).eventCategory).toBe('command');
    expect((await latestEventByType('command.stop')).eventCategory).toBe('command');
    expect(loggedEvents.some((event) => event.type === 'session.spawned')).toBe(false);
    expect(loggedEvents.some((event) => event.type === 'session.completed')).toBe(false);
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

    expect((await latestEventByType('tool.called')).eventCategory).toBe('tool');
    expect((await latestEventByType('tool.completed')).eventCategory).toBe('tool');
    expect((await latestEventByType('tool.result_persist')).eventCategory).toBe('tool');
    expect((await latestEventByType('tool.called')).eventName).toBe('before_tool_call');
    expect((await latestEventByType('tool.completed')).eventName).toBe('after_tool_call');
    expect((await latestEventByType('tool.result_persist')).eventName).toBe('tool_result_persist');
  });

  it('registers tool_result_persist as a synchronous hook handler', async () => {
    const registration = api.registeredTypedHooks.find((hook) => hook.event === 'tool_result_persist');
    expect(registration).toBeDefined();

    const result = registration?.handler(
      { toolName: 'read', toolCallId: 'call-sync', message: { type: 'toolResult' }, isSynthetic: false },
      { agentId: 'quinn', sessionId: 'tool-session-1', sessionKey: 'tool-session-1' },
    );

    expect(result).toBeUndefined();
    await waitForEvents(1);
  });

  it('preserves tool hook emission when activate() is called again in the same process', async () => {
    const reloadedApi = new MockOpenClawApi();
    reloadedApi.config = api.config;

    plugin.activate(reloadedApi);

    const reloadedHooks = reloadedApi.getHooks();
    expect(reloadedHooks.find((hook) => hook.event === 'before_tool_call' && hook.kind === 'typed')).toBeDefined();
    expect(reloadedHooks.find((hook) => hook.event === 'after_tool_call' && hook.kind === 'typed')).toBeDefined();
    expect(reloadedHooks.find((hook) => hook.event === 'tool_result_persist' && hook.kind === 'typed')).toBeDefined();

    await reloadedApi.triggerTypedHook(
      'before_tool_call',
      { toolName: 'exec', params: { command: 'echo ok' }, toolCallId: 'call-reactivate' },
      {
        agentId: 'sloan',
        sessionId: 'reactivate-session-1',
        sessionKey: 'agent:sloan:slack_markdown:direct:test:thread:reactivate',
        runId: 'run-reactivate-1',
      },
    );
    await reloadedApi.triggerTypedHook(
      'after_tool_call',
      { toolName: 'exec', result: { ok: true }, toolCallId: 'call-reactivate' },
      {
        agentId: 'sloan',
        sessionId: 'reactivate-session-1',
        sessionKey: 'agent:sloan:slack_markdown:direct:test:thread:reactivate',
        runId: 'run-reactivate-1',
      },
    );
    await reloadedApi.triggerTypedHook(
      'tool_result_persist',
      {
        toolName: 'exec',
        toolCallId: 'call-reactivate',
        message: { type: 'toolResult', content: [{ type: 'text', text: 'ok' }] },
        isSynthetic: false,
      },
      {
        agentId: 'sloan',
        sessionKey: 'agent:sloan:slack_markdown:direct:test:thread:reactivate',
      },
    );

    await waitForEvents(7);

    const calledEvent = await latestEventByType('tool.called');
    const completedEvent = await latestEventByType('tool.completed');
    const persistedEvent = await latestEventByType('tool.result_persist');

    expect(calledEvent.toolCallId).toBe('call-reactivate');
    expect(calledEvent.sessionKey).toBe('agent:sloan:slack_markdown:direct:test:thread:reactivate');
    expect(completedEvent.toolCallId).toBe('call-reactivate');
    expect(persistedEvent.toolCallId).toBe('call-reactivate');
  });

  it('dispatches hook bridge webhook action for matching tool.called event', async () => {
    await plugin.deactivate();

    api.config = {
      transport: {
        mode: 'owner',
      },
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
