import { CommandEvent } from '../events/types';
import { createCanonicalEvent } from './event-factory';

type CommandType = 'command.new' | 'command.reset' | 'command.stop';

export function createCommandEvent(context: {
  type: CommandType;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  commandSource?: string;
  senderId?: string;
  data?: Record<string, unknown>;
}): CommandEvent {
  const eventNameMap: Record<CommandType, string> = {
    'command.new': 'command:new',
    'command.reset': 'command:reset',
    'command.stop': 'command:stop',
  };

  return createCanonicalEvent({
    type: context.type,
    eventCategory: 'command',
    eventName: eventNameMap[context.type],
    source: 'internal-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    data: {
      commandSource: context.commandSource,
      senderId: context.senderId,
      ...(context.data ?? {}),
    },
  });
}

