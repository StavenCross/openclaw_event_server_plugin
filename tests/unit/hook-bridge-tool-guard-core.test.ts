import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
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

  it('evaluates toolGuard local script decision and blocks matching tool calls', async () => {
    const decisionScriptPath = join(tempDir, 'tool-guard-decision.sh');
    await writeFile(
      decisionScriptPath,
      '#!/bin/sh\nread payload\nif echo "$payload" | grep -q "sudo"; then\n  printf \'{"block":true,"blockReason":"sudo requires approval"}\'\nelse\n  printf \'{"params":{"mode":"safe"}}\'\nfi\n',
      'utf8',
    );
    await chmod(decisionScriptPath, 0o755);

    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          onError: 'allow',
          rules: [
            {
              id: 'guard-exec',
              when: {
                toolName: 'exec',
              },
              action: 'guard-script',
            },
          ],
        },
        allowedActionDirs: [tempDir],
        actions: {
          'guard-script': {
            type: 'local_script',
            path: decisionScriptPath,
            args: [],
          },
        },
      },
      logger,
    );

    const blocked = await bridge.evaluateBeforeToolCall({
      toolName: 'exec',
      params: { command: 'sudo whoami' },
      sessionKey: 'session-guard',
    });
    const modified = await bridge.evaluateBeforeToolCall({
      toolName: 'exec',
      params: { command: 'ls -la' },
      sessionKey: 'session-guard',
    });

    expect(blocked).toMatchObject({
      block: true,
      blockReason: 'sudo requires approval',
    });
    expect(modified).toMatchObject({
      params: { mode: 'safe' },
    });
  });

  it('applies toolGuard fail-closed mode when action errors', async () => {
    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          onError: 'block',
          rules: [
            {
              id: 'guard-on-error',
              when: {
                toolName: 'exec',
              },
              action: 'missing-action',
            },
          ],
        },
        actions: {},
      },
      logger,
    );

    const decision = await bridge.evaluateBeforeToolCall({
      toolName: 'exec',
      params: { command: 'echo hi' },
    });

    expect(decision?.block).toBe(true);
    expect(decision?.blockReason).toContain('Tool guard action not found');
  });

  it('supports static toolGuard decisions with regex filters for malformed calls', async () => {
    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          rules: [
            {
              id: 'web-browse-url-must-be-https',
              when: {
                toolName: 'web_browse',
                notMatchesRegex: {
                  'data.params.url': '^https://',
                },
              },
              decision: {
                block: true,
                blockReason: 'Malformed web_browse url. Use: web_browse "https://..."',
              },
            },
          ],
        },
        actions: {},
      },
      logger,
    );

    const blocked = await bridge.evaluateBeforeToolCall({
      toolName: 'web_browse',
      params: { url: 'h://www.website.com' },
    });
    const allowed = await bridge.evaluateBeforeToolCall({
      toolName: 'web_browse',
      params: { url: 'https://www.website.com' },
    });

    expect(blocked).toMatchObject({
      block: true,
      blockReason: 'Malformed web_browse url. Use: web_browse "https://..."',
    });
    expect(allowed).toBeUndefined();
  });

  it('enforces retry backoff after blocked decision', async () => {
    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          retryBackoffMs: 60000,
          retryBackoffReason: 'Back off before retrying {{toolName}}',
          rules: [
            {
              id: 'always-block-exec',
              when: { toolName: 'exec' },
              decision: {
                block: true,
                blockReason: 'Denied',
              },
            },
          ],
        },
      },
      logger,
    );

    const first = await bridge.evaluateBeforeToolCall({
      toolName: 'exec',
      params: { command: 'whoami' },
    });
    const second = await bridge.evaluateBeforeToolCall({
      toolName: 'exec',
      params: { command: 'whoami' },
    });

    expect(first?.decisionSource).toBe('rule');
    expect(second?.decisionSource).toBe('backoff');
    expect(second?.blockReason).toContain('Back off before retrying exec');
  });

  it('uses approval cache for repeated allowed calls', async () => {
    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          approvalCacheTtlMs: 60000,
          rules: [
            {
              id: 'allow-read',
              when: { toolName: 'read' },
              decision: {
                params: { normalized: true },
              },
            },
          ],
        },
      },
      logger,
    );

    const first = await bridge.evaluateBeforeToolCall({
      toolName: 'read',
      params: { path: 'README.md' },
    });
    const second = await bridge.evaluateBeforeToolCall({
      toolName: 'read',
      params: { path: 'README.md' },
    });

    expect(first?.decisionSource).toBe('rule');
    expect(second?.decisionSource).toBe('cache');
    expect(second?.params).toEqual({ normalized: true });
  });

  it('applies rule priority and stopOnMatch semantics', async () => {
    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          stopOnMatchDefault: false,
          rules: [
            {
              id: 'low-priority-allow',
              priority: 10,
              when: { toolName: 'exec' },
              decision: { params: { mode: 'safe' } },
            },
            {
              id: 'high-priority-stop',
              priority: 20,
              stopOnMatch: true,
              when: { toolName: 'exec' },
              decision: {
                block: true,
                blockReasonTemplate: 'Blocked {{toolName}} call',
              },
            },
          ],
        },
      },
      logger,
    );

    const decision = await bridge.evaluateBeforeToolCall({
      toolName: 'exec',
      params: { command: 'ls -la' },
    });

    expect(decision?.matchedRuleId).toBe('high-priority-stop');
    expect(decision?.block).toBe(true);
    expect(decision?.blockReason).toBe('Blocked exec call');
  });
});
