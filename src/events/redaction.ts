import { RedactionConfig } from '../config/types';
import { OpenClawEvent } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeFieldSet(fields: string[]): Set<string> {
  return new Set(fields.map((field) => field.trim().toLowerCase()).filter(Boolean));
}

function redactValue(
  value: unknown,
  sensitiveFields: Set<string>,
  replacement: string,
  seen: WeakSet<object>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, sensitiveFields, replacement, seen));
  }

  if (!isRecord(value)) {
    return value;
  }

  if (seen.has(value)) {
    return replacement;
  }
  seen.add(value);

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (sensitiveFields.has(key.toLowerCase())) {
      redacted[key] = replacement;
      continue;
    }
    redacted[key] = redactValue(nestedValue, sensitiveFields, replacement, seen);
  }
  return redacted;
}

export function redactPayload<T>(
  payload: T,
  config: Pick<RedactionConfig, 'enabled' | 'replacement' | 'fields'>,
): T {
  if (!config.enabled) {
    return payload;
  }

  const sensitiveFields = normalizeFieldSet(config.fields);
  if (sensitiveFields.size === 0) {
    return payload;
  }

  const redacted = redactValue(payload, sensitiveFields, config.replacement, new WeakSet<object>());
  return redacted as T;
}

export function redactEvent(event: OpenClawEvent, config: RedactionConfig): OpenClawEvent {
  return redactPayload(event, config);
}
