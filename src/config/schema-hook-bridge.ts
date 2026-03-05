export const HOOK_BRIDGE_SCHEMA = {
  type: 'object',
  description: 'Optional event-driven automation bridge',
  properties: {
    enabled: {
      type: 'boolean',
      default: false,
    },
    dryRun: {
      type: 'boolean',
      default: false,
    },
    allowedActionDirs: {
      type: 'array',
      items: { type: 'string' },
      default: [],
    },
    localScriptDefaults: {
      type: 'object',
      properties: {
        timeoutMs: {
          type: 'integer',
          minimum: 1000,
          maximum: 120000,
          default: 10000,
        },
        maxPayloadBytes: {
          type: 'integer',
          minimum: 1024,
          maximum: 1048576,
          default: 65536,
        },
      },
    },
    actions: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['webhook', 'local_script'],
          },
          url: {
            type: 'string',
          },
          method: {
            type: 'string',
            enum: ['POST', 'PUT', 'PATCH'],
          },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
          authToken: {
            type: 'string',
          },
          path: {
            type: 'string',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
          },
          timeoutMs: {
            type: 'integer',
          },
          maxPayloadBytes: {
            type: 'integer',
          },
        },
        required: ['type'],
      },
      default: {},
    },
    rules: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          enabled: { type: 'boolean' },
          action: { type: 'string' },
          cooldownMs: { type: 'integer', minimum: 0 },
          coalesce: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              keyFields: {
                type: 'array',
                items: { type: 'string' },
              },
              windowMs: { type: 'number', minimum: 1 },
              strategy: {
                type: 'string',
                enum: ['first', 'latest'],
              },
            },
          },
          when: {
            type: 'object',
            properties: {
              eventType: {
                oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
              },
              toolName: {
                oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
              },
              agentId: {
                oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
              },
              sessionId: {
                oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
              },
              sessionKey: {
                oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
              },
              contains: {
                type: 'object',
                additionalProperties: { type: 'string' },
              },
              equals: {
                type: 'object',
                additionalProperties: {
                  oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
                },
              },
              requiredPaths: {
                type: 'array',
                items: { type: 'string' },
              },
              typeChecks: {
                type: 'object',
                additionalProperties: {
                  type: 'string',
                  enum: ['string', 'number', 'boolean', 'object', 'array'],
                },
              },
              inList: {
                type: 'object',
                additionalProperties: {
                  type: 'array',
                  items: {
                    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
                  },
                },
              },
              notInList: {
                type: 'object',
                additionalProperties: {
                  type: 'array',
                  items: {
                    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
                  },
                },
              },
              matchesRegex: {
                type: 'object',
                additionalProperties: { type: 'string' },
              },
              notMatchesRegex: {
                type: 'object',
                additionalProperties: { type: 'string' },
              },
              domainAllowlist: {
                type: 'array',
                items: { type: 'string' },
              },
              domainBlocklist: {
                type: 'array',
                items: { type: 'string' },
              },
              domainPath: {
                type: 'string',
              },
              idleForMsGte: {
                type: 'number',
                minimum: 0,
              },
              parentStatus: {
                type: 'string',
              },
            },
          },
        },
        required: ['id', 'when', 'action'],
      },
    },
    toolGuard: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          default: false,
        },
        dryRun: {
          type: 'boolean',
          default: false,
        },
        timeoutMs: {
          type: 'integer',
          minimum: 100,
          maximum: 120000,
          default: 15000,
        },
        onError: {
          type: 'string',
          enum: ['allow', 'block'],
          default: 'allow',
        },
        scopeKeyBy: {
          type: 'string',
          enum: ['tool', 'tool_and_params'],
          default: 'tool_and_params',
        },
        retryBackoffMs: {
          type: 'integer',
          minimum: 0,
          maximum: 3600000,
          default: 10000,
        },
        retryBackoffReason: {
          type: 'string',
        },
        approvalCacheTtlMs: {
          type: 'integer',
          minimum: 0,
          maximum: 86400000,
          default: 60000,
        },
        stopOnMatchDefault: {
          type: 'boolean',
          default: false,
        },
        redaction: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', default: false },
            replacement: { type: 'string', default: '[REDACTED]' },
            fields: { type: 'array', items: { type: 'string' } },
          },
        },
        rules: {
          type: 'array',
          default: [],
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              enabled: { type: 'boolean' },
              priority: { type: 'integer' },
              action: { type: 'string' },
              decision: {
                type: 'object',
                properties: {
                  block: { type: 'boolean' },
                  blockReason: { type: 'string' },
                  blockReasonTemplate: { type: 'string' },
                  params: { type: 'object' },
                },
              },
              stopOnMatch: { type: 'boolean' },
              cooldownMs: { type: 'integer', minimum: 0 },
              when: {
                type: 'object',
                properties: {
                  eventType: {
                    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                  },
                  toolName: {
                    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                  },
                  agentId: {
                    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                  },
                  sessionId: {
                    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                  },
                  sessionKey: {
                    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                  },
                  contains: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                  },
                  equals: {
                    type: 'object',
                    additionalProperties: {
                      oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
                    },
                  },
                  requiredPaths: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  typeChecks: {
                    type: 'object',
                    additionalProperties: {
                      type: 'string',
                      enum: ['string', 'number', 'boolean', 'object', 'array'],
                    },
                  },
                  inList: {
                    type: 'object',
                    additionalProperties: {
                      type: 'array',
                      items: {
                        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
                      },
                    },
                  },
                  notInList: {
                    type: 'object',
                    additionalProperties: {
                      type: 'array',
                      items: {
                        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
                      },
                    },
                  },
                  matchesRegex: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                  },
                  notMatchesRegex: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                  },
                  domainAllowlist: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  domainBlocklist: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  domainPath: {
                    type: 'string',
                  },
                  idleForMsGte: {
                    type: 'number',
                    minimum: 0,
                  },
                  parentStatus: {
                    type: 'string',
                  },
                },
              },
            },
            required: ['id', 'when'],
          },
        },
      },
    },
    runtime: {
      type: 'object',
      properties: {
        maxPendingEvents: {
          type: 'integer',
          minimum: 1,
          maximum: 100000,
          default: 1000,
        },
        concurrency: {
          type: 'integer',
          minimum: 1,
          maximum: 1024,
          default: 8,
        },
        dropPolicy: {
          type: 'string',
          enum: ['drop_oldest', 'drop_newest'],
          default: 'drop_oldest',
        },
      },
    },
    telemetry: {
      type: 'object',
      properties: {
        highWatermarks: {
          type: 'array',
          items: { type: 'integer', minimum: 1, maximum: 100 },
          default: [70, 90, 100],
        },
        slowActionMs: {
          type: 'integer',
          minimum: 1,
          maximum: 600000,
          default: 2000,
        },
        failureRateWindowMs: {
          type: 'integer',
          minimum: 1000,
          maximum: 3600000,
          default: 60000,
        },
        failureRateThresholdPct: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          default: 20,
        },
        failureRateMinSamples: {
          type: 'integer',
          minimum: 1,
          maximum: 100000,
          default: 10,
        },
        saturationWindowMs: {
          type: 'integer',
          minimum: 100,
          maximum: 3600000,
          default: 10000,
        },
      },
    },
  },
};
