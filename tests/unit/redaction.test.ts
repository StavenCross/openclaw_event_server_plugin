import { redactEvent } from '../../src/events/redaction';
import { OpenClawEvent } from '../../src/events/types';

function createEvent(): OpenClawEvent {
  return {
    eventId: 'event-1',
    schemaVersion: '1.1.0',
    type: 'tool.called',
    timestamp: new Date().toISOString(),
    pluginVersion: '1.0.0',
    data: {
      content: 'secret',
      params: {
        token: 'abc123',
      },
      keep: 'value',
    },
    metadata: {
      authorization: 'Bearer x',
    },
  };
}

describe('redactEvent', () => {
  it('returns original event when redaction is disabled', () => {
    const event = createEvent();
    const redacted = redactEvent(event, {
      enabled: false,
      replacement: '[REDACTED]',
      fields: ['content'],
    });
    expect(redacted).toBe(event);
  });

  it('redacts configured keys recursively when enabled', () => {
    const event = createEvent();
    const redacted = redactEvent(event, {
      enabled: true,
      replacement: '[MASKED]',
      fields: ['content', 'token', 'authorization'],
    });

    expect(redacted).not.toBe(event);
    expect(redacted.data.content).toBe('[MASKED]');
    expect((redacted.data.params as Record<string, unknown>).token).toBe('[MASKED]');
    expect((redacted.metadata as Record<string, unknown>).authorization).toBe('[MASKED]');
    expect(redacted.data.keep).toBe('value');
  });

  it('handles circular references without throwing', () => {
    const circular: Record<string, unknown> = { safe: 'ok' };
    circular.self = circular;

    const event = createEvent();
    event.data = {
      payload: circular,
      token: 'secret',
    };

    const redacted = redactEvent(event, {
      enabled: true,
      replacement: '[REDACTED]',
      fields: ['token'],
    });

    expect((redacted.data.payload as Record<string, unknown>).safe).toBe('ok');
    expect((redacted.data.payload as Record<string, unknown>).self).toBe('[REDACTED]');
    expect(redacted.data.token).toBe('[REDACTED]');
  });
});
