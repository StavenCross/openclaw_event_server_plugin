import { PluginConfig } from './config-types';
import { isEventType } from './event-types';
import { loadSecretFromFile } from './helpers';
import { validateHookBridgeConfig } from './validate-hook-bridge';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * Validate configuration
 */
export function validateConfig(config: PluginConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate webhooks
  if (config.webhooks && config.webhooks.length > 0) {
    config.webhooks.forEach((webhook, index) => {
      if (!webhook.url || webhook.url.trim() === '') {
        errors.push(`Webhook ${index}: URL is required`);
      } else {
        try {
          const parsedUrl = new URL(webhook.url);
          // Only allow http and https protocols for security
          if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            errors.push(`Webhook ${index}: Only HTTP and HTTPS protocols are allowed`);
          }
        } catch {
          errors.push(`Webhook ${index}: Invalid URL format`);
        }
      }

      // Validate HTTP method if specified
      if (webhook.method && !['POST', 'PUT', 'PATCH'].includes(webhook.method)) {
        errors.push(`Webhook ${index}: Invalid HTTP method. Must be POST, PUT, or PATCH`);
      }
    });
  }

  // Validate retry config
  if (config.retry.maxAttempts < 0 || config.retry.maxAttempts > 10) {
    errors.push('Retry maxAttempts must be between 0 and 10');
  }
  if (config.retry.initialDelayMs < 100 || config.retry.initialDelayMs > 10000) {
    errors.push('Retry initialDelayMs must be between 100 and 10000');
  }
  if (config.retry.maxDelayMs < 1000 || config.retry.maxDelayMs > 300000) {
    errors.push('Retry maxDelayMs must be between 1000 and 300000');
  }
  if (config.retry.backoffMultiplier < 1 || config.retry.backoffMultiplier > 5) {
    errors.push('Retry backoffMultiplier must be between 1 and 5');
  }

  // Validate queue config
  if (config.queue.maxSize < 10 || config.queue.maxSize > 10000) {
    errors.push('Queue maxSize must be between 10 and 10000');
  }
  if (config.queue.flushIntervalMs < 100 || config.queue.flushIntervalMs > 60000) {
    errors.push('Queue flushIntervalMs must be between 100 and 60000');
  }

  // Validate synthetic status config
  if (config.status.workingWindowMs < 1000 || config.status.workingWindowMs > 120000) {
    errors.push('Status workingWindowMs must be between 1000 and 120000');
  }
  if (config.status.sleepingWindowMs < 10000 || config.status.sleepingWindowMs > 86400000) {
    errors.push('Status sleepingWindowMs must be between 10000 and 86400000');
  }
  if (config.status.sleepingWindowMs <= config.status.workingWindowMs) {
    errors.push('Status sleepingWindowMs must be greater than workingWindowMs');
  }
  if (config.status.tickIntervalMs < 1000 || config.status.tickIntervalMs > 60000) {
    errors.push('Status tickIntervalMs must be between 1000 and 60000');
  }
  if (config.status.subagentIdleWindowMs < 10000 || config.status.subagentIdleWindowMs > 86400000) {
    errors.push('Status subagentIdleWindowMs must be between 10000 and 86400000');
  }

  // Validate redaction config
  if (!config.redaction.replacement || config.redaction.replacement.trim() === '') {
    errors.push('Redaction replacement cannot be empty');
  }
  if (!Array.isArray(config.redaction.fields)) {
    errors.push('Redaction fields must be an array');
  } else if (config.redaction.fields.some((field) => field.trim() === '')) {
    errors.push('Redaction fields cannot contain empty values');
  }

  // Validate event log config
  if (!config.eventLog.path || config.eventLog.path.trim() === '') {
    errors.push('Event log path cannot be empty');
  }
  if (!['full-json', 'summary'].includes(config.eventLog.format)) {
    errors.push('Event log format must be full-json or summary');
  }
  if (!['debug', 'info', 'warn', 'error'].includes(config.eventLog.minLevel)) {
    errors.push('Event log minLevel must be debug, info, warn, or error');
  }
  if (config.eventLog.maxFileSizeMb < 1 || config.eventLog.maxFileSizeMb > 1024) {
    errors.push('Event log maxFileSizeMb must be between 1 and 1024');
  }

  // Validate WS security config
  if (!config.security.ws.bindAddress || config.security.ws.bindAddress.trim() === '') {
    errors.push('Security ws.bindAddress cannot be empty');
  }
  if (config.security.ws.requireAuth && (!config.security.ws.authToken || config.security.ws.authToken.trim() === '')) {
    errors.push('Security ws.authToken is required when ws.requireAuth is true');
  }

  // Validate HMAC config
  if (config.security.hmac.enabled && (!config.security.hmac.secret || config.security.hmac.secret.trim() === '')) {
    const secretFromFile = loadSecretFromFile(config.security.hmac.secretFilePath);
    if (!secretFromFile) {
      errors.push('Security hmac.secret or hmac.secretFilePath is required when hmac.enabled is true');
    }
  }
  if (!['sha256', 'sha512'].includes(config.security.hmac.algorithm)) {
    errors.push('Security hmac.algorithm must be sha256 or sha512');
  }

  // Validate timeout
  if (config.webhookTimeoutMs < 1000 || config.webhookTimeoutMs > 60000) {
    errors.push('Webhook timeout must be between 1000 and 60000 ms');
  }

  // Validate correlation ID header name
  if (!config.correlationIdHeader || config.correlationIdHeader.trim() === '') {
    errors.push('Correlation ID header name cannot be empty');
  }

  validateHookBridgeConfig(config, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Resolve runtime-only config values (for example, loading HMAC secret from file).
 */
export function resolveRuntimeConfig(config: PluginConfig): PluginConfig {
  const resolveEventLogPath = (rawPath: string): string => {
    const trimmedPath = rawPath.trim();
    if (trimmedPath === '' || isAbsolute(trimmedPath)) {
      return rawPath;
    }

    const stateDir = process.env.OPENCLAW_STATE_DIR?.trim();
    if (stateDir) {
      return resolve(stateDir, trimmedPath);
    }

    const configPath = process.env.OPENCLAW_CONFIG_PATH?.trim();
    if (configPath) {
      return resolve(dirname(configPath), trimmedPath);
    }

    return resolve(homedir(), '.openclaw', trimmedPath);
  };

  const resolvedSecret =
    config.security.hmac.secret ?? loadSecretFromFile(config.security.hmac.secretFilePath);

  return {
    ...config,
    eventLog: {
      ...config.eventLog,
      path: resolveEventLogPath(config.eventLog.path),
    },
    security: {
      ...config.security,
      hmac: {
        ...config.security.hmac,
        ...(resolvedSecret ? { secret: resolvedSecret } : {}),
      },
    },
  };
}

/**
 * Check if an event should be filtered out
 */
export function shouldFilterEvent(
  config: PluginConfig,
  eventType: string,
  channelId?: string,
  toolName?: string,
  sessionId?: string,
): boolean {
  const { filters } = config;

  // Check exclude types first
  if (isEventType(eventType) && filters.excludeTypes?.includes(eventType)) {
    return true;
  }

  // Check include types (if specified, only these are allowed)
  if (filters.includeTypes?.length) {
    if (!isEventType(eventType) || !filters.includeTypes.includes(eventType)) {
      return true;
    }
  }

  // Check channel filter
  if (filters.channelId && filters.channelId !== channelId) {
    return true;
  }

  // Check tool name filter
  if (filters.toolName && filters.toolName !== toolName) {
    return true;
  }

  // Check session filter
  if (filters.sessionId && filters.sessionId !== sessionId) {
    return true;
  }

  return false;
}
