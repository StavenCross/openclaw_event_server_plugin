/**
 * Canonical event type definitions for OpenClaw Event Server Plugin.
 *
 * The server broadcasts raw hook/plugin events with minimal transformation plus
 * optional synthetic status/activity events.
 */

export type EventCategory =
  | 'message'
  | 'tool'
  | 'command'
  | 'session'
  | 'agent'
  | 'gateway'
  | 'subagent'
  | 'synthetic';

export type EventSource = 'internal-hook' | 'plugin-hook' | 'synthetic';

export type EventType =
  | 'message.received'
  | 'message.transcribed'
  | 'message.preprocessed'
  | 'message.sent'
  | 'message.edited'
  | 'message.deleted'
  | 'tool.called'
  | 'tool.guard.matched'
  | 'tool.guard.allowed'
  | 'tool.guard.blocked'
  | 'tool.completed'
  | 'tool.error'
  | 'tool.result_persist'
  | 'command.new'
  | 'command.reset'
  | 'command.stop'
  | 'session.start'
  | 'session.end'
  | 'subagent.spawning'
  | 'subagent.spawned'
  | 'subagent.ended'
  | 'subagent.idle'
  | 'agent.bootstrap'
  | 'agent.error'
  | 'agent.session_start'
  | 'agent.session_end'
  | 'agent.sub_agent_spawn'
  | 'agent.status'
  | 'agent.activity'
  | 'gateway.startup'
  | 'gateway.start'
  | 'gateway.stop'
  // Legacy compatibility aliases
  | 'session.spawned'
  | 'session.completed'
  | 'session.error';

export type AgentSyntheticStatus = 'sleeping' | 'idle' | 'working' | 'offline' | 'error';

/**
 * Normalized subagent termination reasons.
 *
 * Keep this list stable for downstream consumers even if upstream runtimes add
 * new cleanup modes later. Unknown or older runtimes should fall back to
 * `unknown` rather than omitting the field so consumers can branch safely.
 */
export type SubagentEndReason = 'completed' | 'deleted' | 'swept' | 'released' | 'unknown';

export interface EventError {
  message: string;
  code?: string;
  stack?: string;
  kind?: 'tool' | 'agent' | 'gateway' | 'unknown';
}

export interface EventSignature {
  version: 'v1';
  algorithm: 'sha256' | 'sha512';
  timestamp: number;
  nonce: string;
  value: string;
}

export interface OpenClawEvent {
  /** Unique event ID */
  eventId: string;
  /** Canonical event schema version */
  schemaVersion: string;
  /** Legacy/primary type identifier for consumers */
  type: EventType;
  /** Canonical grouping for downstream filtering */
  eventCategory?: EventCategory;
  /** Original source event key name */
  eventName?: string;
  /** Where this event originated */
  source?: EventSource;
  /** Timestamp when event occurred */
  timestamp: string;
  /** Agent identifiers when known */
  agentId?: string;
  agentName?: string;
  /** Session identifiers when known */
  sessionId?: string;
  sessionKey?: string;
  sessionName?: string;
  /** Run/tool correlation identifiers */
  runId?: string;
  toolCallId?: string;
  correlationId?: string;
  /** Result/error fields for completion/error events */
  result?: unknown;
  error?: EventError;
  /** Plugin version that generated this event */
  pluginVersion: string;
  /** Optional cryptographic signature when HMAC signing is enabled */
  signature?: EventSignature;
  /** Raw normalized event payload */
  data: Record<string, unknown>;
  /** Additional metadata/debug fields */
  metadata?: Record<string, unknown>;
}

export type MessageEvent = OpenClawEvent;
export type ToolEvent = OpenClawEvent;
export type SessionEvent = OpenClawEvent;
export type AgentEvent = OpenClawEvent;
export type CommandEvent = OpenClawEvent;
export type GatewayEvent = OpenClawEvent;
export type SubagentEvent = OpenClawEvent;

/**
 * Webhook configuration for broadcasting
 */
export interface WebhookConfig {
  /** Webhook URL */
  url: string;
  /** HTTP method (default: POST) */
  method?: 'POST' | 'PUT' | 'PATCH';
  /** Custom headers */
  headers?: Record<string, string>;
  /** Authentication token (optional) */
  authToken?: string;
  /** Whether to include full event payload */
  includeFullPayload?: boolean;
}

/**
 * Event filter configuration
 */
export interface EventFilter {
  /** Event types to include (empty = all) */
  includeTypes?: EventType[];
  /** Event types to exclude */
  excludeTypes?: EventType[];
  /** Filter by channel ID */
  channelId?: string;
  /** Filter by tool name */
  toolName?: string;
  /** Filter by session ID */
  sessionId?: string;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum retry attempts */
  maxAttempts: number;
  /** Initial delay in milliseconds */
  initialDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
}

/**
 * Queue configuration
 */
export interface QueueConfig {
  /** Maximum queue size */
  maxSize: number;
  /** Flush interval in milliseconds */
  flushIntervalMs: number;
  /** Whether to persist queue to disk */
  persistToDisk: boolean;
  /** Queue file path (if persisting) */
  persistPath?: string;
}
