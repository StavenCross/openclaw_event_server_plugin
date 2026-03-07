/**
 * Unit tests for runtime config resolution and event filtering.
 */

import {
  DEFAULT_CONFIG,
  PluginConfig,
  resolveRuntimeConfig,
  shouldFilterEvent,
} from '../../src/config';
import { resolveTransportSocketPath } from '../../src/config/runtime-paths';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

describe('resolveRuntimeConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('keeps explicit hmac secret when provided', () => {
    const config = resolveRuntimeConfig({
      ...DEFAULT_CONFIG,
      security: {
        ...DEFAULT_CONFIG.security,
        hmac: {
          ...DEFAULT_CONFIG.security.hmac,
          enabled: true,
          secret: 'inline-secret',
          secretFilePath: undefined,
        },
      },
    });

    expect(config.security.hmac.secret).toBe('inline-secret');
  });

  it('resolves relative event log path against OPENCLAW_STATE_DIR when present', () => {
    process.env.OPENCLAW_STATE_DIR = '/tmp/openclaw-state';
    process.env.OPENCLAW_CONFIG_PATH = '/tmp/ignored/openclaw.json';

    const config = resolveRuntimeConfig({
      ...DEFAULT_CONFIG,
      eventLog: {
        ...DEFAULT_CONFIG.eventLog,
        path: '.event-server/events.ndjson',
      },
    });

    expect(config.eventLog.path).toBe('/tmp/openclaw-state/.event-server/events.ndjson');
    expect(config.transport.lockPath).toBe('/tmp/openclaw-state/.event-server/transport.lock');
    expect(config.transport.socketPath).toBe('/tmp/openclaw-state/.event-server/transport.sock');
  });

  it('resolves relative event log path against OPENCLAW_CONFIG_PATH directory', () => {
    delete process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_CONFIG_PATH = '/tmp/openclaw-profile/openclaw.json';

    const config = resolveRuntimeConfig({
      ...DEFAULT_CONFIG,
      eventLog: {
        ...DEFAULT_CONFIG.eventLog,
        path: '.event-server/events.ndjson',
      },
    });

    expect(config.eventLog.path).toBe('/tmp/openclaw-profile/.event-server/events.ndjson');
  });

  it('falls back to ~/.openclaw for relative event log path resolution', () => {
    delete process.env.OPENCLAW_STATE_DIR;
    delete process.env.OPENCLAW_CONFIG_PATH;

    const config = resolveRuntimeConfig({
      ...DEFAULT_CONFIG,
      eventLog: {
        ...DEFAULT_CONFIG.eventLog,
        path: '.event-server/events.ndjson',
      },
    });

    expect(config.eventLog.path).toBe(resolve(homedir(), '.openclaw', '.event-server/events.ndjson'));
  });

  it('keeps absolute event log path unchanged', () => {
    const config = resolveRuntimeConfig({
      ...DEFAULT_CONFIG,
      queue: {
        ...DEFAULT_CONFIG.queue,
        persistPath: '/var/lib/openclaw/queue.json',
      },
      eventLog: {
        ...DEFAULT_CONFIG.eventLog,
        path: '/var/log/openclaw/events.ndjson',
      },
    });

    expect(config.eventLog.path).toBe('/var/log/openclaw/events.ndjson');
    expect(config.queue.persistPath).toBe('/var/lib/openclaw/queue.json');
  });

  it('maps transport socket paths to named pipes on Windows', () => {
    const resolved = resolveTransportSocketPath('.event-server/transport.sock', 'win32');
    expect(resolved).toContain('\\\\.\\pipe\\');
    expect(resolved).toContain('transport.sock');
  });
});

describe('shouldFilterEvent', () => {
  const baseConfig: PluginConfig = {
    ...DEFAULT_CONFIG,
    filters: {},
  };

  it('should not filter when no filters configured', () => {
    const result = shouldFilterEvent(baseConfig, 'message.sent', 'whatsapp');
    expect(result).toBe(false);
  });

  it('should filter excluded event types', () => {
    const config: PluginConfig = {
      ...baseConfig,
      filters: { excludeTypes: ['message.sent'] },
    };

    const result = shouldFilterEvent(config, 'message.sent');
    expect(result).toBe(true);
  });

  it('should filter non-included event types when includeTypes specified', () => {
    const config: PluginConfig = {
      ...baseConfig,
      filters: { includeTypes: ['tool.called'] },
    };

    const result = shouldFilterEvent(config, 'message.sent');
    expect(result).toBe(true);
  });

  it('should allow included event types', () => {
    const config: PluginConfig = {
      ...baseConfig,
      filters: { includeTypes: ['message.sent'] },
    };

    const result = shouldFilterEvent(config, 'message.sent');
    expect(result).toBe(false);
  });

  it('should filter by channel ID', () => {
    const config: PluginConfig = {
      ...baseConfig,
      filters: { channelId: 'slack' },
    };

    const result = shouldFilterEvent(config, 'message.sent', 'whatsapp');
    expect(result).toBe(true);
  });

  it('should filter when channel filter is set but event has no channel', () => {
    const config: PluginConfig = {
      ...baseConfig,
      filters: { channelId: 'slack' },
    };

    const result = shouldFilterEvent(config, 'message.sent');
    expect(result).toBe(true);
  });

  it('should filter by tool name', () => {
    const config: PluginConfig = {
      ...baseConfig,
      filters: { toolName: 'web_search' },
    };

    const result = shouldFilterEvent(config, 'tool.called', undefined, 'read');
    expect(result).toBe(true);
  });

  it('should filter when tool filter is set but event has no tool name', () => {
    const config: PluginConfig = {
      ...baseConfig,
      filters: { toolName: 'web_search' },
    };

    const result = shouldFilterEvent(config, 'tool.called');
    expect(result).toBe(true);
  });
});
