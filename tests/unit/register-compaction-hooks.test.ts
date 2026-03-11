import { DEFAULT_CONFIG } from '../../src/config';
import { AgentStatusReducer } from '../../src/hooks/status-reducer';
import { AgentRunTracker } from '../../src/hooks/agent-run-tracker';
import { SubagentTracker } from '../../src/hooks/subagent-tracker';
import { SessionTracker } from '../../src/hooks/session-hooks';
import { ToolCallTracker } from '../../src/hooks/tool-hooks';
import { registerCompactionHooks } from '../../src/runtime/register-compaction-hooks';
import type { RuntimeEventOps } from '../../src/runtime/runtime-events';
import type { OpenClawPluginApi, PluginState, RuntimeLogger } from '../../src/runtime/types';

function createState(): PluginState {
  return {
    config: DEFAULT_CONFIG,
    queue: undefined,
    toolTracker: new ToolCallTracker(),
    pendingToolCalls: new Map(),
    pendingToolCallsByContext: new WeakMap(),
    sessionTracker: new SessionTracker(),
    agentRunTracker: new AgentRunTracker(),
    statusReducer: new AgentStatusReducer(),
    subagentTracker: new SubagentTracker(),
    eventFileLogger: undefined,
    eventFileLoggerReady: undefined,
    statusTimer: undefined,
    isInitialized: false,
    websocketEnabled: false,
    runtimeId: 'runtime-test',
    runtimeKind: 'gateway',
    transportRole: 'owner',
    transportManager: undefined,
    hookBridge: undefined,
  };
}

function createApi(): OpenClawPluginApi & {
  handlers: Map<string, (event: unknown, ctx: unknown) => unknown>;
} {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  return {
    config: {},
    registerHook: jest.fn(),
    on: jest.fn((event: string, handler: (hookEvent: unknown, ctx: unknown) => unknown) => {
      handlers.set(event, handler);
    }),
    handlers,
  } as OpenClawPluginApi & {
    handlers: Map<string, (event: unknown, ctx: unknown) => unknown>;
  };
}

function createOps() {
  return {
    broadcastEvent: jest.fn().mockResolvedValue(undefined),
    emitAgentActivity: jest.fn().mockResolvedValue(undefined),
    emitAgentStatusTransitions: jest.fn().mockResolvedValue(undefined),
    emitSubagentIdleTransitions: jest.fn().mockResolvedValue(undefined),
    maybeInitializeQueue: jest.fn(),
    startStatusTimer: jest.fn(),
    stopStatusTimer: jest.fn(),
    transportEvent: jest.fn().mockResolvedValue(undefined),
  } as unknown as RuntimeEventOps & {
    broadcastEvent: jest.Mock;
  };
}

const logger: RuntimeLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  queue: jest.fn(),
};

describe('registerCompactionHooks', () => {
  it('registers both compaction lifecycle hooks', () => {
    const api = createApi();
    const state = createState();
    const ops = createOps();

    registerCompactionHooks(api, { state, logger, ops });

    expect(Array.from(api.handlers.keys())).toEqual(['before_compaction', 'after_compaction']);
  });

  it('broadcasts session compaction events with session-first identity', async () => {
    const api = createApi();
    const state = createState();
    const ops = createOps();

    registerCompactionHooks(api, { state, logger, ops });

    await api.handlers.get('before_compaction')?.(
      {
        messageCount: 40,
        compactingCount: 18,
        tokenCount: 3000,
        messages: [{ role: 'user', content: 'Hello' }],
        sessionFile: '/tmp/session.jsonl',
      },
      { agentId: 'agent-1', sessionId: 'session-compact-1', sessionKey: 'session-key-compact-1', runId: 'run-compact-1' },
    );
    await api.handlers.get('after_compaction')?.(
      {
        messageCount: 12,
        compactedCount: 28,
        tokenCount: 1100,
        sessionFile: '/tmp/session.jsonl',
      },
      { agentId: 'agent-1', sessionId: 'session-compact-1', sessionKey: 'session-key-compact-1', runId: 'run-compact-1' },
    );

    const emittedEvents = ops.broadcastEvent.mock.calls.map(
      ([event]) => event as { type: string; sessionId?: string; agentId?: string; data: Record<string, unknown> },
    );

    expect(emittedEvents.map((event) => event.type)).toEqual([
      'session.before_compaction',
      'session.after_compaction',
    ]);
    expect(emittedEvents[0]?.sessionId).toBe('session-compact-1');
    expect(emittedEvents[0]?.agentId).toBe('agent-1');
    expect(emittedEvents[0]?.data.compactingCount).toBe(18);
    expect(emittedEvents[0]?.data.messages).toBeUndefined();
    expect(emittedEvents[0]?.data.hasSessionFile).toBe(true);
    expect(emittedEvents[1]?.data.compactedCount).toBe(28);
    expect(emittedEvents[1]?.data.sessionFile).toBeUndefined();
    expect(state.sessionTracker.getAgentIdBySession({
      sessionId: 'session-compact-1',
      sessionKey: 'session-key-compact-1',
    })).toBe('agent-1');
  });

  it('emits full compaction payloads when privacy mode is full', async () => {
    const api = createApi();
    const state = createState();
    state.config = {
      ...state.config,
      privacy: {
        payloadMode: 'full',
      },
    };
    const ops = createOps();

    registerCompactionHooks(api, { state, logger, ops });

    await api.handlers.get('before_compaction')?.(
      {
        messageCount: 40,
        compactingCount: 18,
        tokenCount: 3000,
        messages: [{ role: 'user', content: 'Hello' }],
        sessionFile: '/tmp/session.jsonl',
      },
      { agentId: 'agent-1', sessionId: 'session-compact-1', sessionKey: 'session-key-compact-1', runId: 'run-compact-1' },
    );

    const emittedEvent = ops.broadcastEvent.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(emittedEvent.data.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(emittedEvent.data.sessionFile).toBe('/tmp/session.jsonl');
  });
});
