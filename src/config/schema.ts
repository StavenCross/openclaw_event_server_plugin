import { DEFAULT_CONFIG } from './default-config';
import { VALID_EVENT_TYPES } from './event-types';
import { HOOK_BRIDGE_SCHEMA } from './schema-hook-bridge';

/**
 * JSON Schema for plugin configuration validation
 */
export const CONFIG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: {
      type: 'boolean',
      description: 'Enable/disable the plugin',
      default: true,
    },
    transport: {
      type: 'object',
      description: 'Single-owner transport coordination and relay configuration',
      properties: {
        mode: {
          type: 'string',
          enum: ['auto', 'owner', 'follower'],
          description: 'Select automatic owner election or force owner/follower transport behavior',
          default: DEFAULT_CONFIG.transport.mode,
        },
        lockPath: {
          type: 'string',
          default: DEFAULT_CONFIG.transport.lockPath,
        },
        socketPath: {
          type: 'string',
          default: DEFAULT_CONFIG.transport.socketPath,
        },
        lockStaleMs: {
          type: 'integer',
          minimum: 1000,
          maximum: 300000,
          default: DEFAULT_CONFIG.transport.lockStaleMs,
        },
        heartbeatMs: {
          type: 'integer',
          minimum: 250,
          maximum: 60000,
          default: DEFAULT_CONFIG.transport.heartbeatMs,
        },
        relayTimeoutMs: {
          type: 'integer',
          minimum: 100,
          maximum: 60000,
          default: DEFAULT_CONFIG.transport.relayTimeoutMs,
        },
        reconnectBackoffMs: {
          type: 'integer',
          minimum: 50,
          maximum: 30000,
          default: DEFAULT_CONFIG.transport.reconnectBackoffMs,
        },
        maxPendingEvents: {
          type: 'integer',
          minimum: 1,
          maximum: 100000,
          default: DEFAULT_CONFIG.transport.maxPendingEvents,
        },
        maxPayloadBytes: {
          type: 'integer',
          minimum: 1024,
          maximum: 10485760,
          default: DEFAULT_CONFIG.transport.maxPayloadBytes,
        },
        authToken: {
          type: 'string',
          description: 'Optional auth token required for follower relay connections',
        },
        dedupeTtlMs: {
          type: 'integer',
          minimum: 1000,
          maximum: 600000,
          default: DEFAULT_CONFIG.transport.dedupeTtlMs,
        },
        semanticDedupeEnabled: {
          type: 'boolean',
          default: DEFAULT_CONFIG.transport.semanticDedupeEnabled,
          description: 'Apply semantic dedupe in addition to eventId retry dedupe',
        },
      },
    },
    webhooks: {
      type: 'array',
      description: 'Webhook endpoints to broadcast events to',
      items: {
        type: 'object',
        required: ['url'],
        properties: {
          url: {
            type: 'string',
            description: 'Webhook URL endpoint',
          },
          method: {
            type: 'string',
            enum: ['POST', 'PUT', 'PATCH'],
            default: 'POST',
            description: 'HTTP method for webhook requests',
          },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Custom HTTP headers',
          },
          authToken: {
            type: 'string',
            description: 'Authentication token (Bearer)',
          },
          includeFullPayload: {
            type: 'boolean',
            default: true,
            description: 'Include full event payload',
          },
        },
      },
      default: [],
    },
    filters: {
      type: 'object',
      description: 'Event filtering configuration',
      properties: {
        includeTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: VALID_EVENT_TYPES,
          },
          description: 'Event types to include (empty = all)',
        },
        excludeTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: VALID_EVENT_TYPES,
          },
          description: 'Event types to exclude',
        },
        channelId: {
          type: 'string',
          description: 'Filter by channel ID',
        },
        toolName: {
          type: 'string',
          description: 'Filter by tool name',
        },
        sessionId: {
          type: 'string',
          description: 'Filter by session ID',
        },
      },
    },
    retry: {
      type: 'object',
      description: 'Retry configuration for failed webhooks',
      properties: {
        maxAttempts: {
          type: 'integer',
          minimum: 0,
          maximum: 10,
          default: 3,
        },
        initialDelayMs: {
          type: 'integer',
          minimum: 100,
          maximum: 10000,
          default: 1000,
        },
        maxDelayMs: {
          type: 'integer',
          minimum: 1000,
          maximum: 300000,
          default: 30000,
        },
        backoffMultiplier: {
          type: 'number',
          minimum: 1,
          maximum: 5,
          default: 2,
        },
      },
    },
    queue: {
      type: 'object',
      description: 'Event queue configuration',
      properties: {
        maxSize: {
          type: 'integer',
          minimum: 10,
          maximum: 10000,
          default: 1000,
        },
        flushIntervalMs: {
          type: 'integer',
          minimum: 100,
          maximum: 60000,
          default: 5000,
        },
        persistToDisk: {
          type: 'boolean',
          default: false,
        },
        persistPath: {
          type: 'string',
          description: 'Path for queue persistence',
        },
      },
    },
    logging: {
      type: 'object',
      description: 'Logging configuration',
      properties: {
        debug: {
          type: 'boolean',
          default: false,
        },
        logSuccess: {
          type: 'boolean',
          default: false,
        },
        logErrors: {
          type: 'boolean',
          default: true,
        },
        logQueue: {
          type: 'boolean',
          default: false,
        },
      },
    },
    status: {
      type: 'object',
      description: 'Synthetic status reducer windows and ticker interval',
      properties: {
        workingWindowMs: {
          type: 'integer',
          minimum: 1000,
          maximum: 120000,
          default: 30000,
          description: 'Events newer than this are considered working',
        },
        sleepingWindowMs: {
          type: 'integer',
          minimum: 10000,
          maximum: 86400000,
          default: 600000,
          description: 'Events older than this are considered sleeping',
        },
        tickIntervalMs: {
          type: 'integer',
          minimum: 1000,
          maximum: 60000,
          default: 5000,
          description: 'Interval for synthetic status transition checks',
        },
        subagentIdleWindowMs: {
          type: 'integer',
          minimum: 10000,
          maximum: 86400000,
          default: 300000,
          description: 'Subagent idle threshold for synthetic subagent.idle events',
        },
      },
    },
    redaction: {
      type: 'object',
      description: 'Optional payload redaction before transport',
      properties: {
        enabled: {
          type: 'boolean',
          default: false,
        },
        replacement: {
          type: 'string',
          default: '[REDACTED]',
        },
        fields: {
          type: 'array',
          items: {
            type: 'string',
          },
          default: DEFAULT_CONFIG.redaction.fields,
        },
      },
    },
    eventLog: {
      type: 'object',
      description: 'Event and runtime log file output',
      properties: {
        enabled: {
          type: 'boolean',
          default: true,
        },
        path: {
          type: 'string',
          description: 'NDJSON log file path',
          default: '.event-server/events.ndjson',
        },
        maxFileSizeMb: {
          type: 'integer',
          minimum: 1,
          maximum: 1024,
          default: 30,
          description: 'Maximum NDJSON log file size before truncation rollover (MB)',
        },
        format: {
          type: 'string',
          enum: ['full-json', 'summary'],
          default: 'full-json',
        },
        minLevel: {
          type: 'string',
          enum: ['debug', 'info', 'warn', 'error'],
          default: 'debug',
        },
        includeRuntimeLogs: {
          type: 'boolean',
          default: true,
        },
      },
    },
    security: {
      type: 'object',
      description: 'WebSocket and event signing security options',
      properties: {
        ws: {
          type: 'object',
          properties: {
            bindAddress: {
              type: 'string',
              default: '127.0.0.1',
            },
            requireAuth: {
              type: 'boolean',
              default: false,
            },
            authToken: {
              type: 'string',
            },
            allowedOrigins: {
              type: 'array',
              items: { type: 'string' },
              default: [],
            },
            allowedIps: {
              type: 'array',
              items: { type: 'string' },
              default: [],
            },
          },
        },
        hmac: {
          type: 'object',
          properties: {
            enabled: {
              type: 'boolean',
              default: false,
            },
            secret: {
              type: 'string',
            },
            secretFilePath: {
              type: 'string',
              default: '.event-plugin-hmac.secret',
            },
            algorithm: {
              type: 'string',
              enum: ['sha256', 'sha512'],
              default: 'sha256',
            },
          },
        },
      },
    },
    correlationIdHeader: {
      type: 'string',
      default: 'X-Correlation-ID',
    },
    webhookTimeoutMs: {
      type: 'integer',
      minimum: 1000,
      maximum: 60000,
      default: 10000,
    },
    hookBridge: HOOK_BRIDGE_SCHEMA,
  },
};
