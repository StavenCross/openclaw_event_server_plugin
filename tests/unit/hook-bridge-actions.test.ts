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

  it('dispatches webhook action when tool rule matches', async () => {
    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: true,
        actions: {
          notify: {
            type: 'webhook',
            url: `http://localhost:${receiverPort}/events`,
            method: 'POST',
          },
        },
        rules: [
          {
            id: 'sudo-alert',
            when: {
              eventType: 'tool.called',
              toolName: 'exec',
              contains: {
                'data.params.command': 'sudo',
              },
            },
            action: 'notify',
          },
        ],
      },
      logger,
    );

    const event = createEvent('tool.called', {
      data: {
        toolName: 'exec',
        params: { command: 'sudo rm -rf /tmp/test' },
      },
    });

    bridge.onEvent(event);
    await bridge.stop();

    expect(receiver.requests).toHaveLength(1);
    const payload = receiver.requests[0].body as { ruleId: string; event: OpenClawEvent };
    expect(payload.ruleId).toBe('sudo-alert');
    expect(payload.event.type).toBe('tool.called');
  });

  it('applies cooldown per rule', async () => {
    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: true,
        actions: {
          notify: {
            type: 'webhook',
            url: `http://localhost:${receiverPort}/events`,
            method: 'POST',
          },
        },
        rules: [
          {
            id: 'once-a-minute',
            when: { eventType: 'tool.called' },
            action: 'notify',
            cooldownMs: 60000,
          },
        ],
      },
      logger,
    );

    bridge.onEvent(createEvent('tool.called'));
    bridge.onEvent(createEvent('tool.called'));
    await bridge.stop();

    expect(receiver.requests).toHaveLength(1);
  });

  it('matches parentStatus using latest agent.status event', async () => {
    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: true,
        actions: {
          wake: {
            type: 'webhook',
            url: `http://localhost:${receiverPort}/events`,
            method: 'POST',
          },
        },
        rules: [
          {
            id: 'wake-parent',
            when: {
              eventType: 'subagent.idle',
              idleForMsGte: 300000,
              parentStatus: 'sleeping',
            },
            action: 'wake',
          },
        ],
      },
      logger,
    );

    bridge.onEvent(
      createEvent('agent.status', {
        agentId: 'parent-1',
        data: { status: 'sleeping' },
      }),
    );

    bridge.onEvent(
      createEvent('subagent.idle', {
        data: {
          parentAgentId: 'parent-1',
          idleForMs: 600000,
          childSessionKey: 'child-123',
        },
      }),
    );

    await bridge.stop();

    expect(receiver.requests).toHaveLength(1);
  });

  it('executes allowed local script action', async () => {
    const outputPath = join(tempDir, 'script-output.json');
    const scriptPath = join(tempDir, 'write-event.sh');
    await writeFile(
      scriptPath,
      '#!/bin/sh\ncat - > "$1"\n',
      'utf8',
    );
    await chmod(scriptPath, 0o755);

    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: true,
        allowedActionDirs: [tempDir],
        actions: {
          local: {
            type: 'local_script',
            path: scriptPath,
            args: [outputPath],
          },
        },
        rules: [
          {
            id: 'local-rule',
            when: { eventType: 'tool.called' },
            action: 'local',
          },
        ],
      },
      logger,
    );

    bridge.onEvent(createEvent('tool.called', { data: { toolName: 'exec' } }));
    await bridge.stop();

    const raw = await readFile(outputPath, 'utf8');
    const payload = JSON.parse(raw) as { ruleId: string; event: OpenClawEvent };
    expect(payload.ruleId).toBe('local-rule');
    expect(payload.event.type).toBe('tool.called');
  });

  it('rejects local script path outside allowed directories', async () => {
    const scriptPath = join(tempDir, 'blocked.sh');
    await writeFile(scriptPath, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(scriptPath, 0o755);

    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: true,
        allowedActionDirs: [join(tempDir, 'allowed')],
        actions: {
          blocked: {
            type: 'local_script',
            path: scriptPath,
            args: [],
          },
        },
        rules: [
          {
            id: 'blocked-rule',
            when: { eventType: 'tool.called' },
            action: 'blocked',
          },
        ],
      },
      logger,
    );

    bridge.onEvent(createEvent('tool.called'));
    await bridge.stop();

    expect(logger.error).toHaveBeenCalled();
  });

  it('times out long-running local scripts and reports failure', async () => {
    const scriptPath = join(tempDir, 'sleep.sh');
    await writeFile(scriptPath, '#!/bin/sh\nsleep 3\n', 'utf8');
    await chmod(scriptPath, 0o755);

    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: true,
        allowedActionDirs: [tempDir],
        actions: {
          sleeper: {
            type: 'local_script',
            path: scriptPath,
            args: [],
            timeoutMs: 100,
          },
        },
        rules: [
          {
            id: 'sleep-rule',
            when: { eventType: 'tool.called' },
            action: 'sleeper',
          },
        ],
      },
      logger,
    );

    bridge.onEvent(createEvent('tool.called'));
    await bridge.stop();

    expect(logger.error).toHaveBeenCalledWith(
      '[HookBridge] action failed',
      'sleep-rule',
      'sleeper',
      'tool.called',
      expect.stringContaining('timed out'),
    );
  });

  it('rejects symlinked scripts that resolve outside allowed directories', async () => {
    const allowedDir = join(tempDir, 'allowed');
    const outsideDir = join(tempDir, 'outside');
    await mkdir(allowedDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });

    const outsideScript = join(outsideDir, 'outside.sh');
    await writeFile(outsideScript, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(outsideScript, 0o755);

    const symlinkPath = join(allowedDir, 'linked.sh');
    await symlink(outsideScript, symlinkPath);

    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: true,
        allowedActionDirs: [allowedDir],
        actions: {
          linked: {
            type: 'local_script',
            path: symlinkPath,
            args: [],
          },
        },
        rules: [
          {
            id: 'linked-rule',
            when: { eventType: 'tool.called' },
            action: 'linked',
          },
        ],
      },
      logger,
    );

    bridge.onEvent(createEvent('tool.called'));
    await bridge.stop();

    expect(logger.error).toHaveBeenCalledWith(
      '[HookBridge] action failed',
      'linked-rule',
      'linked',
      'tool.called',
      expect.stringContaining('not allowed'),
    );
  });

  it('drops oldest queued task when queue is full and drop policy is drop_oldest', async () => {
    const outputPath = join(tempDir, 'drop-oldest-output.log');
    const scriptPath = join(tempDir, 'sleep-and-write.sh');
    await writeFile(
      scriptPath,
      '#!/bin/sh\nsleep 0.2\ncat - >> "$1"\nprintf "\\n" >> "$1"\n',
      'utf8',
    );
    await chmod(scriptPath, 0o755);

    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: true,
        allowedActionDirs: [tempDir],
        runtime: {
          maxPendingEvents: 1,
          concurrency: 1,
          dropPolicy: 'drop_oldest',
        },
        actions: {
          local: {
            type: 'local_script',
            path: scriptPath,
            args: [outputPath],
          },
        },
        rules: [
          {
            id: 'drop-oldest-rule',
            when: { eventType: 'tool.called' },
            action: 'local',
          },
        ],
      },
      logger,
    );

    bridge.onEvent(createEvent('tool.called', { eventId: 'event-1' }));
    bridge.onEvent(createEvent('tool.called', { eventId: 'event-2' }));
    bridge.onEvent(createEvent('tool.called', { eventId: 'event-3' }));
    await bridge.stop();

    const raw = await readFile(outputPath, 'utf8');
    expect(raw.includes('event-1')).toBe(true);
    expect(raw.includes('event-3')).toBe(true);
    expect(raw.includes('event-2')).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      '[HookBridge] hookbridge.queue.drop',
      expect.stringContaining('policy=drop_oldest'),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it('supports per-rule coalescing with latest strategy', async () => {
    const blockerPath = join(tempDir, 'blocker.sh');
    const coalescedPath = join(tempDir, 'coalesced.log');
    const coalesceWriterPath = join(tempDir, 'coalesce-writer.sh');
    await writeFile(blockerPath, '#!/bin/sh\nsleep 0.3\ncat - > /dev/null\n', 'utf8');
    await writeFile(coalesceWriterPath, '#!/bin/sh\ncat - >> "$1"\nprintf "\\n" >> "$1"\n', 'utf8');
    await chmod(blockerPath, 0o755);
    await chmod(coalesceWriterPath, 0o755);

    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: true,
        allowedActionDirs: [tempDir],
        runtime: {
          maxPendingEvents: 100,
          concurrency: 1,
          dropPolicy: 'drop_oldest',
        },
        actions: {
          blocker: {
            type: 'local_script',
            path: blockerPath,
            args: [],
          },
          writer: {
            type: 'local_script',
            path: coalesceWriterPath,
            args: [coalescedPath],
          },
        },
        rules: [
          {
            id: 'blocker-rule',
            when: {
              eventType: 'tool.called',
              toolName: 'block',
            },
            action: 'blocker',
          },
          {
            id: 'coalesce-rule',
            when: {
              eventType: 'tool.called',
              toolName: 'exec',
            },
            action: 'writer',
            coalesce: {
              enabled: true,
              keyFields: ['ruleId', 'sessionKey', 'data.toolName'],
              windowMs: 60000,
              strategy: 'latest',
            },
          },
        ],
      },
      logger,
    );

    bridge.onEvent(
      createEvent('tool.called', {
        eventId: 'block-1',
        sessionKey: 'session-a',
        data: { toolName: 'block' },
      }),
    );
    await wait(20);
    bridge.onEvent(
      createEvent('tool.called', {
        eventId: 'coalesce-1',
        sessionKey: 'session-a',
        data: { toolName: 'exec' },
      }),
    );
    bridge.onEvent(
      createEvent('tool.called', {
        eventId: 'coalesce-2',
        sessionKey: 'session-a',
        data: { toolName: 'exec' },
      }),
    );
    await bridge.stop();

    const raw = await readFile(coalescedPath, 'utf8');
    expect(raw.includes('coalesce-2')).toBe(true);
    expect(raw.includes('coalesce-1')).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      '[HookBridge] hookbridge.rule.coalesced',
      'coalesce-rule',
      expect.any(String),
      expect.any(String),
      'strategy=latest',
    );
  });
});
