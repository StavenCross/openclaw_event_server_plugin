import { EventFilter, QueueConfig, RetryConfig, WebhookConfig } from '../events/types';

export interface PluginConfig {
  /** Enable/disable the plugin */
  enabled: boolean;
  /** Webhook endpoints to broadcast to */
  webhooks: WebhookConfig[];
  /** Event filtering configuration */
  filters: EventFilter;
  /** Retry configuration for failed webhooks */
  retry: RetryConfig;
  /** Event queue configuration */
  queue: QueueConfig;
  /** Logging configuration */
  logging: LoggingConfig;
  /** Synthetic status reducer settings */
  status: StatusConfig;
  /** Optional payload redaction before broadcast */
  redaction: RedactionConfig;
  /** Event file logging configuration */
  eventLog: EventLogConfig;
  /** Security configuration for WS and event signatures */
  security: SecurityConfig;
  /** Correlation ID header name */
  correlationIdHeader: string;
  /** Timeout for webhook requests in milliseconds */
  webhookTimeoutMs: number;
  /** Optional event-driven automation bridge */
  hookBridge: HookBridgeConfig;
}

export interface HookBridgeConfig {
  /** Enable rule-based action dispatch from emitted events */
  enabled: boolean;
  /** When true, matching rules are logged but actions are not executed */
  dryRun: boolean;
  /** Allow local script actions only from these absolute directories */
  allowedActionDirs: string[];
  /** Default limits for local script actions */
  localScriptDefaults: LocalScriptDefaults;
  /** Action registry */
  actions: Record<string, HookBridgeAction>;
  /** Rule list */
  rules: HookBridgeRule[];
  /** Optional synchronous tool-call guard (before_tool_call) */
  toolGuard: HookBridgeToolGuardConfig;
  /** Runtime queue/backpressure controls */
  runtime: HookBridgeRuntimeConfig;
  /** Operational telemetry thresholds */
  telemetry: HookBridgeTelemetryConfig;
}

export interface HookBridgeToolGuardConfig {
  /** Enable synchronous policy checks in before_tool_call */
  enabled: boolean;
  /** When true, guard decisions are logged but never enforced */
  dryRun: boolean;
  /** Timeout applied when action does not specify one */
  timeoutMs: number;
  /** Behavior when guard action fails or times out */
  onError: 'allow' | 'block';
  /** Key format for retry/backoff and approval cache scopes */
  scopeKeyBy?: 'tool' | 'tool_and_params';
  /** Enforce minimum delay between repeated blocked retries for same scope */
  retryBackoffMs: number;
  /** Override block reason used while in forced backoff window */
  retryBackoffReason?: string;
  /** Cache allow decisions for repeat calls within TTL */
  approvalCacheTtlMs: number;
  /** Stop evaluating additional rules when a match produces no decision (decision matches always short-circuit) */
  stopOnMatchDefault?: boolean;
  /** Optional redaction applied to tool.guard.* event payload params */
  redaction: HookBridgeToolGuardRedactionConfig;
  /** Rule list for synchronous tool guard checks */
  rules: HookBridgeToolGuardRule[];
}

export interface HookBridgeToolGuardRedactionConfig {
  /** Redact tool.guard.* event params before broadcast */
  enabled: boolean;
  /** Replacement string for redacted values */
  replacement: string;
  /** Case-insensitive key names to redact recursively */
  fields: string[];
}

export interface HookBridgeToolGuardRule {
  /** Stable identifier for cooldown and debugging */
  id: string;
  /** Optional toggle for incremental rollout */
  enabled?: boolean;
  /** Higher values evaluate first (ties keep config order) */
  priority?: number;
  /** Matcher criteria against tool-call context */
  when: HookBridgeRuleWhen;
  /** Action ID to execute */
  action?: string;
  /** Optional static decision (no action execution) */
  decision?: HookBridgeGuardDecision;
  /** Stop rule chain after this rule matches with no decision (default inherited from toolGuard.stopOnMatchDefault) */
  stopOnMatch?: boolean;
  /** Suppress repeated triggers for this many milliseconds */
  cooldownMs?: number;
}

export interface HookBridgeGuardDecision {
  /** Block the tool call when true */
  block?: boolean;
  /** Guidance shown when blocked */
  blockReason?: string;
  /** Optional param patch merged by OpenClaw before tool execute */
  params?: Record<string, unknown>;
  /** Optional template for dynamic block guidance */
  blockReasonTemplate?: string;
}

export interface HookBridgeRuntimeConfig {
  /** Max pending hook tasks in memory */
  maxPendingEvents: number;
  /** Number of concurrent action workers */
  concurrency: number;
  /** Queue handling policy when full */
  dropPolicy: 'drop_oldest' | 'drop_newest';
}

export interface HookBridgeTelemetryConfig {
  /** Queue utilization percentages that emit high-watermark warnings */
  highWatermarks: number[];
  /** Emit slow-action warning when duration exceeds this threshold */
  slowActionMs: number;
  /** Rolling window size used to evaluate failure-rate warnings */
  failureRateWindowMs: number;
  /** Failure-rate warning threshold as percentage [0, 100] */
  failureRateThresholdPct: number;
  /** Minimum sample count before failure-rate warning logic applies */
  failureRateMinSamples: number;
  /** Duration queue must remain full before backpressure active warning */
  saturationWindowMs: number;
}

export interface LocalScriptDefaults {
  /** Max runtime for local script actions */
  timeoutMs: number;
  /** Max JSON payload size sent over stdin */
  maxPayloadBytes: number;
}

export type HookBridgeAction = HookBridgeWebhookAction | HookBridgeLocalScriptAction;

export interface HookBridgeWebhookAction {
  type: 'webhook';
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  authToken?: string;
  timeoutMs?: number;
}

export interface HookBridgeLocalScriptAction {
  type: 'local_script';
  path: string;
  args?: string[];
  timeoutMs?: number;
  maxPayloadBytes?: number;
}

export interface HookBridgeRule {
  /** Stable identifier for cooldown and debugging */
  id: string;
  /** Optional toggle for incremental rollout */
  enabled?: boolean;
  /** Matcher criteria */
  when: HookBridgeRuleWhen;
  /** Action ID to execute */
  action: string;
  /** Suppress repeated triggers for this many milliseconds */
  cooldownMs?: number;
  /** Optional duplicate-event coalescing for this rule */
  coalesce?: HookBridgeRuleCoalesce;
}

export interface HookBridgeRuleCoalesce {
  /** Enable event coalescing for this rule */
  enabled: boolean;
  /** Dotted event paths used to compute coalesce key */
  keyFields?: string[];
  /** Coalescing window in milliseconds */
  windowMs?: number;
  /** Whether first or latest payload wins during coalescing */
  strategy?: 'first' | 'latest';
}

export interface HookBridgeRuleWhen {
  eventType?: string | string[];
  toolName?: string | string[];
  agentId?: string | string[];
  sessionId?: string | string[];
  sessionKey?: string | string[];
  /** String containment checks using dotted paths (for example data.params.command) */
  contains?: Record<string, string>;
  /** Exact checks using dotted paths */
  equals?: Record<string, string | number | boolean>;
  /** Required path existence checks */
  requiredPaths?: string[];
  /** Type checks using dotted paths */
  typeChecks?: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>;
  /** Exact inclusion checks using dotted paths */
  inList?: Record<string, Array<string | number | boolean>>;
  /** Exact exclusion checks using dotted paths */
  notInList?: Record<string, Array<string | number | boolean>>;
  /** Regex checks using dotted paths (value must match pattern) */
  matchesRegex?: Record<string, string>;
  /** Regex checks using dotted paths (value must NOT match pattern) */
  notMatchesRegex?: Record<string, string>;
  /** Domain allowlist against URL field (default data.params.url) */
  domainAllowlist?: string[];
  /** Domain denylist against URL field (default data.params.url) */
  domainBlocklist?: string[];
  /** Dotted path to URL field used by domain lists */
  domainPath?: string;
  /** Threshold check for numeric idle fields */
  idleForMsGte?: number;
  /** Required parent-agent status for subagent-origin events */
  parentStatus?: string;
}

export interface LoggingConfig {
  /** Enable debug logging */
  debug: boolean;
  /** Log successful webhook deliveries */
  logSuccess: boolean;
  /** Log failed webhook deliveries */
  logErrors: boolean;
  /** Log queue operations */
  logQueue: boolean;
}

export interface StatusConfig {
  /** Events within this window are treated as active/working */
  workingWindowMs: number;
  /** Inactivity beyond this window is treated as sleeping */
  sleepingWindowMs: number;
  /** Status transition evaluation interval */
  tickIntervalMs: number;
  /** Subagent idle transition threshold */
  subagentIdleWindowMs: number;
}

export interface RedactionConfig {
  /** When true, redaction runs before WS/webhook broadcast */
  enabled: boolean;
  /** Replacement string for redacted fields */
  replacement: string;
  /** Case-insensitive key names to redact recursively */
  fields: string[];
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface EventLogConfig {
  /** Enable event/runtime file logging */
  enabled: boolean;
  /** NDJSON output file path */
  path: string;
  /** Maximum size of the log file before truncation rollover */
  maxFileSizeMb: number;
  /** Serialization mode for event records */
  format: 'full-json' | 'summary';
  /** Minimum runtime log level to persist */
  minLevel: LogLevel;
  /** Include runtime log records in file output */
  includeRuntimeLogs: boolean;
}

export interface WsSecurityConfig {
  /** Host bind address for WS server */
  bindAddress: string;
  /** Require client token auth for WS connections */
  requireAuth: boolean;
  /** Shared WS auth token */
  authToken?: string;
  /** Allowed WS Origin values; empty allows all */
  allowedOrigins: string[];
  /** Allowed client IPs; empty allows all */
  allowedIps: string[];
}

export interface HmacSecurityConfig {
  /** Enable event signature generation */
  enabled: boolean;
  /** Shared secret used to sign payloads */
  secret?: string;
  /** Optional local file path for secret loading */
  secretFilePath?: string;
  /** HMAC algorithm */
  algorithm: 'sha256' | 'sha512';
}

export interface SecurityConfig {
  ws: WsSecurityConfig;
  hmac: HmacSecurityConfig;
}
