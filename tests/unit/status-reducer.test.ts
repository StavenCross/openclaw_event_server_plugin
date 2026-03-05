import { AgentStatusReducer } from '../../src/hooks/status-reducer';

describe('AgentStatusReducer', () => {
  it('transitions through working -> idle -> sleeping by activity age', () => {
    const reducer = new AgentStatusReducer({ workingWindowMs: 30, sleepingWindowMs: 100 });

    reducer.observeActivity('agent-1', 'session-1', 0);

    const working = reducer.evaluateTransitions(10);
    expect(working).toHaveLength(1);
    expect(working[0]?.status).toBe('working');

    const idle = reducer.evaluateTransitions(60);
    expect(idle).toHaveLength(1);
    expect(idle[0]?.status).toBe('idle');

    const sleeping = reducer.evaluateTransitions(200);
    expect(sleeping).toHaveLength(1);
    expect(sleeping[0]?.status).toBe('sleeping');
  });

  it('prioritizes offline and error states', () => {
    const reducer = new AgentStatusReducer();
    reducer.observeActivity('agent-2', 'session-2', Date.now());

    reducer.markAgentError('agent-2', true);
    const errorTransitions = reducer.evaluateTransitions();
    expect(errorTransitions[0]?.status).toBe('error');

    reducer.markAgentOffline('agent-2', true);
    const offlineTransitions = reducer.evaluateTransitions();
    expect(offlineTransitions[0]?.status).toBe('offline');

    reducer.markAgentOffline('agent-2', false);
    reducer.markAgentError('agent-2', false);
    const recoveredTransitions = reducer.evaluateTransitions();
    expect(recoveredTransitions[0]?.status).toBe('working');
  });

  it('removes session activity and supports markAllOffline + clear', () => {
    const reducer = new AgentStatusReducer({ workingWindowMs: 30, sleepingWindowMs: 100 });

    reducer.observeActivity('agent-a', 'session-a', 0);
    reducer.observeActivity('agent-b', 'session-b', 0);
    reducer.evaluateTransitions(0);

    reducer.removeSession('agent-a', 'session-a');
    const afterRemove = reducer.evaluateTransitions(0);
    expect(afterRemove.some((t) => t.agentId === 'agent-a' && t.status === 'sleeping')).toBe(true);

    reducer.markAllOffline();
    const afterOffline = reducer.evaluateTransitions(0);
    expect(afterOffline.some((t) => t.status === 'offline')).toBe(true);

    reducer.clear();
    expect(reducer.evaluateTransitions(0)).toEqual([]);
  });

  it('handles missing sessionRef without creating activity', () => {
    const reducer = new AgentStatusReducer();
    reducer.observeActivity('agent-x', undefined, Date.now());

    const transitions = reducer.evaluateTransitions();
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.status).toBe('sleeping');
  });
});
