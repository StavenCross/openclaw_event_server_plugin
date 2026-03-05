/**
 * Unit tests for message hook conversions
 */

import {
  fromOpenClawMessageSent,
  fromOpenClawMessageReceived,
} from '../../src/hooks/message-hooks';

describe('fromOpenClawMessageSent', () => {
  it('should convert valid hook event to message.sent event', () => {
    const hookEvent = {
      sessionKey: 'session-123',
      context: {
        to: '+1234567890',
        content: 'Hello!',
        channelId: 'whatsapp',
      },
    };

    const event = fromOpenClawMessageSent(hookEvent);

    expect(event).not.toBeNull();
    expect(event?.type).toBe('message.sent');
    expect(event?.data.to).toBe('+1234567890');
    expect(event?.data.content).toBe('Hello!');
    expect(event?.data.channelId).toBe('whatsapp');
    expect(event?.sessionId).toBe('session-123');
  });

  it('should return null when to is missing', () => {
    const hookEvent = {
      context: {
        content: 'Hello!',
        channelId: 'whatsapp',
      },
    };

    const event = fromOpenClawMessageSent(hookEvent);
    expect(event).toBeNull();
  });

  it('should return null when content is missing', () => {
    const hookEvent = {
      context: {
        to: '+1234567890',
        channelId: 'whatsapp',
      },
    };

    const event = fromOpenClawMessageSent(hookEvent);
    expect(event).toBeNull();
  });

  it('should return null when channelId is missing', () => {
    const hookEvent = {
      context: {
        to: '+1234567890',
        content: 'Hello!',
      },
    };

    const event = fromOpenClawMessageSent(hookEvent);
    expect(event).toBeNull();
  });

  it('should return null when context is missing', () => {
    const hookEvent = {};

    const event = fromOpenClawMessageSent(hookEvent);
    expect(event).toBeNull();
  });

  it('should handle optional fields', () => {
    const hookEvent = {
      sessionKey: 'session-123',
      context: {
        to: '+1234567890',
        content: 'Hello!',
        channelId: 'whatsapp',
        accountId: 'account-1',
        conversationId: 'conv-123',
        messageId: 'msg-456',
        isGroup: true,
        groupId: 'group-789',
      },
    };

    const event = fromOpenClawMessageSent(hookEvent);

    expect(event?.data.accountId).toBe('account-1');
    expect(event?.data.conversationId).toBe('conv-123');
    expect(event?.data.messageId).toBe('msg-456');
    expect(event?.data.isGroup).toBe(true);
    expect(event?.data.groupId).toBe('group-789');
  });

  it('should handle non-string fields gracefully', () => {
    const hookEvent = {
      context: {
        to: 123 as any,
        content: 'Hello!',
        channelId: 'whatsapp',
      },
    };

    const event = fromOpenClawMessageSent(hookEvent);
    expect(event).toBeNull();
  });

  it('should handle null hook event', () => {
    const event = fromOpenClawMessageSent(null as any);
    expect(event).toBeNull();
  });
});

describe('fromOpenClawMessageReceived', () => {
  it('should convert valid hook event to message.received event', () => {
    const hookEvent = {
      sessionKey: 'session-123',
      context: {
        from: '+1234567890',
        content: 'Hi there!',
        channelId: 'telegram',
        timestamp: Date.now(),
      },
    };

    const event = fromOpenClawMessageReceived(hookEvent);

    expect(event).not.toBeNull();
    expect(event?.type).toBe('message.received');
    expect(event?.data.from).toBe('+1234567890');
    expect(event?.data.content).toBe('Hi there!');
    expect(event?.data.channelId).toBe('telegram');
  });

  it('should return null when from is missing', () => {
    const hookEvent = {
      context: {
        content: 'Hi there!',
        channelId: 'telegram',
      },
    };

    const event = fromOpenClawMessageReceived(hookEvent);
    expect(event).toBeNull();
  });

  it('should return null when content is missing', () => {
    const hookEvent = {
      context: {
        from: '+1234567890',
        channelId: 'telegram',
      },
    };

    const event = fromOpenClawMessageReceived(hookEvent);
    expect(event).toBeNull();
  });

  it('should return null when channelId is missing', () => {
    const hookEvent = {
      context: {
        from: '+1234567890',
        content: 'Hi there!',
      },
    };

    const event = fromOpenClawMessageReceived(hookEvent);
    expect(event).toBeNull();
  });

  it('should handle optional fields', () => {
    const hookEvent = {
      context: {
        from: '+1234567890',
        content: 'Hi there!',
        channelId: 'telegram',
        accountId: 'account-1',
        conversationId: 'conv-123',
        messageId: 'msg-789',
      },
    };

    const event = fromOpenClawMessageReceived(hookEvent);

    expect(event?.data.accountId).toBe('account-1');
    expect(event?.data.conversationId).toBe('conv-123');
    expect(event?.data.messageId).toBe('msg-789');
  });

  it('should handle non-string fields gracefully', () => {
    const hookEvent = {
      context: {
        from: 123 as any,
        content: 'Hi there!',
        channelId: 'telegram',
      },
    };

    const event = fromOpenClawMessageReceived(hookEvent);
    expect(event).toBeNull();
  });

  it('should handle non-string from gracefully', () => {
    const hookEvent = {
      context: {
        from: 123 as any,
        content: 'Hi there!',
        channelId: 'telegram',
      },
    };

    const event = fromOpenClawMessageReceived(hookEvent);
    expect(event).toBeNull();
  });

  it('should handle null hook event', () => {
    const event = fromOpenClawMessageReceived(null as any);
    expect(event).toBeNull();
  });
});
