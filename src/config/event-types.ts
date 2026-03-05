import { EventType } from '../events/types';

export const VALID_EVENT_TYPES: ReadonlyArray<EventType> = [
  'message.received',
  'message.transcribed',
  'message.preprocessed',
  'message.sent',
  'message.edited',
  'message.deleted',
  'tool.called',
  'tool.guard.matched',
  'tool.guard.allowed',
  'tool.guard.blocked',
  'tool.completed',
  'tool.error',
  'tool.result_persist',
  'command.new',
  'command.reset',
  'command.stop',
  'session.start',
  'session.end',
  'subagent.spawning',
  'subagent.spawned',
  'subagent.ended',
  'subagent.idle',
  'agent.bootstrap',
  'agent.error',
  'agent.session_start',
  'agent.session_end',
  'agent.sub_agent_spawn',
  'agent.status',
  'agent.activity',
  'gateway.startup',
  'gateway.start',
  'gateway.stop',
  // Legacy compatibility aliases
  'session.spawned',
  'session.completed',
  'session.error',
];

const VALID_EVENT_TYPE_SET: ReadonlySet<EventType> = new Set(VALID_EVENT_TYPES);

export function isEventType(value: string): value is EventType {
  return VALID_EVENT_TYPE_SET.has(value as EventType);
}

export function parseEventTypes(raw: string): EventType[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(isEventType);
}
