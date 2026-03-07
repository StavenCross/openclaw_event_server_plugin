import { DEFAULT_CONFIG, PluginConfig, validateConfig } from '../../src/config';

describe('hook bridge config validation coverage', () => {
  it('rejects invalid hook bridge runtime, telemetry, coalescing, and matcher settings', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      hookBridge: {
        ...DEFAULT_CONFIG.hookBridge,
        enabled: true,
        localScriptDefaults: {
          timeoutMs: 500,
          maxPayloadBytes: 512,
        },
        runtime: {
          maxPendingEvents: 0,
          concurrency: 0,
          dropPolicy: 'drop_latest' as unknown as 'drop_oldest' | 'drop_newest',
        },
        telemetry: {
          highWatermarks: [0, 101],
          slowActionMs: 0,
          failureRateWindowMs: 999,
          failureRateThresholdPct: 101,
          failureRateMinSamples: 0,
          saturationWindowMs: 50,
        },
        actions: {
          notify: {
            type: 'webhook',
            url: 'https://example.com/hook',
          },
        },
        rules: [
          {
            id: '',
            when: {
              idleForMsGte: -1,
              requiredPaths: [''],
              typeChecks: {
                'data.params.url': 'map' as unknown as 'string',
              },
              inList: {
                'data.params.mode': [],
              },
              notInList: {
                'data.params.mode': [],
              },
              domainAllowlist: [''],
              domainBlocklist: [''],
            },
            action: '',
            cooldownMs: -1,
            coalesce: {
              enabled: true,
              windowMs: 0,
              strategy: 'oldest' as unknown as 'first' | 'latest',
              keyFields: [''],
            },
          },
        ],
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Hook bridge localScriptDefaults.timeoutMs must be at least 1000');
    expect(result.errors).toContain('Hook bridge localScriptDefaults.maxPayloadBytes must be at least 1024');
    expect(result.errors).toContain('Hook bridge runtime.maxPendingEvents must be between 1 and 100000');
    expect(result.errors).toContain('Hook bridge runtime.concurrency must be between 1 and 1024');
    expect(result.errors).toContain('Hook bridge runtime.dropPolicy must be drop_oldest or drop_newest');
    expect(result.errors).toContain('Hook bridge telemetry.slowActionMs must be between 1 and 600000');
    expect(result.errors).toContain(
      'Hook bridge telemetry.failureRateWindowMs must be between 1000 and 3600000',
    );
    expect(result.errors).toContain(
      'Hook bridge telemetry.failureRateThresholdPct must be between 0 and 100',
    );
    expect(result.errors).toContain(
      'Hook bridge telemetry.failureRateMinSamples must be between 1 and 100000',
    );
    expect(result.errors).toContain(
      'Hook bridge telemetry.saturationWindowMs must be between 100 and 3600000',
    );
    expect(result.errors).toContain(
      'Hook bridge telemetry.highWatermarks values must be integers between 1 and 100',
    );
    expect(result.errors).toContain('Hook bridge rule 0: id is required');
    expect(result.errors).toContain('Hook bridge rule 0: action is required');
    expect(result.errors).toContain('Hook bridge rule 0: cooldownMs must be >= 0');
    expect(result.errors).toContain('Hook bridge rule 0: coalesce.windowMs must be >= 1');
    expect(result.errors).toContain('Hook bridge rule 0: coalesce.strategy must be first or latest');
    expect(result.errors).toContain('Hook bridge rule 0: coalesce.keyFields must be non-empty strings');
    expect(result.errors).toContain('Hook bridge rule 0: idleForMsGte must be >= 0');
    expect(result.errors).toContain('Hook bridge rule 0: requiredPaths must be non-empty strings');
    expect(result.errors).toContain(
      'Hook bridge rule 0: typeChecks at "data.params.url" must be string|number|boolean|object|array',
    );
    expect(result.errors).toContain('Hook bridge rule 0: inList at "data.params.mode" must be a non-empty array');
    expect(result.errors).toContain(
      'Hook bridge rule 0: notInList at "data.params.mode" must be a non-empty array',
    );
    expect(result.errors).toContain('Hook bridge rule 0: domainAllowlist must be non-empty strings');
    expect(result.errors).toContain('Hook bridge rule 0: domainBlocklist must be non-empty strings');
  });

  it('rejects invalid tool guard scope, timing, and matcher settings', () => {
    const config: PluginConfig = {
      ...DEFAULT_CONFIG,
      hookBridge: {
        ...DEFAULT_CONFIG.hookBridge,
        toolGuard: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard,
          enabled: true,
          scopeKeyBy: 'session' as unknown as 'tool' | 'tool_and_params',
          retryBackoffMs: -1,
          approvalCacheTtlMs: 86400001,
          rules: [
            {
              id: '',
              priority: 1.5,
              cooldownMs: -1,
              when: {
                notMatchesRegex: {
                  'data.params.command': '[',
                },
              },
            },
          ],
        },
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Hook bridge toolGuard.scopeKeyBy must be tool or tool_and_params');
    expect(result.errors).toContain('Hook bridge toolGuard.retryBackoffMs must be between 0 and 3600000');
    expect(result.errors).toContain(
      'Hook bridge toolGuard.approvalCacheTtlMs must be between 0 and 86400000',
    );
    expect(result.errors).toContain('Hook bridge toolGuard rule 0: id is required');
    expect(result.errors).toContain('Hook bridge toolGuard rule 0: priority must be an integer');
    expect(result.errors).toContain('Hook bridge toolGuard rule 0: action or decision is required');
    expect(result.errors).toContain('Hook bridge toolGuard rule 0: cooldownMs must be >= 0');
    expect(result.errors).toContain(
      'Hook bridge toolGuard rule 0: notMatchesRegex pattern at "data.params.command" is invalid',
    );
  });
});
