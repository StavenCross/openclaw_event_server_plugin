import { DEFAULT_CONFIG } from '../../src/config';
import { AgentStatusReducer } from '../../src/hooks/status-reducer';
import { SubagentTracker } from '../../src/hooks/subagent-tracker';
import { SessionTracker } from '../../src/hooks/session-hooks';
import { ToolCallTracker } from '../../src/hooks/tool-hooks';
import { registerSubagentHooks } from '../../src/runtime/register-subagent-hooks';
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
  handlers: Record<string, (event: unknown, ctx: unknown) => unknown>;
} {
  const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};

  return {
    config: {},
    handlers,
    registerHook: jest.fn(),
    on: jest.fn((event: string, handler: (hookEvent: unknown, ctx: unknown) => unknown) => {
      handlers[event] = handler;
    }),
  } as unknown as OpenClawPluginApi & {
    handlers: Record<string, (event: unknown, ctx: unknown) => unknown>;
  };
}

const logger: RuntimeLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  queue: jest.fn(),
};

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

describe('registerSubagentHooks', () => {
  it('normalizes subagent_ended reason into canonical data.endReason', async () => {
    const state = createState();
    const api = createApi();
    const ops = createOps();

    registerSubagentHooks(api, { state, logger, ops });

    const endedHandler = api.handlers.subagent_ended;
    expect(endedHandler).toBeDefined();

    await endedHandler(
      {
        targetSessionKey: 'child-runtime',
        runId: 'run-runtime',
        reason: 'released',
        endReason: 'completed',
      },
      {
        agentId: 'parent-agent',
        sessionId: 'parent-session',
        sessionKey: 'parent-session',
      },
    );

    const endedEvent = ops.broadcastEvent.mock.calls
      .map(([event]) => event as { type: string; data: Record<string, unknown> })
      .find((event) => event.type === 'subagent.ended');

    expect(endedEvent).toBeDefined();
    expect(endedEvent?.data).toMatchObject({
      childSessionKey: 'child-runtime',
      endReason: 'released',
    });
  });

  it('falls back to unknown when subagent_ended reason is absent', async () => {
    const state = createState();
    const api = createApi();
    const ops = createOps();

    registerSubagentHooks(api, { state, logger, ops });

    const endedHandler = api.handlers.subagent_ended;
    expect(endedHandler).toBeDefined();

    await endedHandler(
      {
        targetSessionKey: 'child-runtime-legacy',
        runId: 'run-runtime-legacy',
      },
      {
        agentId: 'parent-agent',
        sessionId: 'parent-session',
        sessionKey: 'parent-session',
      },
    );

    const endedEvent = ops.broadcastEvent.mock.calls
      .map(([event]) => event as { type: string; data: Record<string, unknown> })
      .find((event) => event.type === 'subagent.ended');

    expect(endedEvent).toBeDefined();
    expect(endedEvent?.data).toMatchObject({
      childSessionKey: 'child-runtime-legacy',
      endReason: 'unknown',
    });
  });
});
