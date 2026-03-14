/**
 * Provenance helpers for translating raw hook/session observations into the
 * additive tool metadata emitted on the canonical event stream.
 */

import type {
  ParsedSessionKey,
  SessionProvenanceSnapshot,
  SessionRouteMetadata,
  SessionTracker,
} from '../hooks/session-tracker';
import type { HookContext } from './types';

export interface SessionRefCandidates {
  hookEventSessionId?: string;
  hookEventSessionKey?: string;
  hookEventContextSessionId?: string;
  hookEventContextSessionKey?: string;
  ctxSessionId?: string;
  ctxSessionKey?: string;
}

export interface ResolvedSessionRefs {
  sessionId?: string;
  sessionKey?: string;
  sessionIdSource?: string;
  sessionKeySource?: string;
  resolvedSessionSource?: string;
  candidates: SessionRefCandidates;
  aliasSessionIds: string[];
  aliasSessionKeys: string[];
}

function dedupe(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readStringRecordField(record: Record<string, unknown>, key: string): string | undefined {
  return readString(record[key]);
}

export function buildSessionRefCandidates(
  hookEvent?: Record<string, unknown>,
  ctx?: HookContext,
): SessionRefCandidates {
  const eventContext = hookEvent && isRecord(hookEvent.context) ? hookEvent.context : {};
  return {
    hookEventSessionId: readStringRecordField(hookEvent ?? {}, 'sessionId'),
    hookEventSessionKey: readStringRecordField(hookEvent ?? {}, 'sessionKey'),
    hookEventContextSessionId: readStringRecordField(eventContext, 'sessionId'),
    hookEventContextSessionKey: readStringRecordField(eventContext, 'sessionKey'),
    ctxSessionId: readString(ctx?.sessionId),
    ctxSessionKey: readString(ctx?.sessionKey),
  };
}

function resolveValue(
  candidates: Array<{ source: string; value?: string }>,
): { value?: string; source?: string } {
  const match = candidates.find((candidate) => candidate.value !== undefined && candidate.value.trim().length > 0);
  return {
    value: match?.value,
    source: match?.source,
  };
}

export function resolveSessionRefs(
  hookEvent?: Record<string, unknown>,
  ctx?: HookContext,
): ResolvedSessionRefs {
  const candidates = buildSessionRefCandidates(hookEvent, ctx);
  const sessionId = resolveValue([
    { source: 'ctx.sessionId', value: candidates.ctxSessionId },
    { source: 'hookEvent.sessionId', value: candidates.hookEventSessionId },
    { source: 'hookEvent.context.sessionId', value: candidates.hookEventContextSessionId },
    { source: 'hookEvent.sessionId_fallback', value: candidates.hookEventSessionKey },
    { source: 'hookEvent.context.sessionId_fallback', value: candidates.hookEventContextSessionKey },
    { source: 'ctx.sessionId_fallback', value: candidates.ctxSessionKey },
  ]);
  const sessionKey = resolveValue([
    { source: 'ctx.sessionKey', value: candidates.ctxSessionKey },
    { source: 'hookEvent.sessionKey', value: candidates.hookEventSessionKey },
    { source: 'hookEvent.context.sessionKey', value: candidates.hookEventContextSessionKey },
    { source: 'hookEvent.sessionKey_fallback', value: candidates.hookEventSessionId },
    { source: 'hookEvent.context.sessionKey_fallback', value: candidates.hookEventContextSessionId },
    { source: 'ctx.sessionKey_fallback', value: candidates.ctxSessionId },
  ]);

  return {
    sessionId: sessionId.value,
    sessionKey: sessionKey.value,
    sessionIdSource: sessionId.source,
    sessionKeySource: sessionKey.source,
    resolvedSessionSource: sessionKey.source ?? sessionId.source,
    candidates,
    aliasSessionIds: dedupe([
      candidates.ctxSessionId,
      candidates.hookEventSessionId,
      candidates.hookEventContextSessionId,
    ]),
    aliasSessionKeys: dedupe([
      candidates.ctxSessionKey,
      candidates.hookEventSessionKey,
      candidates.hookEventContextSessionKey,
      candidates.ctxSessionId?.startsWith('agent:') ? candidates.ctxSessionId : undefined,
      candidates.hookEventSessionId?.startsWith('agent:') ? candidates.hookEventSessionId : undefined,
      candidates.hookEventContextSessionId?.startsWith('agent:')
        ? candidates.hookEventContextSessionId
        : undefined,
    ]),
  };
}

export function extractRouteProvenance(
  hookEvent?: Record<string, unknown>,
  ctx?: HookContext,
): SessionRouteMetadata | undefined {
  const eventContext = hookEvent && isRecord(hookEvent.context) ? hookEvent.context : {};
  const route: SessionRouteMetadata = {
    provider:
      readStringRecordField(hookEvent ?? {}, 'provider') ??
      readStringRecordField(eventContext, 'provider') ??
      readString(ctx?.provider),
    surface:
      readStringRecordField(hookEvent ?? {}, 'surface') ??
      readStringRecordField(eventContext, 'surface') ??
      readString(ctx?.surface),
    accountId:
      readStringRecordField(hookEvent ?? {}, 'accountId') ??
      readStringRecordField(eventContext, 'accountId') ??
      readString(ctx?.accountId),
    channelId:
      readStringRecordField(hookEvent ?? {}, 'channelId') ??
      readStringRecordField(eventContext, 'channelId') ??
      readString(ctx?.channelId),
    conversationId:
      readStringRecordField(hookEvent ?? {}, 'conversationId') ??
      readStringRecordField(eventContext, 'conversationId') ??
      readString(ctx?.conversationId),
    threadId:
      readStringRecordField(hookEvent ?? {}, 'threadId') ??
      readStringRecordField(eventContext, 'threadId') ??
      readString(ctx?.threadId),
    messageId:
      readStringRecordField(hookEvent ?? {}, 'messageId') ??
      readStringRecordField(eventContext, 'messageId') ??
      readString(ctx?.messageId),
    from:
      readStringRecordField(hookEvent ?? {}, 'from') ??
      readStringRecordField(eventContext, 'from') ??
      readString(ctx?.from),
    to:
      readStringRecordField(hookEvent ?? {}, 'to') ??
      readStringRecordField(eventContext, 'to') ??
      readString(ctx?.to),
    senderId:
      readStringRecordField(hookEvent ?? {}, 'senderId') ??
      readStringRecordField(eventContext, 'senderId') ??
      readString(ctx?.senderId),
    senderName:
      readStringRecordField(hookEvent ?? {}, 'senderName') ??
      readStringRecordField(eventContext, 'senderName') ??
      readString(ctx?.senderName),
  };

  return Object.values(route).some((value) => value !== undefined) ? route : undefined;
}

/**
 * Feed generic session/route observations into the tracker without coupling the
 * tracker to any Slack-specific consumer concerns.
 */
export function observeSessionProvenance(params: {
  sessionTracker: SessionTracker;
  sessionRefs: ResolvedSessionRefs;
  hookEvent?: Record<string, unknown>;
  ctx?: HookContext;
  agentId?: string;
  parentAgentId?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  runId?: string;
  direction?: 'inbound' | 'outbound' | 'internal';
}): void {
  params.sessionTracker.touchSession({
    sessionId: params.sessionRefs.sessionId,
    sessionKey: params.sessionRefs.sessionKey,
    aliasSessionIds: params.sessionRefs.aliasSessionIds,
    aliasSessionKeys: params.sessionRefs.aliasSessionKeys,
    agentId: params.agentId,
    parentAgentId: params.parentAgentId,
    parentSessionId: params.parentSessionId,
    parentSessionKey: params.parentSessionKey,
    runId: params.runId,
    route: extractRouteProvenance(params.hookEvent, params.ctx),
    direction: params.direction,
  });
}

function mergeParsedRoute(
  route: SessionRouteMetadata | undefined,
  parsedSession?: ParsedSessionKey,
): SessionRouteMetadata | undefined {
  if (!parsedSession) {
    return route;
  }

  const merged: SessionRouteMetadata = {
    provider: route?.provider ?? parsedSession.provider,
    surface: route?.surface ?? parsedSession.surface,
    accountId: route?.accountId ?? parsedSession.accountId,
    channelId: route?.channelId,
    conversationId: route?.conversationId,
    threadId: route?.threadId ?? parsedSession.threadToken,
    messageId: route?.messageId,
    from: route?.from,
    to: route?.to,
    senderId: route?.senderId,
    senderName: route?.senderName,
  };

  return Object.values(merged).some((value) => value !== undefined) ? merged : undefined;
}

export function buildToolEventProvenance(params: {
  sessionTracker: SessionTracker;
  sessionRefs: ResolvedSessionRefs;
  hookEvent?: Record<string, unknown>;
  ctx?: HookContext;
  runId?: string;
  toolCallId?: string;
  correlationId?: string;
  parentAgentId?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  subagentKey?: string;
}): Record<string, unknown> {
  const snapshot: SessionProvenanceSnapshot = params.sessionTracker.getSessionProvenance({
    sessionId: params.sessionRefs.sessionId,
    sessionKey: params.sessionRefs.sessionKey,
    aliasSessionIds: params.sessionRefs.aliasSessionIds,
    aliasSessionKeys: params.sessionRefs.aliasSessionKeys,
    runId: params.runId,
  });

  const mergedRoute = mergeParsedRoute(snapshot.route, snapshot.parsedSession);

  return {
    resolvedSessionId: params.sessionRefs.sessionId,
    resolvedSessionKey: params.sessionRefs.sessionKey,
    resolvedSessionSource: params.sessionRefs.resolvedSessionSource,
    hookEventSessionId: params.sessionRefs.candidates.hookEventSessionId,
    hookEventSessionKey: params.sessionRefs.candidates.hookEventSessionKey,
    hookEventContextSessionId: params.sessionRefs.candidates.hookEventContextSessionId,
    hookEventContextSessionKey: params.sessionRefs.candidates.hookEventContextSessionKey,
    ctxSessionId: params.sessionRefs.candidates.ctxSessionId,
    ctxSessionKey: params.sessionRefs.candidates.ctxSessionKey,
    runId: params.runId,
    toolCallId: params.toolCallId,
    correlationId: params.correlationId,
    parentAgentId: params.parentAgentId ?? snapshot.parentAgentId,
    parentSessionId: params.parentSessionId ?? snapshot.parentSessionId,
    parentSessionKey: params.parentSessionKey ?? snapshot.parentSessionKey,
    subagentKey: params.subagentKey,
    provider: snapshot.routeResolution === 'resolved' ? mergedRoute?.provider : undefined,
    surface: snapshot.routeResolution === 'resolved' ? mergedRoute?.surface : undefined,
    accountId: snapshot.routeResolution === 'resolved' ? mergedRoute?.accountId : undefined,
    channelId: snapshot.routeResolution === 'resolved' ? mergedRoute?.channelId : undefined,
    conversationId: snapshot.routeResolution === 'resolved' ? mergedRoute?.conversationId : undefined,
    threadId: snapshot.routeResolution === 'resolved' ? mergedRoute?.threadId : undefined,
    messageId: snapshot.routeResolution === 'resolved' ? mergedRoute?.messageId : undefined,
    from: snapshot.routeResolution === 'resolved' ? mergedRoute?.from : undefined,
    to: snapshot.routeResolution === 'resolved' ? mergedRoute?.to : undefined,
    senderId: snapshot.routeResolution === 'resolved' ? mergedRoute?.senderId : undefined,
    senderName: snapshot.routeResolution === 'resolved' ? mergedRoute?.senderName : undefined,
    sessionAliases: snapshot.sessionAliases,
    parsedSession: snapshot.parsedSession,
    isThreadScoped: snapshot.parsedSession?.isThreadScoped,
    threadKind: snapshot.parsedSession?.threadKind,
    threadToken: snapshot.parsedSession?.threadToken,
    routeResolution: snapshot.routeResolution,
  };
}
