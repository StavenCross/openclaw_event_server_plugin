/**
 * Unit tests for event type creation
 */

import {
  createMessageSentEvent,
  createMessageReceivedEvent,
  createMessagePreprocessedEvent,
  createMessageEditedEvent,
  createMessageDeletedEvent,
  createToolCalledEvent,
  createToolCompletedEvent,
  createToolErrorEvent,
  createSessionSpawnedEvent,
  createSessionCompletedEvent,
  createSessionErrorEvent,
  createAgentStatusEvent,
} from '../../src/hooks';

describe('Message Events', () => {
  describe('createMessageSentEvent', () => {
    it('should create a valid message.sent event', () => {
      const event = createMessageSentEvent({
        to: '+1234567890',
        content: 'Hello!',
        channelId: 'whatsapp',
      });

      expect(event.type).toBe('message.sent');
      expect(event.eventId).toBeDefined();
      expect(event.schemaVersion).toBe('1.1.0');
      expect(event.timestamp).toBeDefined();
      expect(event.pluginVersion).toBe('1.0.0');
      expect(event.data.to).toBe('+1234567890');
      expect(event.data.content).toBe('Hello!');
      expect(event.data.channelId).toBe('whatsapp');
    });

    it('should include optional fields', () => {
      const event = createMessageSentEvent({
        to: '+1234567890',
        content: 'Hello!',
        channelId: 'whatsapp',
        accountId: 'account-1',
        conversationId: 'conv-123',
        messageId: 'msg-456',
        isGroup: true,
        groupId: 'group-789',
      });

      expect(event.data.accountId).toBe('account-1');
      expect(event.data.conversationId).toBe('conv-123');
      expect(event.data.messageId).toBe('msg-456');
      expect(event.data.isGroup).toBe(true);
      expect(event.data.groupId).toBe('group-789');
    });

    it('should generate unique event IDs', () => {
      const event1 = createMessageSentEvent({
        to: '+1234567890',
        content: 'Hello!',
        channelId: 'whatsapp',
      });
      const event2 = createMessageSentEvent({
        to: '+1234567890',
        content: 'Hello!',
        channelId: 'whatsapp',
      });

      expect(event1.eventId).not.toBe(event2.eventId);
    });
  });

  describe('createMessageReceivedEvent', () => {
    it('should create a valid message.received event', () => {
      const event = createMessageReceivedEvent({
        from: '+1234567890',
        content: 'Hi there!',
        channelId: 'telegram',
      });

      expect(event.type).toBe('message.received');
      expect(event.data.from).toBe('+1234567890');
      expect(event.data.content).toBe('Hi there!');
      expect(event.data.channelId).toBe('telegram');
    });
  });

  describe('createMessageEditedEvent', () => {
    it('should create a valid message.edited event', () => {
      const event = createMessageEditedEvent({
        messageId: 'msg-123',
        channelId: 'slack',
        newContent: 'Updated message',
        originalContent: 'Original message',
      });

      expect(event.type).toBe('message.edited');
      expect(event.data.messageId).toBe('msg-123');
      expect(event.data.newContent).toBe('Updated message');
      expect(event.data.originalContent).toBe('Original message');
    });
  });

  describe('createMessagePreprocessedEvent', () => {
    it('should create a valid message.preprocessed event', () => {
      const event = createMessagePreprocessedEvent({
        channelId: 'openclaw',
        content: 'Draft response',
        sessionId: 'session-123',
      });

      expect(event.type).toBe('message.preprocessed');
      expect(event.data.channelId).toBe('openclaw');
      expect(event.data.content).toBe('Draft response');
      expect(event.sessionId).toBe('session-123');
    });
  });

  describe('createMessageDeletedEvent', () => {
    it('should create a valid message.deleted event', () => {
      const event = createMessageDeletedEvent({
        messageId: 'msg-123',
        channelId: 'discord',
        originalContent: 'Deleted message',
      });

      expect(event.type).toBe('message.deleted');
      expect(event.data.messageId).toBe('msg-123');
      expect(event.data.originalContent).toBe('Deleted message');
    });
  });
});

describe('Tool Events', () => {
  describe('createToolCalledEvent', () => {
    it('should create a valid tool.called event', () => {
      const event = createToolCalledEvent({
        toolName: 'web_search',
        params: { query: 'test query', count: 5 },
        agentId: 'agent-main',
      });

      expect(event.type).toBe('tool.called');
      expect(event.agentId).toBe('agent-main');
      expect(event.data.toolName).toBe('web_search');
      expect(event.data.params).toEqual({ query: 'test query', count: 5 });
      expect(event.data.agentId).toBe('agent-main');
    });
  });

  describe('createToolCompletedEvent', () => {
    it('should create a valid tool.completed event', () => {
      const event = createToolCompletedEvent({
        toolName: 'web_search',
        result: { results: [{ title: 'Test' }] },
        durationMs: 1500,
        agentId: 'agent-main',
      });

      expect(event.type).toBe('tool.completed');
      expect(event.agentId).toBe('agent-main');
      expect(event.data.toolName).toBe('web_search');
      expect(event.data.result).toEqual({ results: [{ title: 'Test' }] });
      expect(event.data.durationMs).toBe(1500);
      expect(event.data.agentId).toBe('agent-main');
    });
  });

  describe('createToolErrorEvent', () => {
    it('should create a valid tool.error event', () => {
      const event = createToolErrorEvent({
        toolName: 'web_search',
        error: 'Network timeout',
        stackTrace: 'Error: Network timeout\n    at test.js:10:5',
        agentId: 'agent-main',
      });

      expect(event.type).toBe('tool.error');
      expect(event.agentId).toBe('agent-main');
      expect(event.data.toolName).toBe('web_search');
      expect(event.data.error).toBe('Network timeout');
      expect(event.data.stackTrace).toBe('Error: Network timeout\n    at test.js:10:5');
      expect(event.data.agentId).toBe('agent-main');
    });
  });
});

describe('Session Events', () => {
  describe('createSessionSpawnedEvent', () => {
    it('should create a valid session.spawned event', () => {
      const event = createSessionSpawnedEvent({
        sessionKey: 'session-123',
        agentId: 'main',
        workspaceDir: '/tmp/workspace',
        channel: 'whatsapp',
      });

      expect(event.type).toBe('session.spawned');
      expect(event.data.sessionKey).toBe('session-123');
      expect(event.data.agentId).toBe('main');
      const metadata = event.data.metadata as Record<string, unknown> | undefined;
      expect(metadata?.workspaceDir).toBe('/tmp/workspace');
      expect(metadata?.channel).toBe('whatsapp');
    });
  });

  describe('createSessionCompletedEvent', () => {
    it('should create a valid session.completed event', () => {
      const event = createSessionCompletedEvent({
        sessionKey: 'session-123',
        agentId: 'main',
      });

      expect(event.type).toBe('session.completed');
      expect(event.data.sessionKey).toBe('session-123');
    });
  });

  describe('createSessionErrorEvent', () => {
    it('should create a valid session.error event', () => {
      const event = createSessionErrorEvent({
        sessionKey: 'session-123',
        error: 'Out of memory',
        stackTrace: 'Error: OOM\n    at session.js:50:10',
      });

      expect(event.type).toBe('session.error');
      expect(event.data.sessionKey).toBe('session-123');
      expect(event.data.error).toBe('Out of memory');
      expect(event.data.stackTrace).toBe('Error: OOM\n    at session.js:50:10');
    });
  });
});

describe('Agent Events', () => {
  describe('createAgentStatusEvent', () => {
    it('should create a valid agent.status event', () => {
      const event = createAgentStatusEvent({
        agentId: 'quinn',
        sessionId: 'session-123',
        status: 'working',
        activity: 'Working',
        activityDetail: 'Processing message',
        sourceEventType: 'message.preprocessed',
      });

      expect(event.type).toBe('agent.status');
      expect(event.agentId).toBe('quinn');
      expect(event.sessionId).toBe('session-123');
      expect(event.data.agentId).toBe('quinn');
      expect(event.data.status).toBe('working');
      expect(event.data.activity).toBe('Working');
      expect(event.data.sourceEventType).toBe('message.preprocessed');
    });
  });
});
