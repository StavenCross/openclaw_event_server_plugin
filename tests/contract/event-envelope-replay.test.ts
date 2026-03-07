import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPlugin } from '../../src/index';
import { OpenClawEvent } from '../../src/events/types';
import { MockOpenClawApi, MockWebhookReceiver } from '../mocks/openclaw-runtime';

type ReplayStep = {
  kind: 'internal' | 'typed';
  event: string;
  payload: unknown;
  ctx?: unknown;
};

type ReplayFixture = {
  name: string;
  steps: ReplayStep[];
  expectedTypes: string[];
};

function readFixture(): ReplayFixture {
  const raw = readFileSync(join(__dirname, '../fixtures/mission-control-replay.v1.json'), 'utf8');
  return JSON.parse(raw) as ReplayFixture;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function assertEnvelope(event: OpenClawEvent): void {
  expect(typeof event.eventId).toBe('string');
  expect(typeof event.schemaVersion).toBe('string');
  expect(typeof event.type).toBe('string');
  expect(typeof event.timestamp).toBe('string');
  expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
  expect(typeof event.pluginVersion).toBe('string');
  expect(typeof event.eventCategory).toBe('string');
  expect(typeof event.eventName).toBe('string');
  expect(typeof event.source).toBe('string');
  expect(typeof event.correlationId).toBe('string');
  expect(typeof event.data).toBe('object');
  expect(event.data).not.toBeNull();
}

describe('Mission Control envelope compatibility replay', () => {
  const fixture = readFixture();

  it('replays fixture events and preserves canonical envelope fields', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'event-plugin-replay-'));
    const plugin = createPlugin();
    const api = new MockOpenClawApi();
    api.config = {
      transport: {
        mode: 'owner',
      },
      queue: {
        flushIntervalMs: 100,
      },
    };
    const receiver = new MockWebhookReceiver();
    const port = await receiver.start(0);

    process.env.EVENT_PLUGIN_WEBHOOKS = `http://127.0.0.1:${port}/events`;
    process.env.EVENT_PLUGIN_DISABLE_WS = 'true';
    process.env.EVENT_PLUGIN_DISABLE_STATUS_TICKER = 'true';
    process.env.OPENCLAW_STATE_DIR = tempDir;

    try {
      plugin.activate(api);

      for (const step of fixture.steps) {
        if (step.kind === 'internal') {
          await api.triggerHook(step.event, step.payload);
        } else {
          await api.triggerTypedHook(step.event, step.payload, step.ctx ?? {});
        }
      }

      const start = Date.now();
      while (Date.now() - start < 4000) {
        const emittedTypes = new Set(receiver.receivedEvents.map((event) => String(event.type)));
        const allPresent = fixture.expectedTypes.every((expected) => emittedTypes.has(expected));
        if (allPresent) {
          break;
        }
        await wait(25);
      }

      const missingTypes = fixture.expectedTypes.filter(
        (expectedType) => !receiver.receivedEvents.some((event) => event.type === expectedType),
      );
      expect(missingTypes).toEqual([]);

      for (const expectedType of fixture.expectedTypes) {
        const matched = receiver.receivedEvents.find((event) => event.type === expectedType);
        if (matched) {
          assertEnvelope(matched);
        }
      }
    } finally {
      await plugin.deactivate();
      await receiver.stop();
      await rm(tempDir, { recursive: true, force: true });
      delete process.env.EVENT_PLUGIN_WEBHOOKS;
      delete process.env.EVENT_PLUGIN_DISABLE_WS;
      delete process.env.EVENT_PLUGIN_DISABLE_STATUS_TICKER;
      delete process.env.OPENCLAW_STATE_DIR;
    }
  });
});
