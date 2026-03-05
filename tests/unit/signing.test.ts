import { signEvent } from '../../src/events/signing';
import { OpenClawEvent } from '../../src/events/types';

function createEvent(): OpenClawEvent {
  return {
    eventId: 'event-1',
    schemaVersion: '1.1.0',
    type: 'message.sent',
    timestamp: new Date().toISOString(),
    pluginVersion: '1.0.0',
    correlationId: 'corr-1',
    data: {
      content: 'hello',
    },
  };
}

describe('signEvent', () => {
  it('returns input event when signing is disabled', () => {
    const event = createEvent();
    const signed = signEvent(event, {
      enabled: false,
      secret: 'secret',
      algorithm: 'sha256',
    });
    expect(signed).toBe(event);
  });

  it('returns input event when secret is missing', () => {
    const event = createEvent();
    const signed = signEvent(event, {
      enabled: true,
      secret: undefined,
      algorithm: 'sha256',
    });
    expect(signed).toBe(event);
  });

  it('adds signature when enabled with secret', () => {
    const event = createEvent();
    const signed = signEvent(event, {
      enabled: true,
      secret: 'secret',
      algorithm: 'sha256',
    });

    expect(signed).not.toBe(event);
    expect(signed.signature).toBeDefined();
    expect(signed.signature?.algorithm).toBe('sha256');
    expect(typeof signed.signature?.timestamp).toBe('number');
    expect(typeof signed.signature?.nonce).toBe('string');
    expect(typeof signed.signature?.value).toBe('string');
  });
});
