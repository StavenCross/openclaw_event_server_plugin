import { AgentSyntheticStatus } from '../events/types';

type SessionActivity = {
  sessionRef: string;
  lastActiveAt: number;
};

type AgentState = {
  sessions: Map<string, SessionActivity>;
  hasAgentError: boolean;
  isOffline: boolean;
  lastStatus?: AgentSyntheticStatus;
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export type AgentStatusTransition = {
  agentId: string;
  status: AgentSyntheticStatus;
  activity: string;
  activityDetail: string;
  reason: string;
  activeSessionCount: number;
  lastActiveAt?: string;
};

export class AgentStatusReducer {
  private readonly workingWindowMs: number;
  private readonly sleepingWindowMs: number;
  private readonly agents: Map<string, AgentState> = new Map();

  constructor(params?: { workingWindowMs?: number; sleepingWindowMs?: number }) {
    this.workingWindowMs = params?.workingWindowMs ?? 30_000;
    this.sleepingWindowMs = params?.sleepingWindowMs ?? 10 * 60_000;
  }

  observeActivity(agentId: string, sessionRef?: string, atMs?: number): void {
    const state = this.ensureAgent(agentId);
    if (!sessionRef) {
      return;
    }
    state.sessions.set(sessionRef, {
      sessionRef,
      lastActiveAt: atMs ?? Date.now(),
    });
    state.isOffline = false;
  }

  removeSession(agentId: string, sessionRef?: string): void {
    if (!sessionRef) {
      return;
    }
    const state = this.agents.get(agentId);
    if (!state) {
      return;
    }
    state.sessions.delete(sessionRef);
  }

  markAgentError(agentId: string, hasError: boolean): void {
    this.ensureAgent(agentId).hasAgentError = hasError;
  }

  markAgentOffline(agentId: string, isOffline: boolean): void {
    this.ensureAgent(agentId).isOffline = isOffline;
  }

  markAllOffline(): void {
    for (const state of this.agents.values()) {
      state.isOffline = true;
    }
  }

  evaluateTransitions(nowMs?: number): AgentStatusTransition[] {
    const now = nowMs ?? Date.now();
    const transitions: AgentStatusTransition[] = [];
    for (const [agentId, state] of this.agents.entries()) {
      const next = this.computeStatus(state, now);
      if (state.lastStatus !== next.status) {
        state.lastStatus = next.status;
        transitions.push({
          agentId,
          ...next,
        });
      }
    }
    return transitions;
  }

  clear(): void {
    this.agents.clear();
  }

  private ensureAgent(agentId: string): AgentState {
    const existing = this.agents.get(agentId);
    if (existing) {
      return existing;
    }
    const created: AgentState = {
      sessions: new Map(),
      hasAgentError: false,
      isOffline: false,
    };
    this.agents.set(agentId, created);
    return created;
  }

  private computeStatus(
    state: AgentState,
    nowMs: number,
  ): Omit<AgentStatusTransition, 'agentId'> {
    const latestActive = this.getLatestSessionActivity(state);
    const activeSessionCount = state.sessions.size;

    if (state.isOffline) {
      return {
        status: 'offline',
        activity: 'Offline',
        activityDetail: 'Agent unreachable',
        reason: 'offline',
        activeSessionCount,
        lastActiveAt: latestActive ? new Date(latestActive).toISOString() : undefined,
      };
    }

    if (state.hasAgentError) {
      return {
        status: 'error',
        activity: 'Error',
        activityDetail: 'Agent reported an error state',
        reason: 'agent-error',
        activeSessionCount,
        lastActiveAt: latestActive ? new Date(latestActive).toISOString() : undefined,
      };
    }

    if (latestActive === undefined) {
      return {
        status: 'sleeping',
        activity: 'Sleeping',
        activityDetail: 'No active sessions',
        reason: 'no-sessions',
        activeSessionCount,
        lastActiveAt: undefined,
      };
    }

    const ageMs = nowMs - latestActive;
    if (ageMs <= this.workingWindowMs) {
      return {
        status: 'working',
        activity: 'Working',
        activityDetail: 'Recent activity in one or more sessions',
        reason: 'recent-activity',
        activeSessionCount,
        lastActiveAt: new Date(latestActive).toISOString(),
      };
    }

    if (ageMs <= this.sleepingWindowMs) {
      return {
        status: 'idle',
        activity: 'Idle',
        activityDetail: `No recent events in the last ${formatDuration(this.workingWindowMs)}`,
        reason: 'idle-window',
        activeSessionCount,
        lastActiveAt: new Date(latestActive).toISOString(),
      };
    }

    return {
      status: 'sleeping',
      activity: 'Sleeping',
      activityDetail: `No events in the last ${formatDuration(this.sleepingWindowMs)}`,
      reason: 'sleeping-window',
      activeSessionCount,
      lastActiveAt: new Date(latestActive).toISOString(),
    };
  }

  private getLatestSessionActivity(state: AgentState): number | undefined {
    let latest: number | undefined;
    for (const session of state.sessions.values()) {
      if (latest === undefined || session.lastActiveAt > latest) {
        latest = session.lastActiveAt;
      }
    }
    return latest;
  }
}
