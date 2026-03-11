import { PluginConfig } from './config-types';
import { DEFAULT_CONFIG } from './default-config';

/**
 * Merge configurations with environment variables taking precedence
 */
export function mergeConfig(
  baseConfig: Partial<PluginConfig>,
  envConfig: Partial<PluginConfig>,
): PluginConfig {
  return {
    ...DEFAULT_CONFIG,
    ...baseConfig,
    ...envConfig,
    webhooks: [...(baseConfig.webhooks ?? []), ...(envConfig.webhooks ?? [])],
    filters: {
      ...DEFAULT_CONFIG.filters,
      ...(baseConfig.filters ?? {}),
      ...(envConfig.filters ?? {}),
    },
    retry: {
      ...DEFAULT_CONFIG.retry,
      ...(baseConfig.retry ?? {}),
      ...(envConfig.retry ?? {}),
    },
    queue: {
      ...DEFAULT_CONFIG.queue,
      ...(baseConfig.queue ?? {}),
      ...(envConfig.queue ?? {}),
    },
    transport: {
      ...DEFAULT_CONFIG.transport,
      ...(baseConfig.transport ?? {}),
      ...(envConfig.transport ?? {}),
    },
    logging: {
      ...DEFAULT_CONFIG.logging,
      ...(baseConfig.logging ?? {}),
      ...(envConfig.logging ?? {}),
    },
    status: {
      ...DEFAULT_CONFIG.status,
      ...(baseConfig.status ?? {}),
      ...(envConfig.status ?? {}),
    },
    redaction: {
      ...DEFAULT_CONFIG.redaction,
      ...(baseConfig.redaction ?? {}),
      ...(envConfig.redaction ?? {}),
    },
    privacy: {
      ...DEFAULT_CONFIG.privacy,
      ...(baseConfig.privacy ?? {}),
      ...(envConfig.privacy ?? {}),
    },
    eventLog: {
      ...DEFAULT_CONFIG.eventLog,
      ...(baseConfig.eventLog ?? {}),
      ...(envConfig.eventLog ?? {}),
    },
    security: {
      ...DEFAULT_CONFIG.security,
      ...(baseConfig.security ?? {}),
      ...(envConfig.security ?? {}),
      ws: {
        ...DEFAULT_CONFIG.security.ws,
        ...(baseConfig.security?.ws ?? {}),
        ...(envConfig.security?.ws ?? {}),
      },
      hmac: {
        ...DEFAULT_CONFIG.security.hmac,
        ...(baseConfig.security?.hmac ?? {}),
        ...(envConfig.security?.hmac ?? {}),
      },
    },
    hookBridge: {
      ...DEFAULT_CONFIG.hookBridge,
      ...(baseConfig.hookBridge ?? {}),
      ...(envConfig.hookBridge ?? {}),
      localScriptDefaults: {
        ...DEFAULT_CONFIG.hookBridge.localScriptDefaults,
        ...(baseConfig.hookBridge?.localScriptDefaults ?? {}),
        ...(envConfig.hookBridge?.localScriptDefaults ?? {}),
      },
      actions: {
        ...DEFAULT_CONFIG.hookBridge.actions,
        ...(baseConfig.hookBridge?.actions ?? {}),
        ...(envConfig.hookBridge?.actions ?? {}),
      },
      runtime: {
        ...DEFAULT_CONFIG.hookBridge.runtime,
        ...(baseConfig.hookBridge?.runtime ?? {}),
        ...(envConfig.hookBridge?.runtime ?? {}),
      },
      telemetry: {
        ...DEFAULT_CONFIG.hookBridge.telemetry,
        ...(baseConfig.hookBridge?.telemetry ?? {}),
        ...(envConfig.hookBridge?.telemetry ?? {}),
      },
      rules: envConfig.hookBridge?.rules ?? baseConfig.hookBridge?.rules ?? DEFAULT_CONFIG.hookBridge.rules,
      toolGuard: {
        ...DEFAULT_CONFIG.hookBridge.toolGuard,
        ...(baseConfig.hookBridge?.toolGuard ?? {}),
        ...(envConfig.hookBridge?.toolGuard ?? {}),
        redaction: {
          ...DEFAULT_CONFIG.hookBridge.toolGuard.redaction,
          ...(baseConfig.hookBridge?.toolGuard?.redaction ?? {}),
          ...(envConfig.hookBridge?.toolGuard?.redaction ?? {}),
        },
        rules:
          envConfig.hookBridge?.toolGuard?.rules ??
          baseConfig.hookBridge?.toolGuard?.rules ??
          DEFAULT_CONFIG.hookBridge.toolGuard.rules,
      },
      allowedActionDirs:
        envConfig.hookBridge?.allowedActionDirs ??
        baseConfig.hookBridge?.allowedActionDirs ??
        DEFAULT_CONFIG.hookBridge.allowedActionDirs,
    },
  };
}
