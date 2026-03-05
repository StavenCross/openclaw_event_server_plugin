import { SessionTracker } from '../../src/hooks/session-hooks';
import {
  classifyAgentError,
  getApiConfig,
  getWebSocketPorts,
  isStatusTickerDisabled,
  isWebSocketDisabled,
  normalizeError,
  resolveAgentId,
  resolveSessionRefs,
} from '../../src/runtime/utils';

describe('runtime utils', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('parses websocket port list with dedupe and fallback', () => {
    process.env.EVENT_PLUGIN_WS_PORTS = '9011,9012,9012,not-a-port,70000';
    expect(getWebSocketPorts([1, 2])).toEqual([9011, 9012]);

    process.env.EVENT_PLUGIN_WS_PORTS = 'bad';
    expect(getWebSocketPorts([1, 2])).toEqual([1, 2]);

    delete process.env.EVENT_PLUGIN_WS_PORTS;
    expect(getWebSocketPorts([5, 6])).toEqual([5, 6]);
  });

  it('reads env toggles', () => {
    process.env.EVENT_PLUGIN_DISABLE_WS = '1';
    expect(isWebSocketDisabled()).toBe(true);

    process.env.EVENT_PLUGIN_DISABLE_WS = 'false';
    expect(isWebSocketDisabled()).toBe(false);

    process.env.EVENT_PLUGIN_DISABLE_STATUS_TICKER = 'true';
    expect(isStatusTickerDisabled()).toBe(true);

    delete process.env.EVENT_PLUGIN_DISABLE_STATUS_TICKER;
    process.env.NODE_ENV = 'test';
    expect(isStatusTickerDisabled()).toBe(true);

    process.env.NODE_ENV = 'production';
    expect(isStatusTickerDisabled()).toBe(false);
  });

  it('normalizes errors from multiple shapes', () => {
    const err = normalizeError(new Error('boom'));
    expect(err.message).toBe('boom');

    const obj = normalizeError({ message: 'bad', code: 'E1', stack: 'stack' });
    expect(obj).toMatchObject({ message: 'bad', code: 'E1', stack: 'stack' });

    const value = normalizeError('plain');
    expect(value.message).toBe('plain');
  });

  it('resolves session refs and agent id from context and tracker', () => {
    const refs = resolveSessionRefs(
      {
        sessionId: 'session-1',
        context: { sessionKey: 'session-key-1' },
      },
      { sessionKey: 'session-key-ctx' },
    );
    expect(refs.sessionId).toBe('session-1');
    expect(refs.sessionKey).toBe('session-key-ctx');

    const tracker = new SessionTracker();
    tracker.startSession({ sessionId: 'session-2', sessionKey: 'session-key-2', agentId: 'agent-2' });

    const direct = resolveAgentId({
      sessionTracker: tracker,
      hookEvent: { context: { agentId: 'agent-direct' } },
      sessionRefs: { sessionId: 'session-2' },
    });
    expect(direct).toBe('agent-direct');

    const fromTracker = resolveAgentId({
      sessionTracker: tracker,
      hookEvent: {},
      sessionRefs: { sessionId: 'session-2' },
    });
    expect(fromTracker).toBe('agent-2');
  });

  it('classifies offline-like agent errors', () => {
    expect(classifyAgentError('agent unreachable')).toBe('offline');
    expect(classifyAgentError('not reachable right now')).toBe('offline');
    expect(classifyAgentError('generic failure')).toBe('error');
  });

  it('reads typed config payload from api object', () => {
    const apiStub = {
      config: { enabled: true },
      registerHook: () => {},
      on: () => {},
    };
    const config = getApiConfig<{ enabled?: boolean }>(apiStub);
    expect(config.enabled).toBe(true);

    const empty = getApiConfig<{ enabled?: boolean }>({
      ...apiStub,
      config: 'bad',
    });
    expect(empty).toEqual({});
  });
});
