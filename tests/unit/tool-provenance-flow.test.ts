import { DEFAULT_CONFIG } from '../../src/config';
import { AgentRunTracker } from '../../src/hooks/agent-run-tracker';
import { AgentStatusReducer } from '../../src/hooks/status-reducer';
import { SubagentTracker } from '../../src/hooks/subagent-tracker';
import { SessionTracker } from '../../src/hooks/session-tracker';
import { ToolCallTracker } from '../../src/hooks/tool-hooks';
import { createInternalHandlers } from '../../src/runtime/internal-handlers';
import { registerToolHooks } from '../../src/runtime/register-tool-hooks';
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

function latestEventByType(ops: ReturnType<typeof createOps>, type: string): Record<string, any> {
  const matching = ops.broadcastEvent.mock.calls
    .map(([event]) => event as Record<string, any>)
    .filter((event) => event.type === type);
  const latest = matching[matching.length - 1];
  if (!latest) {
    throw new Error(`Expected event ${type}`);
  }
  return latest;
}

describe('tool provenance flow', () => {
  it('enriches tool.called with route provenance when the tracker has linked aliases', async () => {
    const state = createState();
    const api = createApi();
    const ops = createOps();
    const internalHandlers = createInternalHandlers({ state, ops });

    registerToolHooks(api, { state, logger, ops });

    await internalHandlers.handleMessageReceived({
      sessionKey: 'agent:jacob:main',
      context: {
        sessionKey: 'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773251460.006889',
        from: 'U123',
        content: 'check status',
        channelId: 'slack',
        accountId: 'd0af9c51rbr',
        conversationId: 'conv-1',
        threadId: '1773251460.006889',
      },
    });

    await api.handlers.get('before_tool_call')?.(
      {
        toolName: 'exec',
        params: { command: 'pwd' },
        toolCallId: 'tool-call-1',
      },
      {
        agentId: 'jacob',
        sessionKey: 'agent:jacob:main',
        runId: 'run-1',
      },
    );

    const toolCalled = latestEventByType(ops, 'tool.called');

    expect(toolCalled.sessionKey).toBe('agent:jacob:main');
    expect(toolCalled.toolCallId).toBe('tool-call-1');
    expect(toolCalled.data.toolName).toBe('exec');
    expect(toolCalled.data.provenance).toMatchObject({
      resolvedSessionKey: 'agent:jacob:main',
      runId: 'run-1',
      toolCallId: 'tool-call-1',
      provider: 'slack_markdown',
      surface: 'direct',
      accountId: 'd0af9c51rbr',
      channelId: 'slack',
      conversationId: 'conv-1',
      threadId: '1773251460.006889',
      from: 'U123',
      routeResolution: 'resolved',
      sessionAliases: {
        sessionKeys: [
          'agent:jacob:main',
          'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773251460.006889',
        ],
      },
      isThreadScoped: true,
      threadKind: 'thread',
      threadToken: '1773251460.006889',
    });
  });

  it('omits ambiguous route provenance when one shared runtime alias maps to two active threads', async () => {
    const state = createState();
    const api = createApi();
    const ops = createOps();
    const internalHandlers = createInternalHandlers({ state, ops });

    registerToolHooks(api, { state, logger, ops });

    await internalHandlers.handleMessageReceived({
      sessionKey: 'agent:jacob:main',
      context: {
        sessionKey: 'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773251460.006889',
        from: 'U123',
        content: 'thread a',
        channelId: 'slack',
        accountId: 'd0af9c51rbr',
        conversationId: 'conv-a',
        threadId: '1773251460.006889',
      },
    });
    await internalHandlers.handleMessageReceived({
      sessionKey: 'agent:jacob:main',
      context: {
        sessionKey: 'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773179674.978729',
        from: 'U123',
        content: 'thread b',
        channelId: 'slack',
        accountId: 'd0af9c51rbr',
        conversationId: 'conv-b',
        threadId: '1773179674.978729',
      },
    });

    await api.handlers.get('before_tool_call')?.(
      {
        toolName: 'exec',
        params: { command: 'pwd' },
        toolCallId: 'tool-call-ambiguous',
      },
      {
        agentId: 'jacob',
        sessionKey: 'agent:jacob:main',
      },
    );

    const toolCalled = latestEventByType(ops, 'tool.called');

    expect(toolCalled.data.provenance).toMatchObject({
      resolvedSessionKey: 'agent:jacob:main',
      routeResolution: 'ambiguous',
    });
    expect(toolCalled.data.provenance.threadId).toBeUndefined();
    expect(toolCalled.data.provenance.conversationId).toBeUndefined();
    expect(toolCalled.data.provenance.sessionAliases.sessionKeys).toEqual([
      'agent:jacob:main',
      'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773179674.978729',
      'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773251460.006889',
    ]);
  });
});
