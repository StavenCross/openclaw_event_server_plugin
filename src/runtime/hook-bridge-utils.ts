import { realpathSync } from 'node:fs';
import { OpenClawEvent } from '../events/types';
import { HookBridgeRuleCoalesce } from '../config';

export function matchesScalarOrList(
  matcher: string | string[] | undefined,
  value: string | undefined,
): boolean {
  if (matcher === undefined) {
    return true;
  }
  if (value === undefined) {
    return false;
  }

  if (typeof matcher === 'string') {
    return value === matcher;
  }

  return matcher.includes(value);
}

export function matchesDomainList(host: string, domains: string[]): boolean {
  const normalizedHost = host.toLowerCase();
  return domains.some((entry) => {
    const normalizedEntry = entry.trim().toLowerCase();
    if (normalizedEntry === '') {
      return false;
    }
    return normalizedHost === normalizedEntry || normalizedHost.endsWith(`.${normalizedEntry}`);
  });
}

export function readPath(event: OpenClawEvent, dottedPath: string): unknown {
  const segments = dottedPath
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return undefined;
  }

  const eventRecord = event as unknown as Record<string, unknown>;
  const first = segments[0];
  let current: unknown;

  if (first in eventRecord) {
    current = eventRecord[first];
  } else {
    const data = event.data;
    current = data[first];
  }

  for (let index = 1; index < segments.length; index += 1) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segments[index]];
  }

  return current;
}

export function buildCoalesceKey(
  ruleId: string,
  event: OpenClawEvent,
  coalesce: HookBridgeRuleCoalesce,
): string | undefined {
  const keyFields = coalesce.keyFields ?? ['sessionKey', 'agentId', 'data.toolName', 'event.type'];

  const values = keyFields
    .map((field) => {
      if (field === 'ruleId') {
        return ruleId;
      }
      if (field === 'event.type' || field === 'type') {
        return event.type;
      }
      const value = readPath(event, field);
      return value === undefined || value === null ? '' : String(value);
    })
    .filter((value) => value !== '');

  if (values.length === 0) {
    return undefined;
  }

  return `${ruleId}::${values.join('::')}`;
}

export function trimPreview(value: string, limit = 240): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}...`;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableJson(item));
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const out: Record<string, unknown> = {};
    for (const [key, nested] of entries) {
      out[key] = normalizeForStableJson(nested);
    }
    return out;
  }
  return value;
}

export function toCanonicalPath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}
