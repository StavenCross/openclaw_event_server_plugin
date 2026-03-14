/**
 * Session tracking with explicit ambiguity handling.
 *
 * The tracker only enriches downstream events when a shared runtime alias can
 * be tied back to one logical session record. If the alias is shared across
 * multiple active records, callers get an ambiguous response instead of a guess.
 */

import { randomUUID } from 'node:crypto';
import {
  addIndexEntry,
  buildRouteKey,
  dedupe,
  findMatchingRecords,
  hasStrongIdentifiers,
  indexKey,
  isNonEmptyString,
  isStrongSessionKey,
  looksLikeSessionKey,
  mergeRecords,
  mergeRouteMetadata,
  ObserveSessionParams,
  parseSessionKey,
  pickParsedRoute,
  pickPreferredParsedSession,
  pruneExpiredRoutes,
  removeIndexEntry,
  RouteObservation,
  selectRouteCandidates,
  SessionProvenanceSnapshot,
  SessionRecord,
  SessionRecordSnapshot,
  SessionTrackerOptions,
  sorted,
} from './session-tracker-helpers';

const DEFAULT_ROUTE_TTL_MS = 10 * 60 * 1000;

export type {
  ParsedSessionKey,
  SessionAliasSnapshot,
  SessionProvenanceSnapshot,
  SessionRecordSnapshot,
  SessionRouteMetadata,
  SessionTrackerOptions,
} from './session-tracker-helpers';

export class SessionTracker {
  private readonly routeTtlMs: number;
  private readonly now: () => number;
  private readonly records: Map<string, SessionRecord> = new Map();
  private readonly bySessionId: Map<string, Set<string>> = new Map();
  private readonly bySessionKey: Map<string, Set<string>> = new Map();
  private readonly byRunId: Map<string, Set<string>> = new Map();

  constructor(options?: SessionTrackerOptions) {
    this.routeTtlMs = options?.routeTtlMs ?? DEFAULT_ROUTE_TTL_MS;
    this.now = options?.now ?? (() => Date.now());
  }

  startSession(sessionKey: string, agentId?: string, parentSessionId?: string): void;
  startSession(params: {
    sessionId?: string;
    sessionKey?: string;
    aliasSessionIds?: string[];
    aliasSessionKeys?: string[];
    agentId?: string;
    parentAgentId?: string;
    parentSessionId?: string;
    parentSessionKey?: string;
    runId?: string;
    route?: import('./session-tracker-helpers').SessionRouteMetadata;
    direction?: 'inbound' | 'outbound' | 'internal';
  }): void;
  startSession(
    input:
      | string
      | {
          sessionId?: string;
          sessionKey?: string;
          aliasSessionIds?: string[];
          aliasSessionKeys?: string[];
          agentId?: string;
          parentAgentId?: string;
          parentSessionId?: string;
          parentSessionKey?: string;
          runId?: string;
          route?: import('./session-tracker-helpers').SessionRouteMetadata;
          direction?: 'inbound' | 'outbound' | 'internal';
        },
    agentIdArg?: string,
    parentSessionIdArg?: string,
  ): void {
    if (typeof input !== 'string' && (!input || typeof input !== 'object')) {
      throw new Error('Session key must be a non-empty string');
    }
    if (typeof input === 'string') {
      if (!isNonEmptyString(input)) {
        throw new Error('Session key must be a non-empty string');
      }
      this.observeSession({
        sessionKey: input,
        aliasSessionKeys: [input],
        agentId: agentIdArg,
        parentSessionId: parentSessionIdArg,
      });
      return;
    }

    if (!isNonEmptyString(input.sessionId) && !isNonEmptyString(input.sessionKey)) {
      throw new Error('Session key must be a non-empty string');
    }
    this.observeSession(input);
  }

  touchSession(params: ObserveSessionParams): void {
    this.observeSession(params);
  }

  endSession(sessionIdentifier: string): {
    durationMs: number;
    agentId?: string;
    sessionId?: string;
    sessionKey?: string;
    parentSessionId?: string;
  } | null {
    const record = this.resolveUniqueRecord({
      sessionId: sessionIdentifier,
      sessionKey: sessionIdentifier,
      aliasSessionIds: [sessionIdentifier],
      aliasSessionKeys: [sessionIdentifier],
    });

    if (!record || record.routeResolution === 'ambiguous') {
      return null;
    }

    this.removeRecord(record.record);
    return {
      durationMs: this.now() - record.record.startTime,
      agentId: record.record.agentId,
      sessionId: sorted(record.record.sessionIds)[0],
      sessionKey: sorted(record.record.sessionKeys)[0],
      parentSessionId: record.record.parentSessionId,
    };
  }

  getSession(sessionIdentifier?: string): SessionRecordSnapshot | null {
    if (!isNonEmptyString(sessionIdentifier)) {
      return null;
    }

    const resolved = this.resolveUniqueRecord({
      sessionId: sessionIdentifier,
      sessionKey: sessionIdentifier,
      aliasSessionIds: [sessionIdentifier],
      aliasSessionKeys: [sessionIdentifier],
    });
    if (!resolved || resolved.routeResolution === 'ambiguous') {
      return null;
    }

    return {
      agentId: resolved.record.agentId,
      parentSessionId: resolved.record.parentSessionId,
      durationMs: this.now() - resolved.record.startTime,
      sessionId: sorted(resolved.record.sessionIds)[0],
      sessionKey: sorted(resolved.record.sessionKeys)[0],
    };
  }

  getAgentIdBySession(params: { sessionId?: string; sessionKey?: string }): string | undefined {
    const candidates = findMatchingRecords(
      {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        aliasSessionIds: params.sessionId ? [params.sessionId] : [],
        aliasSessionKeys: params.sessionKey ? [params.sessionKey] : [],
      },
      {
        records: this.records,
        bySessionId: this.bySessionId,
        bySessionKey: this.bySessionKey,
        byRunId: this.byRunId,
      },
    );
    const agentIds = new Set(candidates.map((record) => record.agentId).filter(isNonEmptyString));
    return agentIds.size === 1 ? Array.from(agentIds)[0] : undefined;
  }

  getSessionProvenance(params: {
    sessionId?: string;
    sessionKey?: string;
    aliasSessionIds?: string[];
    aliasSessionKeys?: string[];
    runId?: string;
    nowMs?: number;
  }): SessionProvenanceSnapshot {
    const now = params.nowMs ?? this.now();
    const resolved = this.resolveUniqueRecord(params);
    const requestedParsedSession =
      parseSessionKey(params.sessionKey) ??
      parseSessionKey(params.aliasSessionKeys?.find(isNonEmptyString));

    if (!resolved) {
      return {
        sessionAliases: {
          sessionIds: dedupe([params.sessionId, ...(params.aliasSessionIds ?? [])]),
          sessionKeys: dedupe([
            params.sessionKey,
            ...(params.aliasSessionKeys ?? []),
            ...(params.aliasSessionIds ?? []).filter(looksLikeSessionKey),
          ]),
          routeKeys: [],
        },
        parsedSession: requestedParsedSession,
        routeResolution: 'unavailable',
      };
    }

    if (resolved.routeResolution === 'ambiguous') {
      const routeKeys = new Set<string>();
      const sessionIds = new Set<string>();
      const sessionKeys = new Set<string>();

      for (const record of resolved.matches) {
        pruneExpiredRoutes(record, this.routeTtlMs, now);
        for (const routeKey of record.routeObservations.keys()) {
          routeKeys.add(routeKey);
        }
        for (const sessionId of record.sessionIds) {
          sessionIds.add(sessionId);
        }
        for (const sessionKey of record.sessionKeys) {
          sessionKeys.add(sessionKey);
        }
      }

      return {
        sessionAliases: {
          sessionIds: sorted(sessionIds),
          sessionKeys: sorted(sessionKeys),
          routeKeys: sorted(routeKeys),
        },
        parsedSession: requestedParsedSession,
        routeResolution: 'ambiguous',
      };
    }

    const record = resolved.record;
    pruneExpiredRoutes(record, this.routeTtlMs, now);
    const routeCandidates = selectRouteCandidates(record, params.runId);
    const selectedParsedSession =
      (requestedParsedSession?.isThreadScoped || requestedParsedSession?.provider || requestedParsedSession?.surface
        ? requestedParsedSession
        : undefined) ??
      pickPreferredParsedSession(record) ??
      requestedParsedSession;

    return {
      agentId: record.agentId,
      parentAgentId: record.parentAgentId,
      parentSessionId: record.parentSessionId,
      parentSessionKey: record.parentSessionKey,
      sessionAliases: {
        sessionIds: sorted(record.sessionIds),
        sessionKeys: sorted(record.sessionKeys),
        routeKeys: sorted(record.routeObservations.keys()),
      },
      parsedSession: selectedParsedSession,
      route: routeCandidates.length === 1 ? routeCandidates[0]?.route : undefined,
      routeResolution:
        routeCandidates.length === 1
          ? 'resolved'
          : routeCandidates.length > 1
            ? 'ambiguous'
            : 'unavailable',
    };
  }

  getActiveSessions(): string[] {
    const sessions = new Set<string>();
    for (const record of this.records.values()) {
      for (const sessionId of record.sessionIds) {
        sessions.add(sessionId);
      }
      for (const sessionKey of record.sessionKeys) {
        sessions.add(sessionKey);
      }
    }
    return sorted(sessions);
  }

  getActiveSessionCount(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
    this.bySessionId.clear();
    this.bySessionKey.clear();
    this.byRunId.clear();
  }

  private observeSession(params: ObserveSessionParams): void {
    if (!hasStrongIdentifiers(params) && !(params.runId && this.byRunId.has(indexKey(params.runId)))) {
      return;
    }

    const now = params.nowMs ?? this.now();
    const resolved = this.resolveUniqueRecord(params);
    const record =
      resolved?.routeResolution === 'ambiguous' ? undefined : resolved?.record ?? this.createRecord(now);
    if (!record) {
      return;
    }

    const sessionIds = dedupe([params.sessionId, ...(params.aliasSessionIds ?? [])]);
    const sessionKeys = dedupe([
      params.sessionKey,
      ...(params.aliasSessionKeys ?? []),
      ...sessionIds.filter(looksLikeSessionKey),
    ]);

    for (const sessionId of sessionIds) {
      record.sessionIds.add(sessionId);
      addIndexEntry(this.bySessionId, sessionId, record.recordId);
    }
    for (const sessionKey of sessionKeys) {
      record.sessionKeys.add(sessionKey);
      addIndexEntry(this.bySessionKey, sessionKey, record.recordId);
      if (isStrongSessionKey(sessionKey)) {
        record.strongSessionKeys.add(sessionKey);
      }
    }
    if (isNonEmptyString(params.runId)) {
      record.runIds.add(params.runId);
      addIndexEntry(this.byRunId, params.runId, record.recordId);
    }

    record.lastTouchedAt = now;
    record.agentId = params.agentId ?? record.agentId;
    record.parentAgentId = params.parentAgentId ?? record.parentAgentId;
    record.parentSessionId = params.parentSessionId ?? record.parentSessionId;
    record.parentSessionKey = params.parentSessionKey ?? record.parentSessionKey;

    const observedRoute = mergeRouteMetadata(pickParsedRoute(sessionKeys), params.route);
    const routeKey = buildRouteKey(observedRoute);
    if (!routeKey || !observedRoute) {
      return;
    }

    const current = record.routeObservations.get(routeKey);
    const next: RouteObservation = {
      routeKey,
      route: mergeRouteMetadata(current?.route, observedRoute) ?? observedRoute,
      firstSeenAt: current?.firstSeenAt ?? now,
      lastSeenAt: now,
      lastInboundAt: current?.lastInboundAt,
      lastOutboundAt: current?.lastOutboundAt,
      runIds: new Set(current?.runIds ?? []),
    };
    if (isNonEmptyString(params.runId)) {
      next.runIds.add(params.runId);
    }
    if (params.direction === 'inbound') {
      next.lastInboundAt = now;
    }
    if (params.direction === 'outbound') {
      next.lastOutboundAt = now;
    }
    record.routeObservations.set(routeKey, next);
  }

  private resolveUniqueRecord(params: {
    sessionId?: string;
    sessionKey?: string;
    aliasSessionIds?: string[];
    aliasSessionKeys?: string[];
    runId?: string;
  }):
    | { record: SessionRecord; matches: SessionRecord[]; routeResolution: 'resolved' }
    | { matches: SessionRecord[]; routeResolution: 'ambiguous' }
    | undefined {
    const strongMatches = findMatchingRecords(params, {
      strongOnly: true,
      records: this.records,
      bySessionId: this.bySessionId,
      bySessionKey: this.bySessionKey,
      byRunId: this.byRunId,
    });
    if (strongMatches.length > 1) {
      return {
        record: this.mergeRecords(strongMatches),
        matches: strongMatches,
        routeResolution: 'resolved',
      };
    }
    if (strongMatches.length === 1) {
      return { record: strongMatches[0], matches: strongMatches, routeResolution: 'resolved' };
    }

    const weakMatches = findMatchingRecords(params, {
      strongOnly: false,
      records: this.records,
      bySessionId: this.bySessionId,
      bySessionKey: this.bySessionKey,
      byRunId: this.byRunId,
    });
    if (weakMatches.length > 1) {
      return { matches: weakMatches, routeResolution: 'ambiguous' };
    }
    if (weakMatches.length === 1) {
      return { record: weakMatches[0], matches: weakMatches, routeResolution: 'resolved' };
    }

    return undefined;
  }

  private createRecord(now: number): SessionRecord {
    const record: SessionRecord = {
      recordId: randomUUID(),
      startTime: now,
      lastTouchedAt: now,
      sessionIds: new Set<string>(),
      sessionKeys: new Set<string>(),
      strongSessionKeys: new Set<string>(),
      runIds: new Set<string>(),
      routeObservations: new Map<string, RouteObservation>(),
    };
    this.records.set(record.recordId, record);
    return record;
  }

  private mergeRecords(records: SessionRecord[]): SessionRecord {
    const primary = mergeRecords(records, {
      bySessionId: this.bySessionId,
      bySessionKey: this.bySessionKey,
      byRunId: this.byRunId,
    });
    for (const record of records.slice(1)) {
      this.removeRecord(record, primary.recordId);
    }
    return primary;
  }

  private removeRecord(record: SessionRecord, preserveRecordId?: string): void {
    this.records.delete(record.recordId);
    for (const sessionId of record.sessionIds) {
      removeIndexEntry(this.bySessionId, sessionId, record.recordId, preserveRecordId);
    }
    for (const sessionKey of record.sessionKeys) {
      removeIndexEntry(this.bySessionKey, sessionKey, record.recordId, preserveRecordId);
    }
    for (const runId of record.runIds) {
      removeIndexEntry(this.byRunId, runId, record.recordId, preserveRecordId);
    }
  }
}
