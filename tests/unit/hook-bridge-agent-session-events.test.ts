import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../../src/config';
import { OpenClawEvent } from '../../src/events/types';
import { HookBridge } from '../../src/runtime/hook-bridge';
import { RuntimeLogger } from '../../src/runtime/types';

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

describe('HookBridge modern agent/session event matching', () => {
  let tempDir: string;

  const logger: RuntimeLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    queue: jest.fn(),
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'hook-bridge-agent-events-test-'));
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('matches new agent and session lifecycle events through generic data-path matchers', async () => {
    const outputPath = join(tempDir, 'matched-events.ndjson');
    const scriptPath = join(tempDir, 'capture-event.sh');
    await writeFile(
      scriptPath,
      '#!/bin/sh\ncat - >> "$1"\nprintf "\\n" >> "$1"\n',
      'utf8',
    );
    await chmod(scriptPath, 0o755);

    const bridge = new HookBridge(
      {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: true,
        allowedActionDirs: [tempDir],
        actions: {
          capture: {
            type: 'local_script',
            path: scriptPath,
            args: [outputPath],
          },
        },
        rules: [
          {
            id: 'prompt-build-rule',
            when: {
              eventType: 'agent.before_prompt_build',
              equals: {
                'data.messageCount': 2,
              },
              contains: {
                'data.prompt': 'Summarize',
              },
            },
            action: 'capture',
          },
          {
            id: 'compaction-rule',
            when: {
              eventType: 'session.after_compaction',
              equals: {
                'data.compactedCount': 28,
                'data.tokenCount': 1100,
              },
            },
            action: 'capture',
          },
          {
            id: 'llm-input-rule',
            when: {
              eventType: 'agent.llm_input',
              equals: {
                'data.historyMessageCount': 2,
                'data.imagesCount': 1,
              },
              contains: {
                'data.systemPrompt': 'concise',
              },
            },
            action: 'capture',
          },
          {
            id: 'llm-output-rule',
            when: {
              eventType: 'agent.llm_output',
              equals: {
                'data.assistantTextCount': 1,
                'data.usage.total': 18,
              },
              contains: {
                'data.assistantTexts.0': 'Summary complete',
              },
            },
            action: 'capture',
          },
          {
            id: 'agent-end-rule',
            when: {
              eventType: 'agent.end',
              equals: {
                'data.success': false,
                'data.durationMs': 3210,
              },
              contains: {
                'data.error': 'timed out',
              },
            },
            action: 'capture',
          },
        ],
      },
      logger,
    );

    bridge.onEvent(
      createEvent('agent.before_prompt_build', {
        agentId: 'agent-1',
        sessionId: 'session-1',
        sessionKey: 'session-1',
        runId: 'run-1',
        data: {
          prompt: 'Summarize this thread.',
          messages: [{ role: 'user' }, { role: 'assistant' }],
          messageCount: 2,
        },
      }),
    );
    bridge.onEvent(
      createEvent('agent.llm_input', {
        agentId: 'agent-1',
        sessionId: 'session-1',
        sessionKey: 'session-1',
        runId: 'run-1',
        data: {
          provider: 'openai',
          model: 'gpt-5',
          systemPrompt: 'Be concise and direct.',
          prompt: 'Summarize this thread.',
          historyMessages: [{ role: 'user' }, { role: 'assistant' }],
          historyMessageCount: 2,
          imagesCount: 1,
        },
      }),
    );
    bridge.onEvent(
      createEvent('agent.llm_output', {
        agentId: 'agent-1',
        sessionId: 'session-1',
        sessionKey: 'session-1',
        runId: 'run-1',
        data: {
          provider: 'openai',
          model: 'gpt-5',
          assistantTexts: ['Summary complete.'],
          assistantTextCount: 1,
          usage: { total: 18 },
        },
      }),
    );
    bridge.onEvent(
      createEvent('agent.end', {
        agentId: 'agent-1',
        sessionId: 'session-1',
        sessionKey: 'session-1',
        runId: 'run-1',
        data: {
          messages: [{ role: 'assistant', content: 'Summary complete.' }],
          messageCount: 1,
          success: false,
          error: 'request timed out',
          durationMs: 3210,
        },
      }),
    );
    bridge.onEvent(
      createEvent('session.after_compaction', {
        agentId: 'agent-1',
        sessionId: 'session-1',
        sessionKey: 'session-1',
        runId: 'run-1',
        data: {
          messageCount: 12,
          compactedCount: 28,
          tokenCount: 1100,
        },
      }),
    );

    await bridge.stop();

    const raw = await readFile(outputPath, 'utf8');
    expect(raw).toContain('prompt-build-rule');
    expect(raw).toContain('agent.before_prompt_build');
    expect(raw).toContain('llm-input-rule');
    expect(raw).toContain('agent.llm_input');
    expect(raw).toContain('llm-output-rule');
    expect(raw).toContain('agent.llm_output');
    expect(raw).toContain('agent-end-rule');
    expect(raw).toContain('agent.end');
    expect(raw).toContain('compaction-rule');
    expect(raw).toContain('session.after_compaction');
  });
});
