/**
 * Message event hooks implementation.
 */

import { MessageEvent } from '../events/types';
import { createCanonicalEvent } from './event-factory';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

type ParsedHook = {
  sessionKey?: string;
  sessionId?: string;
  context: Record<string, unknown>;
};

function parseHook(hookEvent: unknown): ParsedHook | null {
  if (!isRecord(hookEvent)) {
    return null;
  }

  const context = isRecord(hookEvent.context) ? hookEvent.context : {};
  return {
    sessionKey: readString(hookEvent.sessionKey),
    sessionId: readString(hookEvent.sessionId) ?? readString(hookEvent.sessionKey),
    context,
  };
}

function buildMessageData(context: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const allowedKeys = [
    'from',
    'to',
    'content',
    'channelId',
    'accountId',
    'conversationId',
    'messageId',
    'isGroup',
    'groupId',
    'newContent',
    'originalContent',
    'success',
    'error',
    'transcript',
    'normalizedText',
    'metadata',
  ];

  for (const key of allowedKeys) {
    if (key in context) {
      data[key] = context[key];
    }
  }

  if (!('channelId' in data)) {
    data.channelId = 'unknown';
  }

  return data;
}

export function fromOpenClawMessageSent(hookEvent: unknown): MessageEvent | null {
  const parsed = parseHook(hookEvent);
  if (!parsed) {
    return null;
  }

  const to = readString(parsed.context.to);
  const content = readString(parsed.context.content);
  const channelId = readString(parsed.context.channelId);
  if (!to || !content || !channelId) {
    return null;
  }

  return createMessageSentEvent({
    sessionId: parsed.sessionId,
    sessionKey: parsed.sessionKey,
    ...buildMessageData(parsed.context),
  });
}

export function fromOpenClawMessageReceived(hookEvent: unknown): MessageEvent | null {
  const parsed = parseHook(hookEvent);
  if (!parsed) {
    return null;
  }

  const from = readString(parsed.context.from);
  const content = readString(parsed.context.content);
  const channelId = readString(parsed.context.channelId);
  if (!from || !content || !channelId) {
    return null;
  }

  return createMessageReceivedEvent({
    sessionId: parsed.sessionId,
    sessionKey: parsed.sessionKey,
    ...buildMessageData(parsed.context),
  });
}

export function fromOpenClawMessageTranscribed(hookEvent: unknown): MessageEvent | null {
  const parsed = parseHook(hookEvent);
  if (!parsed) {
    return null;
  }

  return createMessageTranscribedEvent({
    sessionId: parsed.sessionId,
    sessionKey: parsed.sessionKey,
    ...buildMessageData(parsed.context),
  });
}

export function fromOpenClawMessagePreprocessed(hookEvent: unknown): MessageEvent | null {
  const parsed = parseHook(hookEvent);
  if (!parsed) {
    return null;
  }

  return createMessagePreprocessedEvent({
    sessionId: parsed.sessionId,
    sessionKey: parsed.sessionKey,
    ...buildMessageData(parsed.context),
  });
}

export function createMessageSentEvent(
  context: Record<string, unknown> & { sessionId?: string; sessionKey?: string },
): MessageEvent {
  return createCanonicalEvent({
    type: 'message.sent',
    eventCategory: 'message',
    eventName: 'message:sent',
    source: 'internal-hook',
    sessionId: readString(context.sessionId),
    sessionKey: readString(context.sessionKey),
    data: buildMessageData(context),
    result: context.success,
    error: readString(context.error)
      ? {
          message: readString(context.error) ?? 'message send failed',
          kind: 'unknown',
        }
      : undefined,
    metadata: {
      hookTimestamp: readNumber(context.timestamp),
    },
  });
}

export function createMessageReceivedEvent(
  context: Record<string, unknown> & { sessionId?: string; sessionKey?: string },
): MessageEvent {
  return createCanonicalEvent({
    type: 'message.received',
    eventCategory: 'message',
    eventName: 'message:received',
    source: 'internal-hook',
    sessionId: readString(context.sessionId),
    sessionKey: readString(context.sessionKey),
    data: buildMessageData(context),
    metadata: {
      hookTimestamp: readNumber(context.timestamp),
    },
  });
}

export function createMessageTranscribedEvent(
  context: Record<string, unknown> & { sessionId?: string; sessionKey?: string },
): MessageEvent {
  return createCanonicalEvent({
    type: 'message.transcribed',
    eventCategory: 'message',
    eventName: 'message:transcribed',
    source: 'internal-hook',
    sessionId: readString(context.sessionId),
    sessionKey: readString(context.sessionKey),
    data: buildMessageData(context),
    metadata: {
      hookTimestamp: readNumber(context.timestamp),
    },
  });
}

export function createMessagePreprocessedEvent(
  context: Record<string, unknown> & { sessionId?: string; sessionKey?: string },
): MessageEvent {
  return createCanonicalEvent({
    type: 'message.preprocessed',
    eventCategory: 'message',
    eventName: 'message:preprocessed',
    source: 'internal-hook',
    sessionId: readString(context.sessionId),
    sessionKey: readString(context.sessionKey),
    data: buildMessageData(context),
    metadata: {
      hookTimestamp: readNumber(context.timestamp),
    },
  });
}

export function createMessageEditedEvent(
  context: Record<string, unknown> & { sessionId?: string; sessionKey?: string },
): MessageEvent {
  return createCanonicalEvent({
    type: 'message.edited',
    eventCategory: 'message',
    eventName: 'message:edited',
    source: 'internal-hook',
    sessionId: readString(context.sessionId),
    sessionKey: readString(context.sessionKey),
    data: buildMessageData(context),
  });
}

export function createMessageDeletedEvent(
  context: Record<string, unknown> & { sessionId?: string; sessionKey?: string },
): MessageEvent {
  return createCanonicalEvent({
    type: 'message.deleted',
    eventCategory: 'message',
    eventName: 'message:deleted',
    source: 'internal-hook',
    sessionId: readString(context.sessionId),
    sessionKey: readString(context.sessionKey),
    data: buildMessageData(context),
  });
}
