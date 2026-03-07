/**
 * Unit tests for configuration merge behavior.
 */

import { DEFAULT_CONFIG, mergeConfig, PluginConfig } from '../../src/config';

describe('mergeConfig', () => {
  it('should merge configs with environment taking precedence', () => {
    const baseConfig: Partial<PluginConfig> = {
      enabled: true,
      webhooks: [{ url: 'https://base.com' }],
    };

    const envConfig: Partial<PluginConfig> = {
      webhooks: [{ url: 'https://env.com' }],
    };

    const merged = mergeConfig(baseConfig, envConfig);

    expect(merged.enabled).toBe(true);
    expect(merged.webhooks).toHaveLength(2);
    expect(merged.webhooks[0].url).toBe('https://base.com');
    expect(merged.webhooks[1].url).toBe('https://env.com');
  });

  it('should use defaults when no config provided', () => {
    const merged = mergeConfig({}, {});

    expect(merged.enabled).toBe(true);
    expect(merged.transport.mode).toBe('auto');
    expect(merged.retry.maxAttempts).toBe(3);
    expect(merged.status.workingWindowMs).toBe(DEFAULT_CONFIG.status.workingWindowMs);
    expect(merged.redaction.enabled).toBe(false);
    expect(merged.eventLog.format).toBe('full-json');
    expect(merged.security.ws.bindAddress).toBe('127.0.0.1');
    expect(merged.hookBridge.enabled).toBe(false);
    expect(merged.hookBridge.toolGuard.enabled).toBe(false);
    expect(merged.hookBridge.toolGuard.onError).toBe('allow');
  });

  it('should deep-merge hook bridge defaults', () => {
    const merged = mergeConfig(
      {
        hookBridge: {
          ...DEFAULT_CONFIG.hookBridge,
          enabled: true,
          actions: {
            base: {
              type: 'webhook',
              url: 'https://base.example.com',
            },
          },
          rules: [],
        },
      },
      {
        hookBridge: {
          ...DEFAULT_CONFIG.hookBridge,
          enabled: true,
          dryRun: true,
          actions: {
            env: {
              type: 'webhook',
              url: 'https://env.example.com',
            },
          },
          rules: [
            {
              id: 'env-rule',
              when: { eventType: 'tool.called' },
              action: 'env',
            },
          ],
        },
      },
    );

    expect(merged.hookBridge.enabled).toBe(true);
    expect(merged.hookBridge.dryRun).toBe(true);
    expect(merged.hookBridge.actions.base).toBeDefined();
    expect(merged.hookBridge.actions.env).toBeDefined();
    expect(merged.hookBridge.rules).toHaveLength(1);
    expect(merged.hookBridge.toolGuard.enabled).toBe(false);
    expect(merged.hookBridge.toolGuard.timeoutMs).toBe(DEFAULT_CONFIG.hookBridge.toolGuard.timeoutMs);
  });
});
