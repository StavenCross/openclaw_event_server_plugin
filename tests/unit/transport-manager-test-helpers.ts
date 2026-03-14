import { type OpenClawEvent } from '../../src/events/types';

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls until an async transport condition becomes true. The transport manager
 * coordinates timers, sockets, and lock files, so a bounded wait helper keeps
 * the tests deterministic without hard-coding large sleeps everywhere.
 */
export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await wait(25);
  }

  throw new Error('timed out waiting for condition');
}

/**
 * The runtime logger is an injected collaborator, so unit tests use spies for
 * every log level and assert on the structured metadata rather than console IO.
 */
export function createLogger() {
  return {
    debug: jest.fn<void, unknown[]>(),
    info: jest.fn<void, unknown[]>(),
    warn: jest.fn<void, unknown[]>(),
    error: jest.fn<void, unknown[]>(),
    queue: jest.fn<void, unknown[]>(),
  };
}

/**
 * Builds a canonical event fixture so each transport test focuses on routing
 * behavior instead of repeating envelope boilerplate inline.
 */
export function createEvent(eventId: string): OpenClawEvent {
  return {
    eventId,
    schemaVersion: '1.0.0',
    type: 'message.sent',
    timestamp: new Date().toISOString(),
    pluginVersion: '1.0.0',
    data: {
      content: 'transport test',
    },
  };
}
