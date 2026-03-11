import { PluginConfig } from './config-types';
import { DEFAULT_CONFIG } from './default-config';
import { parseEventTypes } from './event-types';
import { isTrue, loadSecretFromFile, parseCsv, parsePositiveInt } from './helpers';

/**
 * Load configuration from environment variables
 */
export function loadEnvConfig(): Partial<PluginConfig> {
  const config: Partial<PluginConfig> = {};

  // Webhook URLs from environment
  const webhookUrls = process.env.EVENT_PLUGIN_WEBHOOKS;
  if (webhookUrls) {
    config.webhooks = webhookUrls.split(',').map((url) => ({
      url: url.trim(),
      method: 'POST',
      includeFullPayload: true,
    }));
  }

  // Auth token
  const authToken = process.env.EVENT_PLUGIN_AUTH_TOKEN;
  if (authToken && config.webhooks) {
    config.webhooks = config.webhooks.map((webhook) => ({
      ...webhook,
      authToken,
    }));
  }

  // Debug logging
  const debug = process.env.EVENT_PLUGIN_DEBUG;
  if (debug) {
    config.logging = {
      ...DEFAULT_CONFIG.logging,
      debug: isTrue(debug),
    };
  }

  // Filter by event types
  const includeTypes = process.env.EVENT_PLUGIN_INCLUDE_TYPES;
  const excludeTypes = process.env.EVENT_PLUGIN_EXCLUDE_TYPES;
  if (includeTypes ?? excludeTypes) {
    config.filters = {
      ...DEFAULT_CONFIG.filters,
      includeTypes: includeTypes ? parseEventTypes(includeTypes) : [],
      excludeTypes: excludeTypes ? parseEventTypes(excludeTypes) : [],
    };
  }

  // Enabled flag
  const enabled = process.env.EVENT_PLUGIN_ENABLED;
  if (enabled !== undefined) {
    config.enabled = isTrue(enabled);
  }

  // Transport
  const transportMode = process.env.EVENT_PLUGIN_TRANSPORT_MODE;
  const transportLockPath = process.env.EVENT_PLUGIN_TRANSPORT_LOCK_PATH;
  const transportSocketPath = process.env.EVENT_PLUGIN_TRANSPORT_SOCKET_PATH;
  const transportLockStaleMs = parsePositiveInt(process.env.EVENT_PLUGIN_TRANSPORT_LOCK_STALE_MS);
  const transportHeartbeatMs = parsePositiveInt(process.env.EVENT_PLUGIN_TRANSPORT_HEARTBEAT_MS);
  const transportRelayTimeoutMs = parsePositiveInt(process.env.EVENT_PLUGIN_TRANSPORT_RELAY_TIMEOUT_MS);
  const transportReconnectBackoffMs = parsePositiveInt(
    process.env.EVENT_PLUGIN_TRANSPORT_RECONNECT_BACKOFF_MS,
  );
  const transportMaxPendingEvents = parsePositiveInt(process.env.EVENT_PLUGIN_TRANSPORT_MAX_PENDING_EVENTS);
  const transportMaxPayloadBytes = parsePositiveInt(process.env.EVENT_PLUGIN_TRANSPORT_MAX_PAYLOAD_BYTES);
  const transportAuthToken = process.env.EVENT_PLUGIN_TRANSPORT_AUTH_TOKEN;
  const transportDedupeTtlMs = parsePositiveInt(process.env.EVENT_PLUGIN_TRANSPORT_DEDUPE_TTL_MS);
  const transportSemanticDedupeEnabled = process.env.EVENT_PLUGIN_TRANSPORT_SEMANTIC_DEDUPE_ENABLED;
  if (
    transportMode ??
    transportLockPath ??
    transportSocketPath ??
    transportLockStaleMs ??
    transportHeartbeatMs ??
    transportRelayTimeoutMs ??
    transportReconnectBackoffMs ??
    transportMaxPendingEvents ??
    transportMaxPayloadBytes ??
    transportAuthToken ??
    transportDedupeTtlMs ??
    transportSemanticDedupeEnabled
  ) {
    config.transport = {
      ...DEFAULT_CONFIG.transport,
      ...(transportMode === 'auto' ||
      transportMode === 'owner' ||
      transportMode === 'follower'
        ? { mode: transportMode }
        : {}),
      ...(transportLockPath !== undefined ? { lockPath: transportLockPath } : {}),
      ...(transportSocketPath !== undefined ? { socketPath: transportSocketPath } : {}),
      ...(transportLockStaleMs !== undefined ? { lockStaleMs: transportLockStaleMs } : {}),
      ...(transportHeartbeatMs !== undefined ? { heartbeatMs: transportHeartbeatMs } : {}),
      ...(transportRelayTimeoutMs !== undefined ? { relayTimeoutMs: transportRelayTimeoutMs } : {}),
      ...(transportReconnectBackoffMs !== undefined
        ? { reconnectBackoffMs: transportReconnectBackoffMs }
        : {}),
      ...(transportMaxPendingEvents !== undefined ? { maxPendingEvents: transportMaxPendingEvents } : {}),
      ...(transportMaxPayloadBytes !== undefined ? { maxPayloadBytes: transportMaxPayloadBytes } : {}),
      ...(transportAuthToken !== undefined ? { authToken: transportAuthToken } : {}),
      ...(transportDedupeTtlMs !== undefined ? { dedupeTtlMs: transportDedupeTtlMs } : {}),
      ...(transportSemanticDedupeEnabled !== undefined
        ? { semanticDedupeEnabled: isTrue(transportSemanticDedupeEnabled) }
        : {}),
    };
  }

  // Synthetic status windows
  const workingWindowMs = parsePositiveInt(process.env.EVENT_PLUGIN_STATUS_WORKING_WINDOW_MS);
  const sleepingWindowMs = parsePositiveInt(process.env.EVENT_PLUGIN_STATUS_SLEEPING_WINDOW_MS);
  const tickIntervalMs = parsePositiveInt(process.env.EVENT_PLUGIN_STATUS_TICK_INTERVAL_MS);
  const subagentIdleWindowMs = parsePositiveInt(process.env.EVENT_PLUGIN_STATUS_SUBAGENT_IDLE_WINDOW_MS);
  if (workingWindowMs ?? sleepingWindowMs ?? tickIntervalMs ?? subagentIdleWindowMs) {
    config.status = {
      ...DEFAULT_CONFIG.status,
      ...(workingWindowMs !== undefined ? { workingWindowMs } : {}),
      ...(sleepingWindowMs !== undefined ? { sleepingWindowMs } : {}),
      ...(tickIntervalMs !== undefined ? { tickIntervalMs } : {}),
      ...(subagentIdleWindowMs !== undefined ? { subagentIdleWindowMs } : {}),
    };
  }

  // Payload redaction
  const redactionEnabled = process.env.EVENT_PLUGIN_REDACTION_ENABLED;
  const redactionReplacement = process.env.EVENT_PLUGIN_REDACTION_REPLACEMENT;
  const redactionFields = process.env.EVENT_PLUGIN_REDACTION_FIELDS;
  if (redactionEnabled ?? redactionReplacement ?? redactionFields) {
    config.redaction = {
      ...DEFAULT_CONFIG.redaction,
      ...(redactionEnabled !== undefined ? { enabled: isTrue(redactionEnabled) } : {}),
      ...(redactionReplacement !== undefined ? { replacement: redactionReplacement } : {}),
      ...(redactionFields !== undefined
        ? {
            fields: redactionFields
              .split(',')
              .map((value) => value.trim())
              .filter((value) => value.length > 0),
          }
        : {}),
    };
  }

  // Modern lifecycle payload privacy
  const modernLifecyclePayloadMode = process.env.EVENT_PLUGIN_MODERN_LIFECYCLE_PAYLOAD_MODE;
  if (modernLifecyclePayloadMode === 'metadata' || modernLifecyclePayloadMode === 'full') {
    config.privacy = {
      ...DEFAULT_CONFIG.privacy,
      payloadMode: modernLifecyclePayloadMode,
    };
  }

  // Event file logging
  const eventLogEnabled = process.env.EVENT_PLUGIN_EVENT_LOG_ENABLED;
  const eventLogPath = process.env.EVENT_PLUGIN_EVENT_LOG_PATH;
  const eventLogMaxFileMb = parsePositiveInt(process.env.EVENT_PLUGIN_EVENT_LOG_MAX_FILE_MB);
  const eventLogFormat = process.env.EVENT_PLUGIN_EVENT_LOG_FORMAT;
  const eventLogMinLevel = process.env.EVENT_PLUGIN_EVENT_LOG_MIN_LEVEL;
  const includeRuntimeLogs = process.env.EVENT_PLUGIN_EVENT_LOG_RUNTIME;
  if (
    eventLogEnabled ??
    eventLogPath ??
    eventLogMaxFileMb ??
    eventLogFormat ??
    eventLogMinLevel ??
    includeRuntimeLogs
  ) {
    config.eventLog = {
      ...DEFAULT_CONFIG.eventLog,
      ...(eventLogEnabled !== undefined ? { enabled: isTrue(eventLogEnabled) } : {}),
      ...(eventLogPath !== undefined ? { path: eventLogPath } : {}),
      ...(eventLogMaxFileMb !== undefined ? { maxFileSizeMb: eventLogMaxFileMb } : {}),
      ...(eventLogFormat === 'full-json' || eventLogFormat === 'summary' ? { format: eventLogFormat } : {}),
      ...(eventLogMinLevel === 'debug' ||
      eventLogMinLevel === 'info' ||
      eventLogMinLevel === 'warn' ||
      eventLogMinLevel === 'error'
        ? { minLevel: eventLogMinLevel }
        : {}),
      ...(includeRuntimeLogs !== undefined ? { includeRuntimeLogs: isTrue(includeRuntimeLogs) } : {}),
    };
  }

  // WS security
  const wsBindAddress = process.env.EVENT_PLUGIN_WS_BIND_ADDRESS;
  const wsRequireAuth = process.env.EVENT_PLUGIN_WS_REQUIRE_AUTH;
  const wsAuthToken = process.env.EVENT_PLUGIN_WS_AUTH_TOKEN;
  const wsAllowedOrigins = parseCsv(process.env.EVENT_PLUGIN_WS_ALLOWED_ORIGINS);
  const wsAllowedIps = parseCsv(process.env.EVENT_PLUGIN_WS_ALLOWED_IPS);
  if (wsBindAddress ?? wsRequireAuth ?? wsAuthToken ?? wsAllowedOrigins ?? wsAllowedIps) {
    config.security = {
      ...DEFAULT_CONFIG.security,
      ws: {
        ...DEFAULT_CONFIG.security.ws,
        ...(wsBindAddress !== undefined ? { bindAddress: wsBindAddress } : {}),
        ...(wsRequireAuth !== undefined ? { requireAuth: isTrue(wsRequireAuth) } : {}),
        ...(wsAuthToken !== undefined ? { authToken: wsAuthToken } : {}),
        ...(wsAllowedOrigins !== undefined ? { allowedOrigins: wsAllowedOrigins } : {}),
        ...(wsAllowedIps !== undefined ? { allowedIps: wsAllowedIps } : {}),
      },
      hmac: {
        ...DEFAULT_CONFIG.security.hmac,
      },
    };
  }

  // HMAC signing
  const hmacEnabled = process.env.EVENT_PLUGIN_HMAC_ENABLED;
  const hmacSecret = process.env.EVENT_PLUGIN_HMAC_SECRET;
  const hmacSecretFilePath = process.env.EVENT_PLUGIN_HMAC_SECRET_FILE;
  const hmacAlgorithm = process.env.EVENT_PLUGIN_HMAC_ALGORITHM;
  if (hmacEnabled ?? hmacSecret ?? hmacSecretFilePath ?? hmacAlgorithm) {
    const secretFromFile = loadSecretFromFile(hmacSecretFilePath);
    config.security = {
      ...(config.security ?? DEFAULT_CONFIG.security),
      ws: {
        ...(config.security?.ws ?? DEFAULT_CONFIG.security.ws),
      },
      hmac: {
        ...DEFAULT_CONFIG.security.hmac,
        ...(config.security?.hmac ?? {}),
        ...(hmacEnabled !== undefined ? { enabled: isTrue(hmacEnabled) } : {}),
        ...(hmacSecret !== undefined ? { secret: hmacSecret } : {}),
        ...(hmacSecretFilePath !== undefined ? { secretFilePath: hmacSecretFilePath } : {}),
        ...(hmacAlgorithm === 'sha256' || hmacAlgorithm === 'sha512' ? { algorithm: hmacAlgorithm } : {}),
        ...(secretFromFile !== undefined ? { secret: secretFromFile } : {}),
      },
    };
  }

  return config;
}
