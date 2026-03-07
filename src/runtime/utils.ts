import { EventError, EventType, OpenClawEvent } from '../events/types';
import { SessionTracker } from '../hooks/session-hooks';
import {
  HookContext,
  HookRegistrationOptions,
  OpenClawPluginApi,
  RuntimeLogger,
  ToolHookEvent,
} from './types';
import { toStableToken } from './hook-bridge-utils';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function readObject(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function toContext(value: unknown): HookContext | undefined {
  return isRecord(value) ? (value as HookContext) : undefined;
}

export function toToolHookEvent(value: unknown): ToolHookEvent {
  return isRecord(value) ? (value as ToolHookEvent) : {};
}

export function getApiConfig<T extends object>(
  api: OpenClawPluginApi,
  pluginId = 'event-server-plugin',
): Partial<T> {
  if (!isRecord(api.config)) {
    return {};
  }

  // OpenClaw runtimes may pass either plugin-scoped config or full root config.
  const rootConfig = api.config;
  const plugins = readObject(rootConfig.plugins);
  const entries = plugins ? readObject(plugins.entries) : undefined;
  const pluginEntry = entries ? readObject(entries[pluginId]) : undefined;
  const pluginScopedConfig = pluginEntry ? readObject(pluginEntry.config) : undefined;
  if (pluginScopedConfig) {
    return pluginScopedConfig as Partial<T>;
  }

  return rootConfig as Partial<T>;
}

export function getEventChannelId(event: OpenClawEvent): string | undefined {
  return readString(event.data.channelId);
}

export function getEventToolName(event: OpenClawEvent): string | undefined {
  return readString(event.data.toolName);
}

export function getWebSocketPorts(defaultPorts: number[]): number[] {
  const raw = process.env.EVENT_PLUGIN_WS_PORTS;
  if (!raw || raw.trim() === '') {
    return defaultPorts;
  }

  const parsed = raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter(
      (value, index, arr) =>
        Number.isInteger(value) && value > 0 && value <= 65535 && arr.indexOf(value) === index,
    );

  return parsed.length > 0 ? parsed : defaultPorts;
}

export function isWebSocketDisabled(): boolean {
  const raw = process.env.EVENT_PLUGIN_DISABLE_WS;
  return raw === 'true' || raw === '1';
}

export function isStatusTickerDisabled(): boolean {
  const raw = process.env.EVENT_PLUGIN_DISABLE_STATUS_TICKER;
  if (raw === 'true' || raw === '1') {
    return true;
  }
  return process.env.NODE_ENV === 'test';
}

export function normalizeError(error: unknown): EventError {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      kind: 'unknown',
    };
  }

  if (isRecord(error)) {
    return {
      message: readString(error.message) ?? toStableToken(error, 'Unknown error'),
      stack: readString(error.stack),
      code: readString(error.code),
      kind: 'unknown',
    };
  }

  return {
    message: toStableToken(error, 'Unknown error'),
    kind: 'unknown',
  };
}

function logHookError(logger: RuntimeLogger, hookName: string, error: unknown): void {
  const normalized = normalizeError(error);
  logger.error(`Error in ${hookName} hook:`, normalized.message);
}

function runHookSafely(
  logger: RuntimeLogger,
  hookName: string,
  handler: () => unknown,
): Promise<unknown> {
  return Promise.resolve()
    .then(handler)
    .catch((error) => {
      logHookError(logger, hookName, error);
      return undefined;
    });
}

export function registerInternalHook(
  logger: RuntimeLogger,
  api: OpenClawPluginApi,
  event: string,
  options: HookRegistrationOptions,
  handler: (event: unknown) => void | Promise<void>,
): void {
  api.registerHook(
    event,
    (hookEvent) => runHookSafely(logger, event, () => handler(hookEvent)).then(() => undefined),
    options,
  );
}

export function registerTypedHook(
  logger: RuntimeLogger,
  api: OpenClawPluginApi,
  event: string,
  options: HookRegistrationOptions,
  handler: (event: unknown, ctx: unknown) => void | Promise<void>,
): void {
  api.on(event, (hookEvent, ctx) => runHookSafely(logger, event, () => handler(hookEvent, ctx)), options);
}

export function registerTypedHookWithResult<TResult>(
  logger: RuntimeLogger,
  api: OpenClawPluginApi,
  event: string,
  options: HookRegistrationOptions,
  handler: (event: unknown, ctx: unknown) => TResult | undefined | Promise<TResult | undefined>,
): void {
  api.on(
    event,
    (hookEvent, ctx) => runHookSafely(logger, event, () => handler(hookEvent, ctx)) as Promise<TResult | undefined>,
    options,
  );
}

export function resolveSessionRefs(
  hookEvent?: Record<string, unknown>,
  ctx?: HookContext,
): { sessionId?: string; sessionKey?: string } {
  const eventContext = hookEvent && isRecord(hookEvent.context) ? hookEvent.context : {};
  const sessionId =
    readString(ctx?.sessionId) ??
    readString(hookEvent?.sessionId) ??
    readString(eventContext.sessionId) ??
    readString(hookEvent?.sessionKey) ??
    readString(ctx?.sessionKey);
  const sessionKey =
    readString(ctx?.sessionKey) ??
    readString(hookEvent?.sessionKey) ??
    readString(eventContext.sessionKey) ??
    readString(hookEvent?.sessionId);
  return { sessionId, sessionKey };
}

export function resolveAgentId(params: {
  sessionTracker: SessionTracker;
  hookEvent?: Record<string, unknown>;
  ctx?: HookContext;
  sessionRefs?: { sessionId?: string; sessionKey?: string };
}): string | undefined {
  const { hookEvent, ctx, sessionRefs, sessionTracker } = params;
  const eventContext = hookEvent && isRecord(hookEvent.context) ? hookEvent.context : {};
  const direct =
    readString(ctx?.agentId) ??
    readString(hookEvent?.agentId) ??
    readString(eventContext.agentId) ??
    readString(eventContext.agent);
  if (direct) {
    return direct;
  }
  return sessionTracker.getAgentIdBySession({
    sessionId: sessionRefs?.sessionId,
    sessionKey: sessionRefs?.sessionKey,
  });
}

export function resolveSessionRefForStatus(sessionId?: string, sessionKey?: string): string | undefined {
  return sessionKey ?? sessionId;
}

export function classifyAgentError(errorMessage: string): 'offline' | 'error' {
  const normalized = errorMessage.toLowerCase();
  if (
    normalized.includes('unreachable') ||
    normalized.includes('offline') ||
    normalized.includes('not reachable')
  ) {
    return 'offline';
  }
  return 'error';
}

export interface EmitAgentActivityParams {
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  correlationId?: string;
  sourceEventType: EventType;
  activity: string;
  activityDetail: string;
  toolName?: string;
  toolStatus?: 'called' | 'completed' | 'error';
  metadata?: Record<string, unknown>;
}
