import { HookBridgeGuardDecision, HookBridgeRule, HookBridgeToolGuardRule } from '../config';
import { OpenClawEvent } from '../events/types';
import { matchesDomainList, matchesScalarOrList, readPath, stableJsonStringify } from './hook-bridge-utils';

export function buildToolGuardEvent(params: {
  toolName: string;
  params: Record<string, unknown>;
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  toolCallId?: string;
}): OpenClawEvent {
  return {
    eventId: `tool-guard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    schemaVersion: '1.1.0',
    pluginVersion: '1.0.0',
    timestamp: new Date().toISOString(),
    type: 'tool.called',
    eventCategory: 'tool',
    eventName: 'before_tool_call',
    source: 'plugin-hook',
    agentId: params.agentId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    runId: params.runId,
    toolCallId: params.toolCallId,
    data: {
      toolName: params.toolName,
      params: params.params,
    },
  };
}

export function matchesRule(
  event: OpenClawEvent,
  rule: HookBridgeRule | HookBridgeToolGuardRule,
  parentStatusByAgent: Map<string, string>,
): boolean {
  const when = rule.when;

  if (!matchesScalarOrList(when.eventType, event.type)) {
    return false;
  }

  const toolName = readPath(event, 'data.toolName');
  if (!matchesScalarOrList(when.toolName, typeof toolName === 'string' ? toolName : undefined)) {
    return false;
  }

  if (!matchesScalarOrList(when.agentId, event.agentId)) {
    return false;
  }

  if (!matchesScalarOrList(when.sessionId, event.sessionId)) {
    return false;
  }

  if (!matchesScalarOrList(when.sessionKey, event.sessionKey)) {
    return false;
  }

  if (when.contains) {
    for (const [path, expectedSubstring] of Object.entries(when.contains)) {
      const value = readPath(event, path);
      if (typeof value !== 'string' || !value.includes(expectedSubstring)) {
        return false;
      }
    }
  }

  if (when.equals) {
    for (const [path, expected] of Object.entries(when.equals)) {
      const value = readPath(event, path);
      if (value !== expected) {
        return false;
      }
    }
  }

  if (when.requiredPaths) {
    for (const path of when.requiredPaths) {
      const value = readPath(event, path);
      if (value === undefined || value === null) {
        return false;
      }
    }
  }

  if (when.typeChecks) {
    for (const [path, expectedType] of Object.entries(when.typeChecks)) {
      const value = readPath(event, path);
      if (expectedType === 'array') {
        if (!Array.isArray(value)) {
          return false;
        }
        continue;
      }
      if (expectedType === 'object') {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return false;
        }
        continue;
      }
      if (typeof value !== expectedType) {
        return false;
      }
    }
  }

  if (when.inList) {
    for (const [path, values] of Object.entries(when.inList)) {
      const value = readPath(event, path);
      if (!values.includes(value as never)) {
        return false;
      }
    }
  }

  if (when.notInList) {
    for (const [path, values] of Object.entries(when.notInList)) {
      const value = readPath(event, path);
      if (values.includes(value as never)) {
        return false;
      }
    }
  }

  if (when.matchesRegex) {
    for (const [path, pattern] of Object.entries(when.matchesRegex)) {
      const value = readPath(event, path);
      if (typeof value !== 'string') {
        return false;
      }
      try {
        const regex = new RegExp(pattern);
        if (!regex.test(value)) {
          return false;
        }
      } catch {
        return false;
      }
    }
  }

  if (when.notMatchesRegex) {
    for (const [path, pattern] of Object.entries(when.notMatchesRegex)) {
      const value = readPath(event, path);
      if (typeof value !== 'string') {
        continue;
      }
      try {
        const regex = new RegExp(pattern);
        if (regex.test(value)) {
          return false;
        }
      } catch {
        return false;
      }
    }
  }

  const domainPath = when.domainPath ?? 'data.params.url';
  if (when.domainAllowlist && when.domainAllowlist.length > 0) {
    const host = extractHostFromPath(event, domainPath);
    if (!host || !matchesDomainList(host, when.domainAllowlist)) {
      return false;
    }
  }
  if (when.domainBlocklist && when.domainBlocklist.length > 0) {
    const host = extractHostFromPath(event, domainPath);
    if (!host || !matchesDomainList(host, when.domainBlocklist)) {
      return false;
    }
  }

  if (typeof when.idleForMsGte === 'number') {
    const idleForMsValue = readPath(event, 'data.idleForMs');
    if (typeof idleForMsValue !== 'number' || idleForMsValue < when.idleForMsGte) {
      return false;
    }
  }

  if (when.parentStatus) {
    const parentAgentId = readPath(event, 'data.parentAgentId');
    if (typeof parentAgentId !== 'string') {
      return false;
    }
    const status = parentStatusByAgent.get(parentAgentId);
    if (status !== when.parentStatus) {
      return false;
    }
  }

  return true;
}

export function buildToolGuardScopeKey(
  toolName: string,
  params: Record<string, unknown>,
  mode: 'tool' | 'tool_and_params',
): string {
  if (mode === 'tool') {
    return toolName;
  }
  return `${toolName}:${stableJsonStringify(params)}`;
}

export function resolveDecisionTemplates(
  decision: HookBridgeGuardDecision,
  event: OpenClawEvent,
): HookBridgeGuardDecision {
  const reasonTemplate = decision.blockReasonTemplate ?? decision.blockReason;
  if (!reasonTemplate) {
    return decision;
  }
  return {
    ...decision,
    blockReason: renderGuardTemplate(reasonTemplate, event),
  };
}

export function renderGuardTemplate(template: string, event: OpenClawEvent): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, rawToken: string) => {
    const token = rawToken.trim();
    if (token === 'toolName') {
      const toolName = readPath(event, 'data.toolName');
      return typeof toolName === 'string' ? toolName : '';
    }
    if (token === 'eventType') {
      return event.type;
    }
    if (token === 'agentId') {
      return event.agentId ?? '';
    }
    if (token === 'sessionId') {
      return event.sessionId ?? '';
    }
    if (token === 'sessionKey') {
      return event.sessionKey ?? '';
    }
    if (token === 'runId') {
      return event.runId ?? '';
    }
    if (token === 'toolCallId') {
      return event.toolCallId ?? '';
    }

    const pathPrefix = 'path:';
    if (token.startsWith(pathPrefix)) {
      const path = token.slice(pathPrefix.length).trim();
      const value = readPath(event, path);
      return value === undefined || value === null ? '' : String(value);
    }

    return '';
  });
}

function extractHostFromPath(event: OpenClawEvent, path: string): string | undefined {
  const raw = readPath(event, path);
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  try {
    const parsed = new URL(raw);
    return parsed.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
