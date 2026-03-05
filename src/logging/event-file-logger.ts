import { createWriteStream, WriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EventLogConfig, LogLevel } from '../config/types';
import { OpenClawEvent } from '../events/types';

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function shouldWrite(level: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[minLevel];
}

function toSerializable(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  return value;
}

function stringifyLine(payload: Record<string, unknown>): string {
  return `${JSON.stringify(payload)}\n`;
}

const BYTES_PER_MB = 1024 * 1024;

export class EventFileLogger {
  private readonly config: EventLogConfig;
  private stream?: WriteStream;
  private isReady = false;
  private readonly maxFileSizeBytes: number;
  private currentFileSizeBytes = 0;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(config: EventLogConfig) {
    this.config = config;
    this.maxFileSizeBytes = Math.max(1, config.maxFileSizeMb) * BYTES_PER_MB;
  }

  async start(): Promise<void> {
    if (!this.config.enabled || this.isReady) {
      return;
    }

    await mkdir(dirname(this.config.path), { recursive: true });

    const existingSize = await this.getExistingFileSize();
    if (existingSize >= this.maxFileSizeBytes) {
      this.stream = createWriteStream(this.config.path, { flags: 'w', encoding: 'utf8' });
      this.currentFileSizeBytes = 0;
    } else {
      this.stream = createWriteStream(this.config.path, { flags: 'a', encoding: 'utf8' });
      this.currentFileSizeBytes = existingSize;
    }

    this.isReady = true;
  }

  logEvent(event: OpenClawEvent): void {
    if (!this.config.enabled || !this.stream || !this.isReady) {
      return;
    }
    const payload =
      this.config.format === 'summary'
        ? {
            timestamp: event.timestamp,
            kind: 'event',
            type: event.type,
            eventCategory: event.eventCategory,
            eventName: event.eventName,
            source: event.source,
            agentId: event.agentId,
            sessionId: event.sessionId,
            sessionKey: event.sessionKey,
            runId: event.runId,
            toolCallId: event.toolCallId,
            correlationId: event.correlationId,
          }
        : {
            timestamp: new Date().toISOString(),
            kind: 'event',
            event,
          };
    this.enqueueWrite(stringifyLine(payload));
  }

  logRuntime(level: LogLevel, message: string, args: unknown[]): void {
    if (
      !this.config.enabled ||
      !this.config.includeRuntimeLogs ||
      !this.stream ||
      !this.isReady ||
      !shouldWrite(level, this.config.minLevel)
    ) {
      return;
    }

    this.enqueueWrite(
      stringifyLine({
        timestamp: new Date().toISOString(),
        kind: 'runtime',
        level,
        message,
        args: args.map((arg) => toSerializable(arg)),
      }),
    );
  }

  async stop(): Promise<void> {
    await this.writeChain.catch(() => undefined);

    if (!this.stream) {
      return;
    }

    const stream = this.stream;
    this.stream = undefined;
    this.isReady = false;

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });
  }

  private async getExistingFileSize(): Promise<number> {
    try {
      const file = await stat(this.config.path);
      return file.size;
    } catch {
      return 0;
    }
  }

  private enqueueWrite(line: string): void {
    this.writeChain = this.writeChain
      .then(() => this.writeLine(line))
      .catch(() => undefined);
  }

  private async writeLine(line: string): Promise<void> {
    if (!this.stream || !this.isReady) {
      return;
    }

    const lineSize = Buffer.byteLength(line, 'utf8');
    if (this.currentFileSizeBytes + lineSize > this.maxFileSizeBytes) {
      await this.truncateLogFile();
    }

    await this.writeToStream(line);
    this.currentFileSizeBytes += lineSize;
  }

  private async truncateLogFile(): Promise<void> {
    if (!this.stream) {
      return;
    }

    const currentStream = this.stream;
    this.stream = undefined;

    await new Promise<void>((resolve) => {
      currentStream.end(() => resolve());
    });

    this.stream = createWriteStream(this.config.path, { flags: 'w', encoding: 'utf8' });
    this.currentFileSizeBytes = 0;
  }

  private async writeToStream(line: string): Promise<void> {
    if (!this.stream) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.stream?.write(line, 'utf8', (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}
