import type { TypedHookDeps } from './typed-hooks';

const TOOL_GUARD_TRACE =
  process.env.EVENT_PLUGIN_TOOL_GUARD_TRACE === '1' ||
  process.env.EVENT_PLUGIN_TOOL_GUARD_TRACE === 'true';

/**
 * Keep verbose guard tracing behind a dedicated opt-in flag so production event
 * payloads stay unchanged while local debugging can still inspect decisions.
 */
export function traceToolGuard(logger: TypedHookDeps['logger'], ...args: unknown[]): void {
  if (!TOOL_GUARD_TRACE) {
    return;
  }
  logger.info('[ToolGuardTrace]', ...args);
}

/**
 * When a guard blocks a tool call we null every original param key as a
 * fail-closed fallback. If another hook mutates the return shape later, the
 * runtime still receives unusable arguments instead of the real payload.
 */
export function buildBlockedParamsPatch(params: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = { __toolGuardBlocked: true };
  for (const key of Object.keys(params)) {
    patch[key] = null;
  }
  return patch;
}
