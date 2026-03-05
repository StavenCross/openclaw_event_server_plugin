/**
 * Unit tests for configuration defaults and environment parsing.
 */

import { DEFAULT_CONFIG, loadEnvConfig } from '../../src/config';

describe('Configuration Defaults', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_CONFIG.webhooks).toEqual([]);
    expect(DEFAULT_CONFIG.filters).toEqual({
      includeTypes: [],
      excludeTypes: [],
    });
    expect(DEFAULT_CONFIG.retry.maxAttempts).toBe(3);
    expect(DEFAULT_CONFIG.retry.initialDelayMs).toBe(1000);
    expect(DEFAULT_CONFIG.queue.maxSize).toBe(1000);
    expect(DEFAULT_CONFIG.logging.logErrors).toBe(true);
    expect(DEFAULT_CONFIG.status.workingWindowMs).toBe(30000);
    expect(DEFAULT_CONFIG.status.sleepingWindowMs).toBe(600000);
    expect(DEFAULT_CONFIG.status.tickIntervalMs).toBe(5000);
    expect(DEFAULT_CONFIG.redaction.enabled).toBe(false);
    expect(DEFAULT_CONFIG.redaction.replacement).toBe('[REDACTED]');
    expect(DEFAULT_CONFIG.redaction.fields.length).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.eventLog.maxFileSizeMb).toBe(30);
  });
});

describe('loadEnvConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should load webhook URLs from environment', () => {
    process.env.EVENT_PLUGIN_WEBHOOKS = 'https://webhook1.com,https://webhook2.com';

    const config = loadEnvConfig();

    expect(config.webhooks).toHaveLength(2);
    expect(config.webhooks?.[0].url).toBe('https://webhook1.com');
    expect(config.webhooks?.[1].url).toBe('https://webhook2.com');
  });

  it('should load auth token from environment', () => {
    process.env.EVENT_PLUGIN_WEBHOOKS = 'https://webhook.com';
    process.env.EVENT_PLUGIN_AUTH_TOKEN = 'secret-token';

    const config = loadEnvConfig();

    expect(config.webhooks?.[0].authToken).toBe('secret-token');
  });

  it('should load debug flag from environment', () => {
    process.env.EVENT_PLUGIN_DEBUG = 'true';

    const config = loadEnvConfig();

    expect(config.logging?.debug).toBe(true);
  });

  it('should load event type filters from environment', () => {
    process.env.EVENT_PLUGIN_INCLUDE_TYPES = 'message.sent,tool.called';
    process.env.EVENT_PLUGIN_EXCLUDE_TYPES = 'session.error';

    const config = loadEnvConfig();

    expect(config.filters?.includeTypes).toEqual(['message.sent', 'tool.called']);
    expect(config.filters?.excludeTypes).toEqual(['session.error']);
  });

  it('should ignore unknown event types from environment', () => {
    process.env.EVENT_PLUGIN_INCLUDE_TYPES = 'message.sent,not.real,tool.called';
    process.env.EVENT_PLUGIN_EXCLUDE_TYPES = 'bad.type,session.error';

    const config = loadEnvConfig();

    expect(config.filters?.includeTypes).toEqual(['message.sent', 'tool.called']);
    expect(config.filters?.excludeTypes).toEqual(['session.error']);
  });

  it('should load enabled flag from environment', () => {
    process.env.EVENT_PLUGIN_ENABLED = 'false';

    const config = loadEnvConfig();

    expect(config.enabled).toBe(false);
  });

  it('should load status windows from environment', () => {
    process.env.EVENT_PLUGIN_STATUS_WORKING_WINDOW_MS = '45000';
    process.env.EVENT_PLUGIN_STATUS_SLEEPING_WINDOW_MS = '900000';
    process.env.EVENT_PLUGIN_STATUS_TICK_INTERVAL_MS = '7000';

    const config = loadEnvConfig();

    expect(config.status).toEqual({
      ...DEFAULT_CONFIG.status,
      workingWindowMs: 45000,
      sleepingWindowMs: 900000,
      tickIntervalMs: 7000,
    });
  });

  it('should load redaction settings from environment', () => {
    process.env.EVENT_PLUGIN_REDACTION_ENABLED = 'true';
    process.env.EVENT_PLUGIN_REDACTION_REPLACEMENT = '[MASKED]';
    process.env.EVENT_PLUGIN_REDACTION_FIELDS = 'content,params, token ';

    const config = loadEnvConfig();

    expect(config.redaction).toEqual({
      ...DEFAULT_CONFIG.redaction,
      enabled: true,
      replacement: '[MASKED]',
      fields: ['content', 'params', 'token'],
    });
  });

  it('should load event log and security settings from environment', () => {
    process.env.EVENT_PLUGIN_EVENT_LOG_ENABLED = 'true';
    process.env.EVENT_PLUGIN_EVENT_LOG_PATH = '/tmp/plugin-events.ndjson';
    process.env.EVENT_PLUGIN_EVENT_LOG_MAX_FILE_MB = '30';
    process.env.EVENT_PLUGIN_EVENT_LOG_FORMAT = 'summary';
    process.env.EVENT_PLUGIN_EVENT_LOG_MIN_LEVEL = 'warn';
    process.env.EVENT_PLUGIN_EVENT_LOG_RUNTIME = 'false';
    process.env.EVENT_PLUGIN_WS_BIND_ADDRESS = '0.0.0.0';
    process.env.EVENT_PLUGIN_WS_REQUIRE_AUTH = 'true';
    process.env.EVENT_PLUGIN_WS_AUTH_TOKEN = 'ws-token';
    process.env.EVENT_PLUGIN_WS_ALLOWED_ORIGINS = 'https://a.example,https://b.example';
    process.env.EVENT_PLUGIN_WS_ALLOWED_IPS = '10.0.0.1,10.0.0.2';
    process.env.EVENT_PLUGIN_HMAC_ENABLED = 'true';
    process.env.EVENT_PLUGIN_HMAC_SECRET = 'hmac-secret';
    process.env.EVENT_PLUGIN_HMAC_ALGORITHM = 'sha512';

    const config = loadEnvConfig();

    expect(config.eventLog).toEqual({
      ...DEFAULT_CONFIG.eventLog,
      enabled: true,
      path: '/tmp/plugin-events.ndjson',
      maxFileSizeMb: 30,
      format: 'summary',
      minLevel: 'warn',
      includeRuntimeLogs: false,
    });
    expect(config.security?.ws).toEqual({
      ...DEFAULT_CONFIG.security.ws,
      bindAddress: '0.0.0.0',
      requireAuth: true,
      authToken: 'ws-token',
      allowedOrigins: ['https://a.example', 'https://b.example'],
      allowedIps: ['10.0.0.1', '10.0.0.2'],
    });
    expect(config.security?.hmac).toEqual({
      ...DEFAULT_CONFIG.security.hmac,
      enabled: true,
      secret: 'hmac-secret',
      algorithm: 'sha512',
    });
  });
});
