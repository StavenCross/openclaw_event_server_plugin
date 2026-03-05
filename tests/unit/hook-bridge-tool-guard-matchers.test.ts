import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../../src/config';
import { OpenClawEvent } from '../../src/events/types';
import { HookBridge } from '../../src/runtime/hook-bridge';
import { RuntimeLogger } from '../../src/runtime/types';
import { MockWebhookReceiver } from '../mocks/openclaw-runtime';

function createEvent(type: OpenClawEvent['type'], overrides?: Partial<OpenClawEvent>): OpenClawEvent {
  return {
    eventId: `event-${Math.random()}`,
    schemaVersion: '1.1.0',
    type,
    timestamp: new Date().toISOString(),
    pluginVersion: '1.0.0',
    data: {},
    ...overrides,
  };
}

describe('HookBridge', () => {
  let receiver: MockWebhookReceiver;
  let tempDir: string;
  let receiverPort: number;

  const logger: RuntimeLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    queue: jest.fn(),
  };

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(async () => {
    receiver = new MockWebhookReceiver();
    receiverPort = await receiver.start(0);
    tempDir = await mkdtemp(join(tmpdir(), 'hook-bridge-test-'));
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await receiver.stop();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('supports advanced matcher filters for malformed tool calls', async () => {
    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          retryBackoffMs: 0,
          rules: [
            {
              id: 'complex-web-browse',
              when: {
                toolName: 'web_browse',
                requiredPaths: ['data.params.url', 'data.params.tags', 'data.params.meta'],
                typeChecks: {
                  'data.params.url': 'string',
                  'data.params.tags': 'array',
                  'data.params.meta': 'object',
                },
                inList: {
                  'data.params.mode': ['safe', 'review'],
                },
                notInList: {
                  'data.params.transport': ['ftp'],
                },
                domainAllowlist: ['example.com'],
              },
              decision: {
                block: true,
                blockReasonTemplate: 'Malformed tool call for {{toolName}}: {{path:data.params.url}}',
              },
            },
          ],
        },
      },
      logger,
    );

    const blocked = await bridge.evaluateBeforeToolCall({
      toolName: 'web_browse',
      params: {
        url: 'https://docs.example.com/path',
        tags: ['docs'],
        meta: { retried: false },
        mode: 'safe',
        transport: 'https',
      },
    });
    const allowed = await bridge.evaluateBeforeToolCall({
      toolName: 'web_browse',
      params: {
        url: 'https://docs.example.com/path',
        tags: ['docs'],
        meta: { retried: false },
        mode: 'unsafe',
        transport: 'https',
      },
    });

    expect(blocked?.block).toBe(true);
    expect(blocked?.matchedRuleId).toBe('complex-web-browse');
    expect(blocked?.blockReason).toContain('Malformed tool call for web_browse');
    expect(allowed).toBeUndefined();
  });

  it('supports domain blocklists using custom domainPath', async () => {
    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          retryBackoffMs: 0,
          rules: [
            {
              id: 'blocked-domain',
              when: {
                toolName: 'http_fetch',
                domainPath: 'data.params.target',
                domainBlocklist: ['blocked.com'],
              },
              decision: {
                block: true,
                blockReason: 'Blocked target domain',
              },
            },
          ],
        },
      },
      logger,
    );

    const blocked = await bridge.evaluateBeforeToolCall({
      toolName: 'http_fetch',
      params: { target: 'https://api.blocked.com/v1' },
    });
    const allowed = await bridge.evaluateBeforeToolCall({
      toolName: 'http_fetch',
      params: { target: 'https://api.allowed.com/v1' },
    });

    expect(blocked?.block).toBe(true);
    expect(blocked?.matchedRuleId).toBe('blocked-domain');
    expect(allowed).toBeUndefined();
  });

  it('treats regex matcher edge cases safely', async () => {
    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          retryBackoffMs: 0,
          rules: [
            {
              id: 'not-matches-non-string',
              when: {
                toolName: 'exec',
                notMatchesRegex: {
                  'data.params.command': '^sudo\\b',
                },
              },
              decision: {
                block: true,
                blockReason: 'Must be reviewed',
              },
            },
            {
              id: 'invalid-regex',
              when: {
                toolName: 'read',
                matchesRegex: {
                  'data.params.path': '[unterminated',
                },
              },
              decision: {
                block: true,
                blockReason: 'Should never match with invalid regex',
              },
            },
          ],
        },
      },
      logger,
    );

    const blocked = await bridge.evaluateBeforeToolCall({
      toolName: 'exec',
      params: { command: 42 },
    });
    const allowed = await bridge.evaluateBeforeToolCall({
      toolName: 'read',
      params: { path: '/tmp/file.txt' },
    });

    expect(blocked?.block).toBe(true);
    expect(blocked?.matchedRuleId).toBe('not-matches-non-string');
    expect(allowed).toBeUndefined();
  });

  it('ignores malformed guard decisions that only include blockReason', async () => {
    const decisionScriptPath = join(tempDir, 'malformed-decision.sh');
    await writeFile(
      decisionScriptPath,
      '#!/bin/sh\nprintf \'{"blockReason":"manual approval required"}\'\n',
      'utf8',
    );
    await chmod(decisionScriptPath, 0o755);

    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        allowedActionDirs: [tempDir],
        actions: {
          malformedDecision: {
            type: 'local_script',
            path: decisionScriptPath,
            args: [],
          },
        },
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          rules: [
            {
              id: 'malformed-rule',
              when: { toolName: 'exec' },
              action: 'malformedDecision',
            },
          ],
        },
      },
      logger,
    );

    const decision = await bridge.evaluateBeforeToolCall({
      toolName: 'exec',
      params: { command: 'whoami' },
    });

    expect(decision).toBeUndefined();
  });
});
