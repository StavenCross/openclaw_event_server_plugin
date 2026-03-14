/**
 * Unit tests for event type creation
 */

import {
  createAgentEndEvent,
  createBeforeCompactionEvent,
  createBeforeModelResolveEvent,
  createBeforePromptBuildEvent,
  createLlmInputEvent,
  createLlmOutputEvent,
  createAfterCompactionEvent,
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
import { PLUGIN_VERSION } from '../../src/version';

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
      expect(event.pluginVersion).toBe(PLUGIN_VERSION);
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
        provenance: {
          resolvedSessionKey: 'agent:jacob:main',
          routeResolution: 'resolved',
          threadId: '1773251460.006889',
        },
        agentId: 'agent-main',
      });

      expect(event.type).toBe('tool.called');
      expect(event.agentId).toBe('agent-main');
      expect(event.data.toolName).toBe('web_search');
      expect(event.data.params).toEqual({ query: 'test query', count: 5 });
      expect(event.data.provenance).toMatchObject({
        resolvedSessionKey: 'agent:jacob:main',
        routeResolution: 'resolved',
        threadId: '1773251460.006889',
      });
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

  describe('createBeforeCompactionEvent', () => {
    it('should create a valid session.before_compaction event', () => {
      const event = createBeforeCompactionEvent({
        messageCount: 20,
        compactingCount: 10,
        tokenCount: 2000,
        sessionId: 'session-compact-1',
        privacy: { payloadMode: 'metadata' },
      });

      expect(event.type).toBe('session.before_compaction');
      expect(event.data.messageCount).toBe(20);
      expect(event.data.compactingCount).toBe(10);
      expect(event.data.tokenCount).toBe(2000);
      expect(event.data.messages).toBeUndefined();
      expect(event.sessionId).toBe('session-compact-1');
    });
  });

  describe('createAfterCompactionEvent', () => {
    it('should create a valid session.after_compaction event', () => {
      const event = createAfterCompactionEvent({
        messageCount: 8,
        compactedCount: 12,
        tokenCount: 900,
        sessionId: 'session-compact-1',
        privacy: { payloadMode: 'metadata' },
      });

      expect(event.type).toBe('session.after_compaction');
      expect(event.data.messageCount).toBe(8);
      expect(event.data.compactedCount).toBe(12);
      expect(event.data.tokenCount).toBe(900);
    });
  });
});

describe('Agent Events', () => {
  describe('createBeforeModelResolveEvent', () => {
    it('should create a valid agent.before_model_resolve event', () => {
      const event = createBeforeModelResolveEvent({
        prompt: 'Pick a model',
        privacy: { payloadMode: 'metadata' },
        agentId: 'quinn',
      });

      expect(event.type).toBe('agent.before_model_resolve');
      expect(event.data.promptLength).toBe('Pick a model'.length);
      expect(event.data.prompt).toBeUndefined();
      expect(event.agentId).toBe('quinn');
    });
  });

  describe('createBeforePromptBuildEvent', () => {
    it('should create a valid agent.before_prompt_build event', () => {
      const event = createBeforePromptBuildEvent({
        prompt: 'Build prompt',
        messages: [{ role: 'user', content: 'Hello' }],
        privacy: { payloadMode: 'metadata' },
        agentId: 'quinn',
      });

      expect(event.type).toBe('agent.before_prompt_build');
      expect(event.data.promptLength).toBe('Build prompt'.length);
      expect(event.data.messageCount).toBe(1);
      expect(event.data.messages).toBeUndefined();
    });
  });

  describe('createLlmInputEvent', () => {
    it('should create a valid agent.llm_input event', () => {
      const event = createLlmInputEvent({
        runId: 'run-1',
        sessionId: 'session-123',
        provider: 'openai',
        model: 'gpt-5',
        prompt: 'Answer the user',
        historyMessages: [{ role: 'user', content: 'Hello' }],
        imagesCount: 1,
        privacy: { payloadMode: 'metadata' },
      });

      expect(event.type).toBe('agent.llm_input');
      expect(event.runId).toBe('run-1');
      expect(event.data.provider).toBe('openai');
      expect(event.data.model).toBe('gpt-5');
      expect(event.data.historyMessageCount).toBe(1);
      expect(event.data.imagesCount).toBe(1);
      expect(event.data.prompt).toBeUndefined();
    });
  });

  describe('createLlmOutputEvent', () => {
    it('should create a valid agent.llm_output event', () => {
      const event = createLlmOutputEvent({
        runId: 'run-1',
        sessionId: 'session-123',
        provider: 'openai',
        model: 'gpt-5',
        assistantTexts: ['Done'],
        usage: { input: 10, output: 5, total: 15 },
        privacy: { payloadMode: 'metadata' },
      });

      expect(event.type).toBe('agent.llm_output');
      expect(event.data.assistantTextCount).toBe(1);
      expect(event.data.usage).toEqual({ input: 10, output: 5, total: 15 });
      expect(event.data.assistantTexts).toBeUndefined();
    });
  });

  describe('createAgentEndEvent', () => {
    it('should create a valid agent.end event', () => {
      const event = createAgentEndEvent({
        messages: [{ role: 'assistant', content: 'All done' }],
        success: true,
        durationMs: 500,
        sessionId: 'session-123',
        privacy: { payloadMode: 'metadata' },
      });

      expect(event.type).toBe('agent.end');
      expect(event.data.messageCount).toBe(1);
      expect(event.data.success).toBe(true);
      expect(event.data.durationMs).toBe(500);
      expect(event.data.messages).toBeUndefined();
      expect(event.sessionId).toBe('session-123');
    });
  });

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
