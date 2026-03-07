/**
 * Integration tests for plugin hook handlers.
 */

import {
  MockOpenClawApi,
  createMockGatewayStartup,
} from '../mocks/openclaw-runtime';
import { MockWebhookReceiver } from '../mocks/openclaw-runtime';
import plugin from '../../src/index';
import { OpenClawEvent } from '../../src/events/types';
import { stopBroadcastServer } from '../../src/broadcast/websocketServer';
import { mkdtemp, rm } from 'node:fs/promises';
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

  it('broadcasts session.start and session.end from plugin session hooks', async () => {
    await api.triggerTypedHook(
      'session_start',
      { sessionId: 'session-100', sessionKey: 'session-100', resumedFrom: 'session-099' },
      { agentId: 'samantha', sessionId: 'session-100', sessionKey: 'session-100' },
    );
    await api.triggerTypedHook(
      'session_end',
      { sessionId: 'session-100', sessionKey: 'session-100', messageCount: 14 },
      { agentId: 'samantha', sessionId: 'session-100', sessionKey: 'session-100' },
    );
    await waitForEvents(4);

    const start = latestEventByType('session.start');
    const end = latestEventByType('session.end');
    expect(start.data.sessionId).toBe('session-100');
    expect(end.data.sessionId).toBe('session-100');
    expect(start.eventName).toBe('session_start');
    expect(end.eventName).toBe('session_end');
  });

  it('broadcasts subagent lifecycle and synthetic agent.sub_agent_spawn', async () => {
    await api.triggerTypedHook(
      'subagent_spawning',
      {
        childSessionKey: 'child-1',
        agentId: 'child-agent',
        runId: 'run-sub-1',
        mode: 'session',
      },
      {
        agentId: 'parent-agent',
        sessionId: 'parent-session-1',
        sessionKey: 'parent-session-1',
      },
    );

    await api.triggerTypedHook(
      'subagent_spawned',
      {
        childSessionKey: 'child-1',
        agentId: 'child-agent',
        runId: 'run-sub-1',
        mode: 'session',
      },
      {
        agentId: 'parent-agent',
        sessionId: 'parent-session-1',
        sessionKey: 'parent-session-1',
      },
    );

    await api.triggerTypedHook(
      'subagent_ended',
      {
        targetSessionKey: 'child-1',
        runId: 'run-sub-1',
      },
      {
        agentId: 'parent-agent',
        sessionId: 'parent-session-1',
        sessionKey: 'parent-session-1',
      },
    );

    await waitForEvents(7);

    expect(latestEventByType('subagent.spawning').eventCategory).toBe('subagent');
    expect(latestEventByType('subagent.spawned').eventCategory).toBe('subagent');
    expect(latestEventByType('subagent.ended').eventCategory).toBe('subagent');
    expect(latestEventByType('agent.sub_agent_spawn').eventCategory).toBe('synthetic');
  });

  it('broadcasts gateway startup/start/stop events', async () => {
    await api.triggerTypedHook('gateway_start', { port: 3000 }, {});
    await api.triggerTypedHook('gateway_stop', { reason: 'shutdown' }, {});
    await api.triggerHook('gateway:startup', createMockGatewayStartup());
    await waitForEvents(3);

    expect(latestEventByType('gateway.startup').eventName).toBe('gateway:startup');
    expect(latestEventByType('gateway.start').eventName).toBe('gateway_start');
    expect(latestEventByType('gateway.stop').eventName).toBe('gateway_stop');
  });

  it('broadcasts internal agent lifecycle/error hooks and emits status transitions', async () => {
    await api.triggerHook('agent:bootstrap', {
      sessionKey: 'agent-session-1',
      context: { agentId: 'agent-alpha', note: 'booting' },
    });
    await api.triggerHook('agent:session:start', {
      sessionKey: 'agent-session-1',
      context: { agentId: 'agent-alpha' },
    });
    await api.triggerHook('agent:session:end', {
      sessionKey: 'agent-session-1',
      context: { agentId: 'agent-alpha' },
    });
    await api.triggerHook('agent:error', {
      sessionKey: 'agent-session-1',
      context: { agentId: 'agent-alpha', error: 'agent unreachable by transport' },
    });
    await waitForEvents(8);

    expect(latestEventByType('agent.bootstrap').eventName).toBe('agent:bootstrap');
    expect(latestEventByType('agent.session_start').eventName).toBe('agent:session:start');
    expect(latestEventByType('agent.session_end').eventName).toBe('agent:session:end');
    expect(latestEventByType('agent.error').eventCategory).toBe('agent');
    expect(latestEventByType('agent.status').data.status).toBe('offline');
  });

  it('emits synthetic agent.status events from reducer transitions', async () => {
    await api.triggerTypedHook(
      'before_tool_call',
      { toolName: 'edit', params: { file: 'a.ts' }, toolCallId: 'call-status-1' },
      { agentId: 'sloan', sessionId: 'status-session-1', sessionKey: 'status-session-1' },
    );

    await waitForEvents(3);

    const statusEvent = latestEventByType('agent.status');
    expect(statusEvent.agentId).toBe('sloan');
    expect(statusEvent.data.status).toBe('working');
  });

  it('deactivates cleanly', async () => {
    await expect(plugin.deactivate()).resolves.toBeUndefined();
  });
});
