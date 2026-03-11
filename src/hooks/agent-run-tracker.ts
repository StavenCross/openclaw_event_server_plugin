/**
 * Lightweight tracking for modern agent run lifecycle hooks.
 *
 * OpenClaw exposes pre-model and pre-prompt hook inputs, but it does not expose
 * the merged mutation result object back to observer plugins. This tracker keeps
 * enough phase input state to derive useful "what changed by the time the model
 * request was sent" metadata without persisting raw content longer than needed.
 */

type AgentRunSnapshot = {
  beforeModelResolvePromptLength?: number;
  beforePromptBuildPromptLength?: number;
  beforePromptBuildMessageCount?: number;
};

function toTrackerKey(params: { runId?: string; sessionId?: string; sessionKey?: string }): string | undefined {
  if (params.runId && params.runId.trim() !== '') {
    return `run:${params.runId}`;
  }
  if (params.sessionId && params.sessionId.trim() !== '') {
    return `session:${params.sessionId}`;
  }
  if (params.sessionKey && params.sessionKey.trim() !== '') {
    return `session-key:${params.sessionKey}`;
  }
  return undefined;
}

export class AgentRunTracker {
  private snapshots: Map<string, AgentRunSnapshot> = new Map();

  observeBeforeModelResolve(params: {
    runId?: string;
    sessionId?: string;
    sessionKey?: string;
    promptLength: number;
  }): void {
    const key = toTrackerKey(params);
    if (!key) {
      return;
    }

    const current = this.snapshots.get(key) ?? {};
    current.beforeModelResolvePromptLength = params.promptLength;
    this.snapshots.set(key, current);
  }

  observeBeforePromptBuild(params: {
    runId?: string;
    sessionId?: string;
    sessionKey?: string;
    promptLength: number;
    messageCount: number;
  }): void {
    const key = toTrackerKey(params);
    if (!key) {
      return;
    }

    const current = this.snapshots.get(key) ?? {};
    current.beforePromptBuildPromptLength = params.promptLength;
    current.beforePromptBuildMessageCount = params.messageCount;
    this.snapshots.set(key, current);
  }

  getSnapshot(params: { runId?: string; sessionId?: string; sessionKey?: string }): AgentRunSnapshot | undefined {
    const key = toTrackerKey(params);
    return key ? this.snapshots.get(key) : undefined;
  }

  clearSnapshot(params: { runId?: string; sessionId?: string; sessionKey?: string }): void {
    const key = toTrackerKey(params);
    if (key) {
      this.snapshots.delete(key);
    }
  }

  clear(): void {
    this.snapshots.clear();
  }
}
