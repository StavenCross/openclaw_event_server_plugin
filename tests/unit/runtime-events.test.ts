import { DEFAULT_CONFIG } from '../../src/config';
import type { OpenClawEvent } from '../../src/events/types';
import { AgentStatusReducer } from '../../src/hooks/status-reducer';
import { SubagentTracker } from '../../src/hooks/subagent-tracker';
import { SessionTracker } from '../../src/hooks/session-hooks';
import { ToolCallTracker } from '../../src/hooks/tool-hooks';
import { createRuntimeEventOps } from '../../src/runtime/runtime-events';
import type { PluginState, RuntimeLogger } from '../../src/runtime/types';

const mockBroadcastWebSocket = jest.fn();
const mockBroadcastToWebhooks = jest.fn<
  Promise<Array<{ success: boolean; error?: string }>>,
  unknown[]
>();
const mockQueueFactory = jest.fn();

jest.mock('../../src/broadcast/websocketServer', () => ({
  broadcastEvent: (...args: unknown[]): void => {
    mockBroadcastWebSocket(...args);
  },
}));

jest.mock('../../src/broadcast', () => ({
  broadcastToWebhooks: (...args: unknown[]): Promise<Array<{ success: boolean; error?: string }>> =>
    mockBroadcastToWebhooks(...args),
  EventQueue: function EventQueueMock(this: { enqueue: jest.Mock; stop: jest.Mock }) {
    this.enqueue = jest.fn();
    this.stop = jest.fn();
    mockQueueFactory(this);
  },
}));

function createState(): PluginState {
  return {
    config: {
      ...DEFAULT_CONFIG,
      webhooks: [{ url: 'https://example.com/events', method: 'POST' }],
    },
    queue: undefined,
    toolTracker: new ToolCallTracker(),
    pendingToolCalls: new Map(),
    pendingToolCallsByContext: new WeakMap(),
    sessionTracker: new SessionTracker(),
    statusReducer: new AgentStatusReducer(),
    subagentTracker: new SubagentTracker(),
    eventFileLogger: undefined,
    statusTimer: undefined,
    isInitialized: false,
    websocketEnabled: true,
    hookBridge: undefined,
  };
}

const logger: RuntimeLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  queue: jest.fn(),
};

function testEvent(type: OpenClawEvent['type'] = 'message.sent'): OpenClawEvent {
  return {
    eventId: `event-${Math.random()}`,
    schemaVersion: '1.1.0',
    type,
    timestamp: new Date().toISOString(),
    pluginVersion: '1.0.0',
    sessionId: 'session-1',
    data: {
      channelId: 'whatsapp',
      toolName: 'read',
    },
  };
}

describe('runtime event ops', () => {
  beforeEach(() => {
    mockBroadcastWebSocket.mockReset();
    mockBroadcastToWebhooks.mockReset();
    mockQueueFactory.mockReset();
    jest.clearAllMocks();
  });

  it('broadcasts to websocket and skips HTTP when no webhooks configured', async () => {
    const state = createState();
    state.config.webhooks = [];

    const ops = createRuntimeEventOps(state, logger);
    await ops.broadcastEvent(testEvent('message.sent'));

    expect(mockBroadcastWebSocket).toHaveBeenCalledTimes(1);
    expect(mockBroadcastToWebhooks).not.toHaveBeenCalled();
  });

  it('forwards outbound events to hook bridge when enabled', async () => {
    const state = createState();
    const onEvent = jest.fn();
    state.hookBridge = {
      onEvent,
      evaluateBeforeToolCall: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
    };

    const ops = createRuntimeEventOps(state, logger);
    await ops.broadcastEvent(testEvent('tool.called'));

    expect(onEvent).toHaveBeenCalledTimes(1);
    const forwarded = onEvent.mock.calls[0]?.[0] as OpenClawEvent;
    expect(forwarded.type).toBe('tool.called');
  });

  it('handles synchronous hook bridge dispatch errors without breaking broadcast', async () => {
    const state = createState();
    state.hookBridge = {
      onEvent: () => {
        throw new Error('boom');
      },
      evaluateBeforeToolCall: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
    };
    state.queue = undefined;
    mockBroadcastToWebhooks.mockResolvedValueOnce([{ success: true }]);

    const ops = createRuntimeEventOps(state, logger);
    await expect(ops.broadcastEvent(testEvent('tool.called'))).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      'Hook bridge dispatch failed:',
      'tool.called',
      'boom',
    );
    expect(mockBroadcastWebSocket).toHaveBeenCalledTimes(1);
  });

  it('forwards pre-redaction payload to hook bridge', async () => {
    const state = createState();
    state.config.redaction = {
      ...state.config.redaction,
      enabled: true,
      fields: ['params'],
    };

    const onEvent = jest.fn();
    state.hookBridge = {
      onEvent,
      evaluateBeforeToolCall: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
    };

    const event = testEvent('tool.called');
    event.data.params = { command: 'sudo whoami' };

    const ops = createRuntimeEventOps(state, logger);
    await ops.broadcastEvent(event);

    const forwarded = onEvent.mock.calls[0]?.[0] as OpenClawEvent;
    expect(forwarded.data.params).toEqual({ command: 'sudo whoami' });

    const wsPayload = mockBroadcastWebSocket.mock.calls[0]?.[0] as OpenClawEvent;
    expect(wsPayload.data.params).toBe('[REDACTED]');
  });

  it('filters HTTP delivery but still allows websocket broadcast', async () => {
    const state = createState();
    state.config.filters.includeTypes = ['tool.called'];

    const ops = createRuntimeEventOps(state, logger);
    await ops.broadcastEvent(testEvent('message.sent'));

    expect(mockBroadcastWebSocket).toHaveBeenCalledTimes(1);
    expect(mockBroadcastToWebhooks).not.toHaveBeenCalled();
  });

  it('initializes queue and enqueues events when queue mode is active', async () => {
    const state = createState();
    const ops = createRuntimeEventOps(state, logger);

    ops.maybeInitializeQueue();
    expect(mockQueueFactory).toHaveBeenCalledTimes(1);

    await ops.broadcastEvent(testEvent('tool.called'));
    const queueInstance = mockQueueFactory.mock.calls[0]?.[0] as { enqueue: jest.Mock };
    expect(queueInstance.enqueue).toHaveBeenCalledTimes(1);
  });

  it('sends directly to webhooks and handles delivery errors', async () => {
    const state = createState();
    const ops = createRuntimeEventOps(state, logger);
    state.queue = undefined;

    mockBroadcastToWebhooks.mockResolvedValueOnce([{ success: true }]);
    await ops.broadcastEvent(testEvent('tool.called'));
    expect(mockBroadcastToWebhooks).toHaveBeenCalledTimes(1);

    mockBroadcastToWebhooks.mockRejectedValueOnce(new Error('delivery failed'));
    await expect(ops.broadcastEvent(testEvent('tool.called'))).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('redacts payload fields when enabled before websocket and webhook delivery', async () => {
    const state = createState();
    state.config.redaction = {
      ...state.config.redaction,
      enabled: true,
      fields: ['content', 'params'],
    };
    state.queue = undefined;

    const event = testEvent('tool.called');
    event.data.content = 'hello world';
    event.data.params = { command: 'rm -rf /' };
    mockBroadcastToWebhooks.mockResolvedValueOnce([{ success: true }]);

    const ops = createRuntimeEventOps(state, logger);
    await ops.broadcastEvent(event);

    const wsPayload = mockBroadcastWebSocket.mock.calls[0]?.[0] as OpenClawEvent;
    const webhookPayload = mockBroadcastToWebhooks.mock.calls[0]?.[0] as OpenClawEvent;

    expect(wsPayload.data.content).toBe('[REDACTED]');
    expect(wsPayload.data.params).toBe('[REDACTED]');
    expect(webhookPayload.data.content).toBe('[REDACTED]');
    expect(webhookPayload.data.params).toBe('[REDACTED]');
    expect(event.data.content).toBe('hello world');
  });

  it('signs outbound payload when hmac is enabled', async () => {
    const state = createState();
    state.config.security.hmac.enabled = true;
    state.config.security.hmac.secret = 'test-secret';
    state.queue = undefined;
    mockBroadcastToWebhooks.mockResolvedValueOnce([{ success: true }]);

    const ops = createRuntimeEventOps(state, logger);
    await ops.broadcastEvent(testEvent('tool.called'));

    const wsPayload = mockBroadcastWebSocket.mock.calls[0]?.[0] as OpenClawEvent;
    expect(wsPayload.signature?.version).toBe('v1');
    expect(typeof wsPayload.signature?.value).toBe('string');
  });

  it('emits subagent.idle transitions from tracker state', async () => {
    const state = createState();
    state.config.status.subagentIdleWindowMs = 1000;
    state.subagentTracker.registerSpawn({
      childSessionKey: 'child-session-1',
      parentAgentId: 'parent-agent-1',
      childAgentId: 'child-agent-1',
      nowMs: 0,
    });

    const ops = createRuntimeEventOps(state, logger);
    await ops.emitSubagentIdleTransitions('tool.called');

    const types = mockBroadcastWebSocket.mock.calls
      .map((call) => (call[0] as OpenClawEvent).type)
      .filter(Boolean);
    expect(types).toContain('subagent.idle');
    expect(types).toContain('agent.activity');
  });

  it('does not emit synthetic agent.activity for subagent.idle when identity is unknown', async () => {
    const state = createState();
    state.config.status.subagentIdleWindowMs = 1000;
    state.subagentTracker.registerSpawn({
      childSessionKey: 'child-session-missing-identity',
      nowMs: 0,
    });

    const ops = createRuntimeEventOps(state, logger);
    await ops.emitSubagentIdleTransitions('tool.called');

    const emittedEvents = mockBroadcastWebSocket.mock.calls.map((call) => call[0] as OpenClawEvent);
    expect(emittedEvents.some((event) => event.type === 'subagent.idle')).toBe(true);
    expect(emittedEvents.some((event) => event.type === 'agent.activity')).toBe(false);
  });

  it('manages status ticker lifecycle and emits transitions', async () => {
    jest.useFakeTimers();

    try {
      const state = createState();
      const ops = createRuntimeEventOps(state, logger);
      const tick = jest.fn();

      ops.startStatusTimer(10, tick);
      ops.startStatusTimer(10, tick);
      jest.advanceTimersByTime(25);
      expect(tick).toHaveBeenCalled();

      await ops.emitAgentActivity({
        agentId: 'agent-1',
        sessionId: 'session-1',
        sourceEventType: 'tool.called',
        activity: 'Using Tool',
        activityDetail: 'Calling read',
      });

      // No-op branch for missing agentId
      await ops.emitAgentActivity({
        sourceEventType: 'tool.called',
        activity: 'Using Tool',
        activityDetail: 'Calling read',
      });

      await ops.emitAgentStatusTransitions('tool.called');
      ops.stopStatusTimer();
      ops.stopStatusTimer();
    } finally {
      jest.useRealTimers();
    }
  });
});
