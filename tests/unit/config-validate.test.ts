/**
 * Unit tests for configuration validation.
 */

import { DEFAULT_CONFIG, PluginConfig, validateConfig } from '../../src/config';

describe('validateConfig', () => {
  it('should validate correct config', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      webhooks: [{ url: 'https://valid.com' }],
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect invalid transport config', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      transport: {
        ...DEFAULT_CONFIG.transport,
        mode: 'legacy' as unknown as 'auto' | 'owner' | 'follower',
        lockPath: '',
        socketPath: '',
        lockStaleMs: 500,
        heartbeatMs: 200,
        relayTimeoutMs: 50,
        reconnectBackoffMs: 10,
        maxPendingEvents: 0,
        maxPayloadBytes: 512,
        dedupeTtlMs: 500,
        semanticDedupeEnabled: true,
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Transport mode must be auto, owner, or follower');
    expect(result.errors).toContain('Transport lockPath cannot be empty');
    expect(result.errors).toContain('Transport socketPath cannot be empty');
    expect(result.errors).toContain('Transport lockStaleMs must be at least 1000');
    expect(result.errors).toContain('Transport heartbeatMs must be at least 250');
    expect(result.errors).toContain('Transport relayTimeoutMs must be at least 100');
    expect(result.errors).toContain('Transport reconnectBackoffMs must be at least 50');
    expect(result.errors).toContain('Transport maxPendingEvents must be at least 1');
    expect(result.errors).toContain('Transport maxPayloadBytes must be at least 1024');
    expect(result.errors).toContain('Transport dedupeTtlMs must be at least 1000');
  });

  it('should detect heartbeat interval not lower than lock staleness window', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      transport: {
        ...DEFAULT_CONFIG.transport,
        lockStaleMs: 1000,
        heartbeatMs: 1000,
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Transport heartbeatMs must be less than lockStaleMs');
  });

  it('should detect invalid webhook URL', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      webhooks: [{ url: 'not-a-url' }],
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Webhook 0: Invalid URL format');
  });

  it('should detect invalid hook bridge tool guard config', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      hookBridge: {
        ...DEFAULT_CONFIG.hookBridge,
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          timeoutMs: 50,
          onError: 'deny' as unknown as 'allow' | 'block',
          redaction: {
            enabled: true,
            replacement: '',
            fields: 'command' as unknown as string[],
          },
          rules: [
            {
              id: 'guard-1',
              when: {
                toolName: 'exec',
                matchesRegex: {
                  'data.params.command': '[',
                },
              },
              action: 'missing-action',
            },
            {
              id: 'guard-2',
              when: { toolName: 'web_browse' },
            },
          ],
        },
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Hook bridge toolGuard.timeoutMs must be between 100 and 120000');
    expect(result.errors).toContain('Hook bridge toolGuard.onError must be allow or block');
    expect(result.errors).toContain('Hook bridge toolGuard.redaction.replacement cannot be empty');
    expect(result.errors).toContain('Hook bridge toolGuard.redaction.fields must be an array');
    expect(result.errors).toContain(
      'Hook bridge toolGuard rule 0: action "missing-action" is not registered',
    );
    expect(result.errors).toContain(
      'Hook bridge toolGuard rule 0: matchesRegex pattern at "data.params.command" is invalid',
    );
    expect(result.errors).toContain('Hook bridge toolGuard rule 1: action or decision is required');
  });

  it('should detect empty webhook URL', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      webhooks: [{ url: '' }],
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Webhook 0: URL is required');
  });

  it('should detect whitespace-only webhook URL', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      webhooks: [{ url: '   ' }],
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Webhook 0: URL is required');
  });

  it('should detect non-HTTP/HTTPS webhook URL', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      webhooks: [{ url: 'ftp://invalid.com' }],
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Webhook 0: Only HTTP and HTTPS protocols are allowed');
  });

  it('should detect invalid HTTP method', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      webhooks: [{ url: 'https://valid.com', method: 'GET' as never }],
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Webhook 0: Invalid HTTP method. Must be POST, PUT, or PATCH');
  });

  it('should detect invalid retry config', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      retry: { ...DEFAULT_CONFIG.retry, maxAttempts: 15 },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Retry maxAttempts must be between 0 and 10');
  });

  it('should detect invalid retry initialDelayMs', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      retry: { ...DEFAULT_CONFIG.retry, initialDelayMs: 50 },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Retry initialDelayMs must be between 100 and 10000');
  });

  it('should detect invalid retry maxDelayMs', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      retry: { ...DEFAULT_CONFIG.retry, maxDelayMs: 500000 },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Retry maxDelayMs must be between 1000 and 300000');
  });

  it('should detect invalid retry backoffMultiplier', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      retry: { ...DEFAULT_CONFIG.retry, backoffMultiplier: 0.5 },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Retry backoffMultiplier must be between 1 and 5');
  });

  it('should detect invalid queue config', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      queue: { ...DEFAULT_CONFIG.queue, maxSize: 5 },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Queue maxSize must be between 10 and 10000');
  });

  it('should detect invalid queue flushIntervalMs', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      queue: { ...DEFAULT_CONFIG.queue, flushIntervalMs: 50 },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Queue flushIntervalMs must be between 100 and 60000');
  });

  it('should detect invalid status config', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      status: { ...DEFAULT_CONFIG.status, workingWindowMs: 500 },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Status workingWindowMs must be between 1000 and 120000');
  });

  it('should detect sleeping window less than working window', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      status: {
        ...DEFAULT_CONFIG.status,
        workingWindowMs: 60000,
        sleepingWindowMs: 30000,
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Status sleepingWindowMs must be greater than workingWindowMs');
  });

  it('should detect invalid redaction replacement', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      redaction: {
        ...DEFAULT_CONFIG.redaction,
        replacement: '',
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Redaction replacement cannot be empty');
  });

  it('should detect invalid event log config', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      eventLog: {
        ...DEFAULT_CONFIG.eventLog,
        path: '',
        format: 'invalid' as 'full-json',
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Event log path cannot be empty');
    expect(result.errors).toContain('Event log format must be full-json or summary');
  });

  it('should detect invalid event log max file size', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      eventLog: {
        ...DEFAULT_CONFIG.eventLog,
        maxFileSizeMb: 0,
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Event log maxFileSizeMb must be between 1 and 1024');
  });

  it('should detect invalid security config', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      security: {
        ws: {
          ...DEFAULT_CONFIG.security.ws,
          bindAddress: '',
          requireAuth: true,
          authToken: '',
        },
        hmac: {
          ...DEFAULT_CONFIG.security.hmac,
          enabled: true,
          secret: '',
          secretFilePath: undefined,
          algorithm: 'bad' as 'sha256',
        },
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Security ws.bindAddress cannot be empty');
    expect(result.errors).toContain('Security ws.authToken is required when ws.requireAuth is true');
    expect(result.errors).toContain(
      'Security hmac.secret or hmac.secretFilePath is required when hmac.enabled is true',
    );
    expect(result.errors).toContain('Security hmac.algorithm must be sha256 or sha512');
  });

  it('should validate hook bridge action and rule references', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      hookBridge: {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: true,
        allowedActionDirs: ['relative/path'],
        actions: {
          badWebhook: {
            type: 'webhook',
            url: 'ftp://invalid-endpoint',
            timeoutMs: 10,
          },
          badScript: {
            type: 'local_script',
            path: 'relative-script.sh',
            args: ['ok', 1 as unknown as string],
            timeoutMs: 130000,
            maxPayloadBytes: 100,
          },
        },
        rules: [
          {
            id: 'test-rule',
            when: { eventType: 'tool.called' },
            action: 'missing-action',
          },
        ],
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Hook bridge allowedActionDirs[0] must be an absolute path');
    expect(result.errors).toContain(
      'Hook bridge action "badWebhook" webhook URL must use HTTP or HTTPS',
    );
    expect(result.errors).toContain(
      'Hook bridge action "badWebhook" timeoutMs must be between 100 and 120000',
    );
    expect(result.errors).toContain('Hook bridge action "badScript" script path must be absolute');
    expect(result.errors).toContain(
      'Hook bridge action "badScript" timeoutMs must be between 100 and 120000',
    );
    expect(result.errors).toContain(
      'Hook bridge action "badScript" maxPayloadBytes must be between 1024 and 1048576',
    );
    expect(result.errors).toContain(
      'Hook bridge action "badScript" args must be an array of strings',
    );
    expect(result.errors).toContain(
      'Hook bridge rule 0: action "missing-action" is not registered',
    );
  });

  it('should detect invalid timeout', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      webhookTimeoutMs: 500,
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Webhook timeout must be between 1000 and 60000 ms');
  });

  it('should detect empty correlation ID header', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      correlationIdHeader: '',
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Correlation ID header name cannot be empty');
  });
});
