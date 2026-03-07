import { DEFAULT_CONFIG } from '../../src/config';
import { AgentStatusReducer } from '../../src/hooks/status-reducer';
import { SubagentTracker } from '../../src/hooks/subagent-tracker';
import { SessionTracker } from '../../src/hooks/session-hooks';
import { ToolCallTracker } from '../../src/hooks/tool-hooks';
import { registerToolHooks } from '../../src/runtime/register-tool-hooks';
import type { RuntimeEventOps } from '../../src/runtime/runtime-events';
import type { OpenClawPluginApi, PluginState, RuntimeLogger } from '../../src/runtime/types';

function createState(): PluginState {
  return {
    config: {
      ...DEFAULT_CONFIG,
      hookBridge: {
        ...DEFAULT_CONFIG.hookBridge,
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          redaction: {
            enabled: true,
            replacement: '[REDACTED]',
            fields: ['command'],
          },
        },
      },
    },
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
    transportRole: 'owner',
    transportManager: undefined,
    hookBridge: {
      evaluateBeforeToolCall: jest.fn().mockResolvedValue({
        matched: true,
        block: true,
        blockReason: 'blocked',
        matchedRuleId: 'guard-exec',
        matchedActionId: 'guardLocal',
        decisionSource: 'action',
      }),
      onEvent: jest.fn(),
      stop: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function createApi(): OpenClawPluginApi & {
  handlers: Array<(event: unknown, ctx: unknown) => unknown>;
} {
  const handlers: Array<(event: unknown, ctx: unknown) => unknown> = [];
  return {
    config: {},
    handlers,
    registerHook: jest.fn(),
    on: jest.fn((event: string, handler: (hookEvent: unknown, ctx: unknown) => unknown) => {
      if (event === 'before_tool_call') {
        handlers.push(handler);
      }
    }),
  } as unknown as OpenClawPluginApi & { handlers: Array<(event: unknown, ctx: unknown) => unknown> };
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

describe('registerToolHooks', () => {
  it('redacts tool.guard emitted params when toolGuard redaction is enabled', async () => {
    const state = createState();
    const api = createApi();
    const ops = createOps();

    registerToolHooks(api, { state, logger, ops });

    expect(api.handlers).toHaveLength(1);

    const result = await api.handlers[0](
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

    const emittedTypes = ops.broadcastEvent.mock.calls.map(
      ([event]) => (event as { type: string }).type,
    );
    expect(emittedTypes).toEqual(
      expect.arrayContaining(['tool.called', 'tool.guard.matched', 'tool.guard.blocked']),
    );

    const blockedEvent = ops.broadcastEvent.mock.calls
      .map(([event]) => event as { type: string; data: { params: unknown } })
      .find((event) => event.type === 'tool.guard.blocked');
    expect(blockedEvent?.data.params).toEqual({
      command: '[REDACTED]',
      __toolGuardBlocked: true,
    });
  });
});
