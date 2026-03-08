import { createSubagentEndedEvent } from '../../src/hooks/subagent-hooks';

describe('createSubagentEndedEvent', () => {
  it('includes normalized endReason when the runtime provides one', () => {
    const event = createSubagentEndedEvent({
      childSessionKey: 'child-42',
      endReason: 'completed',
      data: {
        childAgentId: 'child-agent',
      },
    });

    expect(event.type).toBe('subagent.ended');
    expect(event.data).toMatchObject({
      childSessionKey: 'child-42',
      childAgentId: 'child-agent',
      endReason: 'completed',
    });
  });

  it('defaults endReason to unknown for older runtimes', () => {
    const event = createSubagentEndedEvent({
      childSessionKey: 'child-legacy',
    });

    expect(event.data).toMatchObject({
      childSessionKey: 'child-legacy',
      endReason: 'unknown',
    });
  });

  it('keeps the canonical endReason even when passthrough data contains a conflicting value', () => {
    const event = createSubagentEndedEvent({
      childSessionKey: 'child-conflict',
      endReason: 'released',
      data: {
        endReason: 'completed',
      },
    });

    expect(event.data).toMatchObject({
      childSessionKey: 'child-conflict',
      endReason: 'released',
    });
  });
});
