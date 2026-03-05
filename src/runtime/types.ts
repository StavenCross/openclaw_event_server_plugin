import { EventQueue } from '../broadcast';
import { PluginConfig } from '../config';
import { AgentStatusReducer } from '../hooks/status-reducer';
import { SubagentTracker } from '../hooks/subagent-tracker';
import { SessionTracker } from '../hooks/session-hooks';
import { ToolCallTracker } from '../hooks/tool-hooks';
import { OpenClawEvent } from '../events/types';
import { HookBridgeGuardDecision } from '../config';
import { EventFileLogger } from '../logging';

export interface HookRegistrationOptions {
  name: string;
  description: string;
  priority?: number;
}

export interface OpenClawPluginApi {
  config?: unknown;
  registerHook(
    event: string,
    handler: (event: unknown) => Promise<void>,
    options: HookRegistrationOptions,
  ): void;
  on(
    event: string,
    handler: (event: unknown, ctx: unknown) => unknown,
    options: HookRegistrationOptions,
  ): void;
}

export interface HookContext {
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  agentName?: string;
  sessionName?: string;
  runId?: string;
  toolName?: string;
  toolCallId?: string;
  workspaceDir?: string;
  commandSource?: string;
  channelId?: string;
  [key: string]: unknown;
}

export interface ToolHookEvent {
  toolName?: string;
  toolCallId?: string;
  runId?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
  message?: unknown;
  isSynthetic?: boolean;
  [key: string]: unknown;
}

export interface PendingToolCall {
  callId: string;
  correlationId?: string;
  agentId?: string;
}

export interface PluginState {
  config: PluginConfig;
  queue?: EventQueue;
  toolTracker: ToolCallTracker;
  pendingToolCalls: Map<string, PendingToolCall>;
  pendingToolCallsByContext: WeakMap<object, PendingToolCall>;
  sessionTracker: SessionTracker;
  statusReducer: AgentStatusReducer;
  subagentTracker: SubagentTracker;
  eventFileLogger?: EventFileLogger;
  statusTimer?: NodeJS.Timeout;
  isInitialized: boolean;
  websocketEnabled: boolean;
  hookBridge?: HookBridgeRunner;
}

export interface RuntimeLogger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  queue: (...args: unknown[]) => void;
}

export interface HookBridgeRunner {
  onEvent: (event: OpenClawEvent) => void;
  evaluateBeforeToolCall: (params: {
    toolName: string;
    params: Record<string, unknown>;
    agentId?: string;
    sessionId?: string;
    sessionKey?: string;
    runId?: string;
    toolCallId?: string;
  }) => Promise<HookBridgeGuardDecisionOutcome | undefined>;
  stop: () => Promise<void>;
}

export interface HookBridgeGuardDecisionOutcome extends HookBridgeGuardDecision {
  matchedRuleId?: string;
  matchedActionId?: string;
  decisionSource?: 'action' | 'rule' | 'cache' | 'backoff';
  matched?: boolean;
}
