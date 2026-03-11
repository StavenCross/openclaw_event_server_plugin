import { PluginConfig } from './config-types';
import { isEventType } from './event-types';
import { loadSecretFromFile } from './helpers';
import { resolveRuntimePath, resolveTransportSocketPath } from './runtime-paths';
import { validateHookBridgeConfig } from './validate-hook-bridge';

/**
 * Validate configuration
 */
export function validateConfig(config: PluginConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate webhooks
  if (!['auto', 'owner', 'follower'].includes(config.transport.mode)) {
    errors.push('Transport mode must be auto, owner, or follower');
  }
  if (!config.transport.lockPath || config.transport.lockPath.trim() === '') {
    errors.push('Transport lockPath cannot be empty');
  }
  if (!config.transport.socketPath || config.transport.socketPath.trim() === '') {
    errors.push('Transport socketPath cannot be empty');
  }
  if (config.transport.lockStaleMs < 1000) {
    errors.push('Transport lockStaleMs must be at least 1000');
  }
  if (config.transport.heartbeatMs < 250) {
    errors.push('Transport heartbeatMs must be at least 250');
  }
  if (config.transport.heartbeatMs >= config.transport.lockStaleMs) {
    errors.push('Transport heartbeatMs must be less than lockStaleMs');
  }
  if (config.transport.relayTimeoutMs < 100) {
    errors.push('Transport relayTimeoutMs must be at least 100');
  }
  if (config.transport.reconnectBackoffMs < 50) {
    errors.push('Transport reconnectBackoffMs must be at least 50');
  }
  if (config.transport.maxPendingEvents < 1) {
    errors.push('Transport maxPendingEvents must be at least 1');
  }
  if (config.transport.maxPayloadBytes < 1024) {
    errors.push('Transport maxPayloadBytes must be at least 1024');
  }
  if (config.transport.dedupeTtlMs < 1000) {
    errors.push('Transport dedupeTtlMs must be at least 1000');
  }

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

  if (!['metadata', 'full'].includes(config.privacy.payloadMode)) {
    errors.push('Privacy payloadMode must be metadata or full');
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
  const resolvedSecret =
    config.security.hmac.secret ?? loadSecretFromFile(config.security.hmac.secretFilePath);

  return {
    ...config,
    queue: {
      ...config.queue,
      ...(config.queue.persistPath ? { persistPath: resolveRuntimePath(config.queue.persistPath) } : {}),
    },
    transport: {
      ...config.transport,
      lockPath: resolveRuntimePath(config.transport.lockPath),
      socketPath: resolveTransportSocketPath(config.transport.socketPath),
    },
    eventLog: {
      ...config.eventLog,
      path: resolveRuntimePath(config.eventLog.path),
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
