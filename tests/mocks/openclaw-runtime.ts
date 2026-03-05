/**
 * Mock OpenClaw runtime for testing
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { OpenClawEvent } from '../../src/events/types';

/**
 * Mock hook event structure
 */
export interface MockHookEvent {
  type: string;
  action: string;
  sessionKey?: string;
  sessionId?: string;
  timestamp: Date;
  messages: string[];
  context: Record<string, unknown>;
}

interface HookRegistration {
  event: string;
  handler: (event: unknown) => Promise<void>;
  options: { name: string; description: string };
}

interface TypedHookRegistration {
  event: string;
  handler: (event: unknown, ctx: unknown) => unknown;
  options: { name: string; description: string };
}

/**
 * Mock API for plugin testing
 */
export class MockOpenClawApi {
  public registeredHooks: HookRegistration[] = [];
  public registeredTypedHooks: TypedHookRegistration[] = [];
  public config: Record<string, unknown> = {};

  /**
   * Register a hook handler
   */
  registerHook(
    event: string,
    handler: (event: unknown) => Promise<void>,
    options: { name: string; description: string },
  ): void {
    this.registeredHooks.push({ event, handler, options });
  }

  /**
   * Register a typed hook handler (OpenClaw plugin `on` API)
   */
  on(
    event: string,
    handler: (event: unknown, ctx: unknown) => unknown,
    options: { name: string; description: string },
  ): void {
    this.registeredTypedHooks.push({ event, handler, options });
  }

  /**
   * Trigger a hook event
   */
  async triggerHook(event: string, hookEvent: unknown): Promise<void> {
    const handlers = this.registeredHooks.filter((hook) => hook.event === event);
    for (const handler of handlers) {
      await handler.handler(hookEvent);
    }
  }

  /**
   * Trigger a typed hook event
   */
  async triggerTypedHook(event: string, hookEvent: unknown, ctx: unknown): Promise<unknown> {
    const handlers = this.registeredTypedHooks.filter((hook) => hook.event === event);
    let lastResult: unknown = undefined;
    for (const handler of handlers) {
      // Hooks are ordered by registration order in tests.
      lastResult = await handler.handler(hookEvent, ctx);
    }
    return lastResult;
  }

  /**
   * Get all registered hooks
   */
  getHooks(): Array<{ event: string; name: string; description: string; kind: 'internal' | 'typed' }> {
    return [
      ...this.registeredHooks.map((hook) => ({
        event: hook.event,
        name: hook.options.name,
        description: hook.options.description,
        kind: 'internal' as const,
      })),
      ...this.registeredTypedHooks.map((hook) => ({
        event: hook.event,
        name: hook.options.name,
        description: hook.options.description,
        kind: 'typed' as const,
      })),
    ];
  }
}

/**
 * Create a mock message:received event
 */
export function createMockMessageReceived(overrides?: Partial<MockHookEvent['context']>): MockHookEvent {
  return {
    type: 'message',
    action: 'received',
    sessionKey: 'test-session-123',
    timestamp: new Date(),
    messages: [],
    context: {
      from: '+1234567890',
      content: 'Hello, world!',
      channelId: 'whatsapp',
      accountId: 'account-1',
      conversationId: 'conv-123',
      messageId: 'msg-456',
      timestamp: Date.now(),
      ...overrides,
    },
  };
}

/**
 * Create a mock message:sent event
 */
export function createMockMessageSent(overrides?: Partial<MockHookEvent['context']>): MockHookEvent {
  return {
    type: 'message',
    action: 'sent',
    sessionKey: 'test-session-123',
    timestamp: new Date(),
    messages: [],
    context: {
      to: '+1234567890',
      content: 'Response message',
      channelId: 'whatsapp',
      accountId: 'account-1',
      conversationId: 'conv-123',
      messageId: 'msg-789',
      success: true,
      isGroup: false,
      ...overrides,
    },
  };
}

/**
 * Create a mock command event
 */
export function createMockCommand(action: string, overrides?: Partial<MockHookEvent>): MockHookEvent {
  const overrideContext = overrides?.context ?? {};
  return {
    type: 'command',
    action,
    sessionKey: overrides?.sessionKey ?? 'test-session-123',
    sessionId: overrides?.sessionId,
    timestamp: overrides?.timestamp ?? new Date(),
    messages: overrides?.messages ?? [],
    context: {
      workspaceDir: '/tmp/workspace',
      commandSource: 'whatsapp',
      senderId: 'user-123',
      ...overrideContext,
    },
  };
}

/**
 * Create a mock gateway:startup event
 */
export function createMockGatewayStartup(): MockHookEvent {
  return {
    type: 'gateway',
    action: 'startup',
    sessionKey: 'gateway',
    timestamp: new Date(),
    messages: [],
    context: {},
  };
}

function normalizeHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      normalized[key] = value.join(', ');
    }
  }

  return normalized;
}

/**
 * Mock webhook receiver for testing
 */
export class MockWebhookReceiver {
  public receivedEvents: OpenClawEvent[] = [];
  public requests: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
  }> = [];

  private server?: Server;

  /**
   * Start the mock receiver
   */
  async start(port: number = 3456): Promise<number> {
    return new Promise((resolve) => {
      this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
        let body = '';
        req.on('data', (chunk: Buffer | string) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body) as OpenClawEvent;
            this.receivedEvents.push(parsed);
            this.requests.push({
              url: req.url ?? '',
              method: req.method ?? 'POST',
              headers: normalizeHeaders(req.headers),
              body: parsed,
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: true }));
          } catch {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        });
      });

      this.server.listen(port, () => {
        const address = this.server?.address();
        if (address && typeof address === 'object') {
          resolve(address.port);
          return;
        }
        resolve(port);
      });
    });
  }

  /**
   * Stop the mock receiver
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  /**
   * Clear received events
   */
  clear(): void {
    this.receivedEvents = [];
    this.requests = [];
  }

  /**
   * Get received events count
   */
  getEventCount(): number {
    return this.receivedEvents.length;
  }
}
