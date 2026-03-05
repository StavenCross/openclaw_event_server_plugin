export type SubagentRecord = {
  subagentKey: string;
  childSessionKey: string;
  parentAgentId?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  childAgentId?: string;
  runId?: string;
  mode?: string;
  spawnedAt: number;
  lastActiveAt: number;
  idleEmittedAt?: number;
  endedAt?: number;
};

export class SubagentTracker {
  private readonly byChildSessionKey: Map<string, SubagentRecord> = new Map();

  registerSpawn(params: {
    childSessionKey: string;
    parentAgentId?: string;
    parentSessionId?: string;
    parentSessionKey?: string;
    childAgentId?: string;
    runId?: string;
    mode?: string;
    nowMs?: number;
  }): SubagentRecord {
    const now = params.nowMs ?? Date.now();
    const current = this.byChildSessionKey.get(params.childSessionKey);
    const merged: SubagentRecord = {
      subagentKey: params.childSessionKey,
      childSessionKey: params.childSessionKey,
      parentAgentId: params.parentAgentId ?? current?.parentAgentId,
      parentSessionId: params.parentSessionId ?? current?.parentSessionId,
      parentSessionKey: params.parentSessionKey ?? current?.parentSessionKey,
      childAgentId: params.childAgentId ?? current?.childAgentId,
      runId: params.runId ?? current?.runId,
      mode: params.mode ?? current?.mode,
      spawnedAt: current?.spawnedAt ?? now,
      lastActiveAt: now,
      idleEmittedAt: undefined,
      endedAt: undefined,
    };
    this.byChildSessionKey.set(params.childSessionKey, merged);
    return merged;
  }

  observeActivity(childSessionKey?: string, atMs?: number): void {
    if (!childSessionKey) {
      return;
    }
    const current = this.byChildSessionKey.get(childSessionKey);
    if (!current || current.endedAt) {
      return;
    }
    current.lastActiveAt = atMs ?? Date.now();
    current.idleEmittedAt = undefined;
  }

  markEnded(childSessionKey?: string, atMs?: number): void {
    if (!childSessionKey) {
      return;
    }
    const current = this.byChildSessionKey.get(childSessionKey);
    if (!current) {
      return;
    }
    current.endedAt = atMs ?? Date.now();
  }

  getByChildSessionKey(childSessionKey?: string): SubagentRecord | undefined {
    if (!childSessionKey) {
      return undefined;
    }
    return this.byChildSessionKey.get(childSessionKey);
  }

  evaluateIdleTransitions(idleAfterMs: number, nowMs?: number): SubagentRecord[] {
    const now = nowMs ?? Date.now();
    const transitions: SubagentRecord[] = [];

    for (const record of this.byChildSessionKey.values()) {
      if (record.endedAt !== undefined || record.idleEmittedAt !== undefined) {
        continue;
      }
      if (now - record.lastActiveAt < idleAfterMs) {
        continue;
      }
      record.idleEmittedAt = now;
      transitions.push({ ...record });
    }

    return transitions;
  }

  clear(): void {
    this.byChildSessionKey.clear();
  }
}
