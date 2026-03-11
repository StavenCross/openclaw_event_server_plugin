import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import plugin from '../../src/index';
import { MockOpenClawApi } from '../mocks/openclaw-runtime';

interface HookSurfaceFixture {
  openclawCommit: string;
  capturedAt: string;
  internalHooks: string[];
  pluginHooks: string[];
}

function readFixture(): HookSurfaceFixture {
  const raw = readFileSync(
    join(__dirname, '../fixtures/openclaw-hook-surface.v3caab92.json'),
    'utf8',
  );
  return JSON.parse(raw) as HookSurfaceFixture;
}

describe('OpenClaw hook surface contract', () => {
  const fixture = readFixture();

  beforeEach(() => {
    process.env.EVENT_PLUGIN_DISABLE_WS = 'true';
    process.env.EVENT_PLUGIN_DISABLE_STATUS_TICKER = 'true';
  });

  afterEach(async () => {
    await plugin.deactivate();
    delete process.env.EVENT_PLUGIN_DISABLE_WS;
    delete process.env.EVENT_PLUGIN_DISABLE_STATUS_TICKER;
  });

  it('pins expected runtime hook names from OpenClaw commit fixture', () => {
    expect(fixture.openclawCommit).toBe('3caab924d0d7c2e0d6e5e4fb2e9a4b7a3a7d1d7f');
    expect(fixture.internalHooks).toEqual(
      expect.arrayContaining([
        'message:received',
        'message:transcribed',
        'message:preprocessed',
        'message:sent',
        'command:new',
        'command:reset',
        'command:stop',
        'agent:bootstrap',
        'agent:error',
        'agent:session:start',
        'agent:session:end',
        'gateway:startup',
      ]),
    );
    expect(fixture.pluginHooks).toEqual(
      expect.arrayContaining([
        'before_model_resolve',
        'before_prompt_build',
        'llm_input',
        'llm_output',
        'agent_end',
        'before_compaction',
        'after_compaction',
        'before_tool_call',
        'after_tool_call',
        'tool_result_persist',
        'session_start',
        'session_end',
        'subagent_spawning',
        'subagent_spawned',
        'subagent_ended',
        'gateway_start',
        'gateway_stop',
      ]),
    );
  });

  it('registers only hooks represented by the pinned hook-surface fixture', () => {
    const api = new MockOpenClawApi();
    plugin.activate(api);

    const internal = api.registeredHooks.map((hook) => hook.event);
    const typed = api.registeredTypedHooks.map((hook) => hook.event);

    for (const hookName of internal) {
      expect(fixture.internalHooks.includes(hookName)).toBe(true);
    }

    for (const hookName of typed) {
      expect(fixture.pluginHooks.includes(hookName)).toBe(true);
    }
  });
});
