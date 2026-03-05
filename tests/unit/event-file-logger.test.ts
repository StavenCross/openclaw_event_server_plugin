import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventFileLogger } from '../../src/logging/event-file-logger';
import { OpenClawEvent } from '../../src/events/types';

function createEvent(): OpenClawEvent {
  return {
    eventId: 'event-log-1',
    schemaVersion: '1.1.0',
    type: 'message.received',
    timestamp: new Date().toISOString(),
    pluginVersion: '1.0.0',
    data: {
      content: 'hello',
    },
  };
}

describe('EventFileLogger', () => {
  it('writes full-json event entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'event-file-logger-'));
    const path = join(dir, 'events.ndjson');
    const logger = new EventFileLogger({
      enabled: true,
      path,
      maxFileSizeMb: 30,
      format: 'full-json',
      minLevel: 'debug',
      includeRuntimeLogs: true,
    });

    await logger.start();
    logger.logEvent(createEvent());
    await logger.stop();

    const data = await readFile(path, 'utf8');
    expect(data).toContain('"kind":"event"');
    expect(data).toContain('"event-log-1"');

    await rm(dir, { recursive: true, force: true });
  });

  it('filters runtime records by minLevel and supports summary format', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'event-file-logger-summary-'));
    const path = join(dir, 'events.ndjson');
    const logger = new EventFileLogger({
      enabled: true,
      path,
      maxFileSizeMb: 30,
      format: 'summary',
      minLevel: 'warn',
      includeRuntimeLogs: true,
    });

    await logger.start();
    logger.logEvent(createEvent());
    logger.logRuntime('debug', 'debug-message', ['a']);
    logger.logRuntime('warn', 'warn-message', [new Error('boom')]);
    await logger.stop();

    const data = await readFile(path, 'utf8');
    expect(data).toContain('"kind":"event"');
    expect(data).toContain('"warn-message"');
    expect(data).not.toContain('"debug-message"');

    await rm(dir, { recursive: true, force: true });
  });

  it('is a no-op when disabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'event-file-logger-disabled-'));
    const path = join(dir, 'events.ndjson');
    const logger = new EventFileLogger({
      enabled: false,
      path,
      maxFileSizeMb: 30,
      format: 'full-json',
      minLevel: 'debug',
      includeRuntimeLogs: true,
    });

    await logger.start();
    logger.logEvent(createEvent());
    logger.logRuntime('error', 'error-message', []);
    await logger.stop();

    await expect(readFile(path, 'utf8')).rejects.toBeDefined();
    await rm(dir, { recursive: true, force: true });
  });

  it('truncates log file when configured max size is reached', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'event-file-logger-cap-'));
    const path = join(dir, 'events.ndjson');
    const logger = new EventFileLogger({
      enabled: true,
      path,
      maxFileSizeMb: 1,
      format: 'full-json',
      minLevel: 'debug',
      includeRuntimeLogs: false,
    });

    await logger.start();

    const largePayload = 'x'.repeat(250_000);
    for (let i = 0; i < 10; i += 1) {
      logger.logEvent({
        ...createEvent(),
        eventId: `event-log-${i}`,
        data: {
          content: largePayload,
        },
      });
    }
    await logger.stop();

    const data = await readFile(path, 'utf8');
    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(1024 * 1024);
    expect(data).toContain('"kind":"event"');

    await rm(dir, { recursive: true, force: true });
  });
});
