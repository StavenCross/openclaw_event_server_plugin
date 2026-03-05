import { SubagentTracker } from '../../src/hooks/subagent-tracker';

describe('SubagentTracker', () => {
  it('registers spawn and resolves by child session key', () => {
    const tracker = new SubagentTracker();
    tracker.registerSpawn({
      childSessionKey: 'child-1',
      parentAgentId: 'parent-1',
      childAgentId: 'child-agent-1',
      nowMs: 1000,
    });

    const record = tracker.getByChildSessionKey('child-1');
    expect(record?.parentAgentId).toBe('parent-1');
    expect(record?.childAgentId).toBe('child-agent-1');
    expect(record?.lastActiveAt).toBe(1000);
  });

  it('observes activity and emits idle transition once', () => {
    const tracker = new SubagentTracker();
    tracker.registerSpawn({
      childSessionKey: 'child-2',
      parentAgentId: 'parent-2',
      nowMs: 0,
    });

    expect(tracker.evaluateIdleTransitions(10_000, 5_000)).toHaveLength(0);
    const transitions = tracker.evaluateIdleTransitions(10_000, 11_000);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.childSessionKey).toBe('child-2');

    // Subsequent evaluations do not re-emit until new activity.
    expect(tracker.evaluateIdleTransitions(10_000, 20_000)).toHaveLength(0);

    tracker.observeActivity('child-2', 21_000);
    expect(tracker.evaluateIdleTransitions(10_000, 25_000)).toHaveLength(0);
    expect(tracker.evaluateIdleTransitions(10_000, 32_000)).toHaveLength(1);
  });

  it('supports markEnded and ignores ended records for idle transitions', () => {
    const tracker = new SubagentTracker();
    tracker.registerSpawn({
      childSessionKey: 'child-3',
      nowMs: 0,
    });

    tracker.markEnded('child-3', 500);
    expect(tracker.evaluateIdleTransitions(10_000, 30_000)).toHaveLength(0);
  });

  it('clears records', () => {
    const tracker = new SubagentTracker();
    tracker.registerSpawn({
      childSessionKey: 'child-4',
    });
    tracker.clear();
    expect(tracker.getByChildSessionKey('child-4')).toBeUndefined();
  });
});
