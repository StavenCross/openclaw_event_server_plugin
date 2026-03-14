import { SessionTracker } from '../../src/hooks/session-tracker';

describe('SessionTracker provenance', () => {
  it('stores multiple aliases and route provenance for one logical session', () => {
    const tracker = new SessionTracker();

    tracker.touchSession({
      sessionId: 'session-uuid-1',
      sessionKey: 'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773251460.006889',
      aliasSessionKeys: ['agent:jacob:main'],
      agentId: 'jacob',
      runId: 'run-thread-1',
      route: {
        channelId: 'slack',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        from: 'user-1',
      },
      direction: 'inbound',
    });

    const snapshot = tracker.getSessionProvenance({
      sessionKey: 'agent:jacob:main',
      aliasSessionKeys: ['agent:jacob:main'],
      runId: 'run-thread-1',
    });

    expect(snapshot.routeResolution).toBe('resolved');
    expect(snapshot.route).toMatchObject({
      provider: 'slack_markdown',
      surface: 'direct',
      accountId: 'd0af9c51rbr',
      channelId: 'slack',
      conversationId: 'conv-1',
      threadId: '1773251460.006889',
      messageId: 'msg-1',
      from: 'user-1',
    });
    expect(snapshot.sessionAliases.sessionIds).toEqual(['session-uuid-1']);
    expect(snapshot.sessionAliases.sessionKeys).toEqual([
      'agent:jacob:main',
      'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773251460.006889',
    ]);
  });

  it('expires stale route provenance before later tool enrichment uses it', () => {
    let now = 0;
    const tracker = new SessionTracker({
      routeTtlMs: 1_000,
      now: () => now,
    });

    tracker.touchSession({
      sessionId: 'session-uuid-1',
      sessionKey: 'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773251460.006889',
      aliasSessionKeys: ['agent:jacob:main'],
      runId: 'run-thread-1',
      route: {
        channelId: 'slack',
        conversationId: 'conv-1',
      },
      direction: 'inbound',
    });

    now = 500;
    expect(
      tracker.getSessionProvenance({
        sessionKey: 'agent:jacob:main',
        aliasSessionKeys: ['agent:jacob:main'],
      }).routeResolution,
    ).toBe('resolved');

    now = 2_500;
    const expired = tracker.getSessionProvenance({
      sessionKey: 'agent:jacob:main',
      aliasSessionKeys: ['agent:jacob:main'],
    });

    expect(expired.routeResolution).toBe('unavailable');
    expect(expired.route).toBeUndefined();
    expect(expired.sessionAliases.routeKeys).toEqual([]);
  });

  it('does not merge concurrent shared runtime aliases without a disambiguator', () => {
    const tracker = new SessionTracker();

    tracker.touchSession({
      sessionId: 'session-a',
      sessionKey: 'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773251460.006889',
      aliasSessionKeys: ['agent:jacob:main'],
      runId: 'run-a',
      route: {
        channelId: 'slack',
        conversationId: 'conv-a',
      },
      direction: 'inbound',
    });
    tracker.touchSession({
      sessionId: 'session-b',
      sessionKey: 'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773179674.978729',
      aliasSessionKeys: ['agent:jacob:main'],
      runId: 'run-b',
      route: {
        channelId: 'slack',
        conversationId: 'conv-b',
      },
      direction: 'inbound',
    });

    const ambiguous = tracker.getSessionProvenance({
      sessionKey: 'agent:jacob:main',
      aliasSessionKeys: ['agent:jacob:main'],
    });

    expect(ambiguous.routeResolution).toBe('ambiguous');
    expect(ambiguous.route).toBeUndefined();
    expect(ambiguous.sessionAliases.sessionKeys).toEqual([
      'agent:jacob:main',
      'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773179674.978729',
      'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773251460.006889',
    ]);
    expect(ambiguous.sessionAliases.routeKeys).toHaveLength(2);
  });

  it('uses runId to disambiguate two shared runtime aliases when the tracker has that lineage', () => {
    const tracker = new SessionTracker();

    tracker.touchSession({
      sessionId: 'session-a',
      sessionKey: 'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773251460.006889',
      aliasSessionKeys: ['agent:jacob:main'],
      runId: 'run-a',
      route: {
        channelId: 'slack',
        conversationId: 'conv-a',
      },
      direction: 'inbound',
    });
    tracker.touchSession({
      sessionId: 'session-b',
      sessionKey: 'agent:jacob:slack_markdown:direct:d0af9c51rbr:thread:1773179674.978729',
      aliasSessionKeys: ['agent:jacob:main'],
      runId: 'run-b',
      route: {
        channelId: 'slack',
        conversationId: 'conv-b',
      },
      direction: 'inbound',
    });

    const resolved = tracker.getSessionProvenance({
      sessionKey: 'agent:jacob:main',
      aliasSessionKeys: ['agent:jacob:main'],
      runId: 'run-b',
    });

    expect(resolved.routeResolution).toBe('resolved');
    expect(resolved.route).toMatchObject({
      conversationId: 'conv-b',
      threadId: '1773179674.978729',
    });
  });
});
