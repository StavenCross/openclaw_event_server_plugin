/**
 * Shared types and helper routines for session tracking.
 *
 * Keeping these pure helpers separate keeps the tracker class readable while
 * preserving a single place for the session-key parsing and ambiguity rules.
 */

export interface ParsedSessionKey {
  raw: string;
  agentId?: string;
  provider?: string;
  surface?: string;
  accountId?: string;
  scope?: string;
  threadKind?: string;
  threadToken?: string;
  isThreadScoped: boolean;
}

export interface SessionRouteMetadata {
  provider?: string;
  surface?: string;
  accountId?: string;
  channelId?: string;
  conversationId?: string;
  threadId?: string;
  messageId?: string;
  from?: string;
  to?: string;
  senderId?: string;
  senderName?: string;
}

export interface SessionAliasSnapshot {
  sessionIds: string[];
  sessionKeys: string[];
  routeKeys: string[];
}

export interface SessionProvenanceSnapshot {
  agentId?: string;
  parentAgentId?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  sessionAliases: SessionAliasSnapshot;
  parsedSession?: ParsedSessionKey;
  route?: SessionRouteMetadata;
  routeResolution: 'resolved' | 'ambiguous' | 'unavailable';
}

export interface SessionTrackerOptions {
  routeTtlMs?: number;
  now?: () => number;
}

export interface SessionRecordSnapshot {
  agentId?: string;
  parentSessionId?: string;
  durationMs: number;
  sessionId?: string;
  sessionKey?: string;
}

export interface RouteObservation {
  routeKey: string;
  route: SessionRouteMetadata;
  firstSeenAt: number;
  lastSeenAt: number;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  runIds: Set<string>;
}

export interface SessionRecord {
  recordId: string;
  startTime: number;
  lastTouchedAt: number;
  agentId?: string;
  parentAgentId?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  sessionIds: Set<string>;
  sessionKeys: Set<string>;
  strongSessionKeys: Set<string>;
  runIds: Set<string>;
  routeObservations: Map<string, RouteObservation>;
}

export interface ObserveSessionParams {
  sessionId?: string;
  sessionKey?: string;
  aliasSessionIds?: string[];
  aliasSessionKeys?: string[];
  agentId?: string;
  parentAgentId?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  runId?: string;
  route?: SessionRouteMetadata;
  direction?: 'inbound' | 'outbound' | 'internal';
  nowMs?: number;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function dedupe(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter(isNonEmptyString)));
}

export function sorted(values: Iterable<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

export function indexKey(value: string): string {
  return value;
}

export function mergeRouteMetadata(
  base?: SessionRouteMetadata,
  override?: SessionRouteMetadata,
): SessionRouteMetadata | undefined {
  const merged: SessionRouteMetadata = {
    provider: override?.provider ?? base?.provider,
    surface: override?.surface ?? base?.surface,
    accountId: override?.accountId ?? base?.accountId,
    channelId: override?.channelId ?? base?.channelId,
    conversationId: override?.conversationId ?? base?.conversationId,
    threadId: override?.threadId ?? base?.threadId,
    messageId: override?.messageId ?? base?.messageId,
    from: override?.from ?? base?.from,
    to: override?.to ?? base?.to,
    senderId: override?.senderId ?? base?.senderId,
    senderName: override?.senderName ?? base?.senderName,
  };

  return Object.values(merged).some((value) => value !== undefined) ? merged : undefined;
}

export function routeFromParsedSession(parsed?: ParsedSessionKey): SessionRouteMetadata | undefined {
  if (!parsed) {
    return undefined;
  }

  const route: SessionRouteMetadata = {
    provider: parsed.provider,
    surface: parsed.surface,
    accountId: parsed.accountId,
    threadId: parsed.threadToken,
  };

  return Object.values(route).some((value) => value !== undefined) ? route : undefined;
}

export function buildRouteKey(route?: SessionRouteMetadata): string | undefined {
  if (!route) {
    return undefined;
  }

  const parts = [
    ['provider', route.provider],
    ['surface', route.surface],
    ['accountId', route.accountId],
    ['channelId', route.channelId],
    ['conversationId', route.conversationId],
    ['threadId', route.threadId],
  ]
    .filter((entry): entry is [string, string] => isNonEmptyString(entry[1]))
    .map(([key, value]) => `${key}=${value}`);

  return parts.length > 0 ? parts.join('|') : undefined;
}

export function looksLikeSessionKey(value?: string): boolean {
  return isNonEmptyString(value) && value.startsWith('agent:');
}

export function parseSessionKey(sessionKey?: string): ParsedSessionKey | undefined {
  if (!isNonEmptyString(sessionKey)) {
    return undefined;
  }

  const segments = sessionKey.split(':');
  if (segments[0] !== 'agent' || segments.length < 2) {
    return {
      raw: sessionKey,
      isThreadScoped: false,
    };
  }

  if (segments.length === 3) {
    return {
      raw: sessionKey,
      agentId: segments[1],
      scope: segments[2],
      isThreadScoped: false,
    };
  }

  const scope = segments[5];
  const threadToken = segments[6];
  const threadKind = scope === 'thread' || scope === 'topic' ? scope : undefined;

  return {
    raw: sessionKey,
    agentId: segments[1],
    provider: segments[2],
    surface: segments[3],
    accountId: segments[4],
    scope,
    threadKind,
    threadToken,
    isThreadScoped: threadKind !== undefined && isNonEmptyString(threadToken),
  };
}

export function isSharedRuntimeSessionKey(sessionKey?: string): boolean {
  const parsed = parseSessionKey(sessionKey);
  return parsed?.scope === 'main' && parsed.provider === undefined;
}

export function isStrongSessionKey(sessionKey?: string): boolean {
  return isNonEmptyString(sessionKey) && !isSharedRuntimeSessionKey(sessionKey);
}

export function hasStrongIdentifiers(params: {
  sessionId?: string;
  sessionKey?: string;
  aliasSessionIds?: string[];
  aliasSessionKeys?: string[];
}): boolean {
  if (isNonEmptyString(params.sessionId)) {
    return true;
  }
  if (isStrongSessionKey(params.sessionKey)) {
    return true;
  }
  if ((params.aliasSessionIds ?? []).some(isNonEmptyString)) {
    return true;
  }
  return (params.aliasSessionKeys ?? []).some(isStrongSessionKey);
}

export function findMatchingRecords(params: {
  sessionId?: string;
  sessionKey?: string;
  aliasSessionIds?: string[];
  aliasSessionKeys?: string[];
  runId?: string;
}, options: {
  strongOnly?: boolean;
  records: Map<string, SessionRecord>;
  bySessionId: Map<string, Set<string>>;
  bySessionKey: Map<string, Set<string>>;
  byRunId: Map<string, Set<string>>;
}): SessionRecord[] {
  /**
   * Resolve strong identifiers first and keep weak runtime aliases in a separate
   * lane. Shared aliases such as `agent:<agentId>:main` are useful breadcrumbs,
   * but they are not safe enough to collapse concurrent sessions on their own.
   */
  const recordIds = new Set<string>();
  const sessionIds = dedupe([params.sessionId, ...(params.aliasSessionIds ?? [])]);
  const sessionKeys = dedupe([
    params.sessionKey,
    ...(params.aliasSessionKeys ?? []),
    ...sessionIds.filter(looksLikeSessionKey),
  ]);

  for (const sessionId of sessionIds) {
    if (options.strongOnly === false) {
      continue;
    }
    collectIndexEntries(options.bySessionId, sessionId, recordIds);
  }

  for (const sessionKey of sessionKeys) {
    if (options.strongOnly === true && !isStrongSessionKey(sessionKey)) {
      continue;
    }
    if (options.strongOnly === false && isStrongSessionKey(sessionKey)) {
      continue;
    }
    collectIndexEntries(options.bySessionKey, sessionKey, recordIds);
  }

  if (options.strongOnly !== false && isNonEmptyString(params.runId)) {
    collectIndexEntries(options.byRunId, params.runId, recordIds);
  }

  return Array.from(recordIds)
    .map((recordId) => options.records.get(recordId))
    .filter((record): record is SessionRecord => record !== undefined);
}

export function pickPreferredParsedSession(record: SessionRecord): ParsedSessionKey | undefined {
  const threadScoped = Array.from(record.sessionKeys)
    .map((sessionKey) => parseSessionKey(sessionKey))
    .find((parsed) => parsed?.isThreadScoped);
  if (threadScoped) {
    return threadScoped;
  }

  const strong = Array.from(record.strongSessionKeys)
    .map((sessionKey) => parseSessionKey(sessionKey))
    .find(Boolean);
  return strong;
}

export function pickParsedRoute(sessionKeys: string[]): SessionRouteMetadata | undefined {
  const parsed = sessionKeys
    .map((sessionKey) => parseSessionKey(sessionKey))
    .find((candidate) => Boolean(candidate?.isThreadScoped ?? candidate?.provider ?? candidate?.surface));
  return routeFromParsedSession(parsed);
}

export function selectRouteCandidates(record: SessionRecord, runId?: string): RouteObservation[] {
  const observations = Array.from(record.routeObservations.values());
  if (isNonEmptyString(runId)) {
    /**
     * A matching runId is the safest tie-breaker available once multiple route
     * observations exist for one logical record. If no observation saw the runId,
     * the caller must inspect the full set and decide whether the result is still
     * unique or should be treated as ambiguous.
     */
    const byRun = observations.filter((observation) => observation.runIds.has(runId));
    if (byRun.length > 0) {
      return byRun;
    }
  }
  return observations;
}

export function pruneExpiredRoutes(record: SessionRecord, routeTtlMs: number, now: number): void {
  for (const [routeKey, observation] of record.routeObservations.entries()) {
    if (now - observation.lastSeenAt > routeTtlMs) {
      record.routeObservations.delete(routeKey);
    }
  }
}

export function mergeRecords(
  records: SessionRecord[],
  indexes: {
    bySessionId: Map<string, Set<string>>;
    bySessionKey: Map<string, Set<string>>;
    byRunId: Map<string, Set<string>>;
  },
): SessionRecord {
  const [primary, ...rest] = records;
  for (const record of rest) {
    /**
     * Record merging is only safe after a strong identifier match or an explicit
     * runId tie-break. Weak-alias-only matches should never arrive here; they must
     * stay ambiguous so later tool events omit route/thread provenance instead of
     * silently borrowing it from the wrong conversation.
     */
    for (const sessionId of record.sessionIds) {
      primary.sessionIds.add(sessionId);
      addIndexEntry(indexes.bySessionId, sessionId, primary.recordId);
    }
    for (const sessionKey of record.sessionKeys) {
      primary.sessionKeys.add(sessionKey);
      addIndexEntry(indexes.bySessionKey, sessionKey, primary.recordId);
    }
    for (const strongSessionKey of record.strongSessionKeys) {
      primary.strongSessionKeys.add(strongSessionKey);
    }
    for (const runId of record.runIds) {
      primary.runIds.add(runId);
      addIndexEntry(indexes.byRunId, runId, primary.recordId);
    }
    for (const [routeKey, observation] of record.routeObservations.entries()) {
      const current = primary.routeObservations.get(routeKey);
      primary.routeObservations.set(routeKey, {
        routeKey,
        route: mergeRouteMetadata(current?.route, observation.route) ?? observation.route,
        firstSeenAt: Math.min(current?.firstSeenAt ?? observation.firstSeenAt, observation.firstSeenAt),
        lastSeenAt: Math.max(current?.lastSeenAt ?? observation.lastSeenAt, observation.lastSeenAt),
        lastInboundAt: Math.max(current?.lastInboundAt ?? 0, observation.lastInboundAt ?? 0) || undefined,
        lastOutboundAt: Math.max(current?.lastOutboundAt ?? 0, observation.lastOutboundAt ?? 0) || undefined,
        runIds: new Set([...(current?.runIds ?? []), ...observation.runIds]),
      });
    }

    primary.agentId = primary.agentId ?? record.agentId;
    primary.parentAgentId = primary.parentAgentId ?? record.parentAgentId;
    primary.parentSessionId = primary.parentSessionId ?? record.parentSessionId;
    primary.parentSessionKey = primary.parentSessionKey ?? record.parentSessionKey;
    primary.lastTouchedAt = Math.max(primary.lastTouchedAt, record.lastTouchedAt);
  }
  return primary;
}

export function addIndexEntry(index: Map<string, Set<string>>, key: string, recordId: string): void {
  const lookupKey = indexKey(key);
  const current = index.get(lookupKey) ?? new Set<string>();
  current.add(recordId);
  index.set(lookupKey, current);
}

export function collectIndexEntries(index: Map<string, Set<string>>, key: string, target: Set<string>): void {
  const current = index.get(indexKey(key));
  if (!current) {
    return;
  }
  for (const recordId of current) {
    target.add(recordId);
  }
}

export function removeIndexEntry(
  index: Map<string, Set<string>>,
  key: string,
  recordId: string,
  preserveRecordId?: string,
): void {
  const lookupKey = indexKey(key);
  const current = index.get(lookupKey);
  if (!current) {
    return;
  }
  current.delete(recordId);
  if (preserveRecordId) {
    current.add(preserveRecordId);
  }
  if (current.size === 0) {
    index.delete(lookupKey);
  } else {
    index.set(lookupKey, current);
  }
}
