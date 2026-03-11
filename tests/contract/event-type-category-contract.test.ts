import { CONFIG_SCHEMA } from '../../src/config';
import { VALID_EVENT_TYPES } from '../../src/config/event-types';
import type { EventCategory, EventType } from '../../src/events/types';

const EXPECTED_EVENT_CATEGORY_BY_TYPE: Record<EventType, EventCategory> = {
  'message.received': 'message',
  'message.transcribed': 'message',
  'message.preprocessed': 'message',
  'message.sent': 'message',
  'message.edited': 'message',
  'message.deleted': 'message',
  'tool.called': 'tool',
  'tool.guard.matched': 'tool',
  'tool.guard.allowed': 'tool',
  'tool.guard.blocked': 'tool',
  'tool.completed': 'tool',
  'tool.error': 'tool',
  'tool.result_persist': 'tool',
  'command.new': 'command',
  'command.reset': 'command',
  'command.stop': 'command',
  'session.start': 'session',
  'session.end': 'session',
  'session.before_compaction': 'session',
  'session.after_compaction': 'session',
  'subagent.spawning': 'subagent',
  'subagent.spawned': 'subagent',
  'subagent.ended': 'subagent',
  'subagent.idle': 'subagent',
  'agent.bootstrap': 'agent',
  'agent.error': 'agent',
  'agent.before_model_resolve': 'agent',
  'agent.before_prompt_build': 'agent',
  'agent.llm_input': 'agent',
  'agent.llm_output': 'agent',
  'agent.end': 'agent',
  'agent.session_start': 'agent',
  'agent.session_end': 'agent',
  'agent.sub_agent_spawn': 'synthetic',
  'agent.status': 'synthetic',
  'agent.activity': 'synthetic',
  'gateway.startup': 'gateway',
  'gateway.start': 'gateway',
  'gateway.stop': 'gateway',
  'session.spawned': 'session',
  'session.completed': 'session',
  'session.error': 'session',
};

describe('Event type/category contract', () => {
  it('maps every valid event type to an expected category', () => {
    const mappedTypes = new Set(Object.keys(EXPECTED_EVENT_CATEGORY_BY_TYPE));
    const validTypes = new Set(VALID_EVENT_TYPES);

    expect(mappedTypes).toEqual(validTypes);
  });

  it('keeps filter schema enums in sync with the valid event type registry', () => {
    const schema = CONFIG_SCHEMA as unknown as {
      properties: {
        filters: {
          properties: {
            includeTypes: { items: { enum: readonly string[] } };
            excludeTypes: { items: { enum: readonly string[] } };
          };
        };
      };
    };

    const includeEnum = new Set(schema.properties.filters.properties.includeTypes.items.enum);
    const excludeEnum = new Set(schema.properties.filters.properties.excludeTypes.items.enum);
    const validTypes = new Set(VALID_EVENT_TYPES);

    expect(includeEnum).toEqual(validTypes);
    expect(excludeEnum).toEqual(validTypes);
  });
});
