import { DEFAULT_CONFIG } from '../../src/config';
import { AgentStatusReducer } from '../../src/hooks/status-reducer';
import { AgentRunTracker } from '../../src/hooks/agent-run-tracker';
import { SubagentTracker } from '../../src/hooks/subagent-tracker';
import { SessionTracker } from '../../src/hooks/session-hooks';
import { ToolCallTracker } from '../../src/hooks/tool-hooks';
import { registerAgentRunHooks } from '../../src/runtime/register-agent-run-hooks';
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

describe('registerAgentRunHooks', () => {
  it('registers the modern agent lifecycle typed hooks', () => {
    const api = createApi();
    const state = createState();
    const ops = createOps();

    registerAgentRunHooks(api, { state, logger, ops });

    expect(Array.from(api.handlers.keys())).toEqual([
      'before_model_resolve',
      'before_prompt_build',
      'llm_input',
      'llm_output',
      'agent_end',
    ]);
  });

  it('broadcasts canonical agent lifecycle events and preserves session tracking', async () => {
    const api = createApi();
    const state = createState();
    const ops = createOps();

    registerAgentRunHooks(api, { state, logger, ops });

    await api.handlers.get('before_model_resolve')?.(
      { prompt: 'Choose the best model for this request.' },
      { agentId: 'agent-1', sessionId: 'session-1', sessionKey: 'session-key-1', runId: 'run-1' },
    );
    await api.handlers.get('before_prompt_build')?.(
      { prompt: 'Build the final prompt.', messages: [{ role: 'user', content: 'Hi' }] },
      { agentId: 'agent-1', sessionId: 'session-1', sessionKey: 'session-key-1', runId: 'run-1' },
    );
    await api.handlers.get('llm_input')?.(
      {
        runId: 'run-1',
        sessionId: 'session-1',
        provider: 'openai',
        model: 'gpt-5',
        prompt: 'Respond briefly.',
        historyMessages: [{ role: 'user', content: 'Hi' }],
        imagesCount: 1,
      },
      { agentId: 'agent-1', sessionId: 'session-1', sessionKey: 'session-key-1' },
    );
    await api.handlers.get('llm_output')?.(
      {
        runId: 'run-1',
        sessionId: 'session-1',
        provider: 'openai',
        model: 'gpt-5',
        assistantTexts: ['Hello back.'],
        usage: { input: 10, output: 4, total: 14 },
      },
      { agentId: 'agent-1', sessionId: 'session-1', sessionKey: 'session-key-1' },
    );
    await api.handlers.get('agent_end')?.(
      { messages: [{ role: 'assistant', content: 'Hello back.' }], success: false, error: 'boom', durationMs: 45 },
      { agentId: 'agent-1', sessionId: 'session-1', sessionKey: 'session-key-1', runId: 'run-1' },
    );

    const emittedEvents = ops.broadcastEvent.mock.calls.map(
      ([event]) => event as { type: string; sessionId?: string; agentId?: string; data: Record<string, unknown>; error?: { message: string } },
    );

    expect(emittedEvents.map((event) => event.type)).toEqual([
      'agent.before_model_resolve',
      'agent.before_prompt_build',
      'agent.llm_input',
      'agent.llm_output',
      'agent.end',
    ]);
    expect(emittedEvents[1]?.data.messageCount).toBe(1);
    expect(emittedEvents[1]?.data.promptLength).toBe('Build the final prompt.'.length);
    expect(emittedEvents[1]?.data.messages).toBeUndefined();
    expect(emittedEvents[2]?.data.historyMessageCount).toBe(1);
    expect(emittedEvents[2]?.data.promptChangedFromBeforePromptBuild).toBe(true);
    expect(emittedEvents[2]?.data.historyMessages).toBeUndefined();
    expect(emittedEvents[3]?.data.assistantTextCount).toBe(1);
    expect(emittedEvents[3]?.data.assistantTexts).toBeUndefined();
    expect(emittedEvents[4]?.error?.message).toBe('boom');
    expect(emittedEvents[4]?.data.messages).toBeUndefined();
    expect(state.sessionTracker.getAgentIdBySession({ sessionId: 'session-1', sessionKey: 'session-key-1' })).toBe(
      'agent-1',
    );
  });

  it('emits full modern lifecycle payloads when privacy mode is full', async () => {
    const api = createApi();
    const state = createState();
    state.config = {
      ...state.config,
      privacy: {
        payloadMode: 'full',
      },
    };
    const ops = createOps();

    registerAgentRunHooks(api, { state, logger, ops });

    await api.handlers.get('before_prompt_build')?.(
      { prompt: 'Build the final prompt.', messages: [{ role: 'user', content: 'Hi' }] },
      { agentId: 'agent-1', sessionId: 'session-1', sessionKey: 'session-key-1', runId: 'run-1' },
    );
    await api.handlers.get('llm_input')?.(
      {
        runId: 'run-1',
        sessionId: 'session-1',
        provider: 'openai',
        model: 'gpt-5',
        prompt: 'Respond briefly.',
        historyMessages: [{ role: 'user', content: 'Hi' }],
        imagesCount: 1,
        systemPrompt: 'Be concise.',
      },
      { agentId: 'agent-1', sessionId: 'session-1', sessionKey: 'session-key-1' },
    );
    await api.handlers.get('llm_output')?.(
      {
        runId: 'run-1',
        sessionId: 'session-1',
        provider: 'openai',
        model: 'gpt-5',
        assistantTexts: ['Hello back.'],
      },
      { agentId: 'agent-1', sessionId: 'session-1', sessionKey: 'session-key-1' },
    );

    const emittedEvents = ops.broadcastEvent.mock.calls.map(([event]) => event as { type: string; data: Record<string, unknown> });
    expect(emittedEvents[0]?.data.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(emittedEvents[1]?.data.prompt).toBe('Respond briefly.');
    expect(emittedEvents[1]?.data.historyMessages).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(emittedEvents[2]?.data.assistantTexts).toEqual(['Hello back.']);
  });

  it('skips llm_input and llm_output when no session identity is available', async () => {
    const api = createApi();
    const state = createState();
    const ops = createOps();

    registerAgentRunHooks(api, { state, logger, ops });

    await api.handlers.get('llm_input')?.(
      {
        runId: 'run-missing-session',
        provider: 'openai',
        model: 'gpt-5',
        prompt: 'Respond briefly.',
        historyMessages: [],
        imagesCount: 0,
      },
      { agentId: 'agent-1' },
    );
    await api.handlers.get('llm_output')?.(
      {
        runId: 'run-missing-session',
        provider: 'openai',
        model: 'gpt-5',
        assistantTexts: ['Hello'],
      },
      { agentId: 'agent-1' },
    );

    expect(ops.broadcastEvent).not.toHaveBeenCalled();
  });

  it('keeps lifecycle audit deltas when OpenClaw omits runId but session identity exists', async () => {
    const api = createApi();
    const state = createState();
    const ops = createOps();

    registerAgentRunHooks(api, { state, logger, ops });

    await api.handlers.get('before_model_resolve')?.(
      { prompt: 'Initial steering prompt.' },
      { agentId: 'agent-1', sessionId: 'session-no-run', sessionKey: 'session-no-run' },
    );
    await api.handlers.get('before_prompt_build')?.(
      { prompt: 'Prompt before assembly.', messages: [{ role: 'user', content: 'Hello' }] },
      { agentId: 'agent-1', sessionId: 'session-no-run', sessionKey: 'session-no-run' },
    );
    await api.handlers.get('llm_input')?.(
      {
        sessionId: 'session-no-run',
        provider: 'openai',
        model: 'gpt-5',
        prompt: 'Prompt before assembly plus final instruction.',
        historyMessages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }],
        imagesCount: 0,
      },
      { agentId: 'agent-1', sessionId: 'session-no-run', sessionKey: 'session-no-run' },
    );

    const llmInputEvent = ops.broadcastEvent.mock.calls.at(-1)?.[0] as
      | { type: string; runId?: string; data: Record<string, unknown> }
      | undefined;

    expect(llmInputEvent?.type).toBe('agent.llm_input');
    expect(llmInputEvent?.runId).toBeUndefined();
    expect(llmInputEvent?.data.promptChangedFromBeforePromptBuild).toBe(true);
    expect(llmInputEvent?.data.promptLengthDeltaFromBeforePromptBuild).toBe(
      'Prompt before assembly plus final instruction.'.length - 'Prompt before assembly.'.length,
    );
    expect(llmInputEvent?.data.promptLengthDeltaFromBeforeModelResolve).toBe(
      'Prompt before assembly plus final instruction.'.length - 'Initial steering prompt.'.length,
    );
    expect(llmInputEvent?.data.historyMessageCountDeltaFromBeforePromptBuild).toBe(1);
  });
});
