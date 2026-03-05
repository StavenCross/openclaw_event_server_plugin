/**
 * Tool event hooks implementation.
 */

import { ToolEvent } from '../events/types';
import { createCanonicalEvent } from './event-factory';
import { randomUUID } from 'node:crypto';

/**
 * Create a tool.called event
 */
export function createToolCalledEvent(context: {
  toolName: string;
  params?: Record<string, unknown>;
  agentId?: string;
  parentAgentId?: string;
  subagentKey?: string;
  sessionId?: string;
  sessionKey?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  runId?: string;
  toolCallId?: string;
  correlationId?: string;
}): ToolEvent {
  return createCanonicalEvent({
    type: 'tool.called',
    eventCategory: 'tool',
    eventName: 'before_tool_call',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    toolCallId: context.toolCallId,
    correlationId: context.correlationId,
    data: {
      toolName: context.toolName,
      params: context.params,
      agentId: context.agentId,
      parentAgentId: context.parentAgentId,
      subagentKey: context.subagentKey,
      parentSessionId: context.parentSessionId,
      parentSessionKey: context.parentSessionKey,
    },
  });
}

/**
 * Create a tool.completed event
 */
export function createToolCompletedEvent(context: {
  toolName: string;
  result?: unknown;
  durationMs?: number;
  agentId?: string;
  parentAgentId?: string;
  subagentKey?: string;
  sessionId?: string;
  sessionKey?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  runId?: string;
  toolCallId?: string;
  correlationId?: string;
}): ToolEvent {
  return createCanonicalEvent({
    type: 'tool.completed',
    eventCategory: 'tool',
    eventName: 'after_tool_call',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    toolCallId: context.toolCallId,
    correlationId: context.correlationId,
    result: context.result,
    data: {
      toolName: context.toolName,
      durationMs: context.durationMs,
      agentId: context.agentId,
      parentAgentId: context.parentAgentId,
      subagentKey: context.subagentKey,
      parentSessionId: context.parentSessionId,
      parentSessionKey: context.parentSessionKey,
      result: context.result,
    },
  });
}

export function createToolGuardEvent(context: {
  type: 'tool.guard.matched' | 'tool.guard.allowed' | 'tool.guard.blocked';
  toolName: string;
  params?: Record<string, unknown>;
  blockReason?: string;
  matchedRuleId?: string;
  matchedActionId?: string;
  decisionSource?: string;
  agentId?: string;
  parentAgentId?: string;
  subagentKey?: string;
  sessionId?: string;
  sessionKey?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  runId?: string;
  toolCallId?: string;
  correlationId?: string;
}): ToolEvent {
  return createCanonicalEvent({
    type: context.type,
    eventCategory: 'tool',
    eventName: 'before_tool_call',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    toolCallId: context.toolCallId,
    correlationId: context.correlationId,
    data: {
      toolName: context.toolName,
      params: context.params,
      blockReason: context.blockReason,
      matchedRuleId: context.matchedRuleId,
      matchedActionId: context.matchedActionId,
      decisionSource: context.decisionSource,
      agentId: context.agentId,
      parentAgentId: context.parentAgentId,
      subagentKey: context.subagentKey,
      parentSessionId: context.parentSessionId,
      parentSessionKey: context.parentSessionKey,
    },
  });
}

/**
 * Create a tool.error event
 */
export function createToolErrorEvent(context: {
  toolName: string;
  error: string;
  stackTrace?: string;
  params?: Record<string, unknown>;
  agentId?: string;
  parentAgentId?: string;
  subagentKey?: string;
  sessionId?: string;
  sessionKey?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  runId?: string;
  toolCallId?: string;
  correlationId?: string;
}): ToolEvent {
  return createCanonicalEvent({
    type: 'tool.error',
    eventCategory: 'tool',
    eventName: 'after_tool_call',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    toolCallId: context.toolCallId,
    correlationId: context.correlationId,
    error: {
      message: context.error,
      stack: context.stackTrace,
      kind: 'tool',
    },
    data: {
      toolName: context.toolName,
      params: context.params,
      agentId: context.agentId,
      parentAgentId: context.parentAgentId,
      subagentKey: context.subagentKey,
      parentSessionId: context.parentSessionId,
      parentSessionKey: context.parentSessionKey,
      error: context.error,
      stackTrace: context.stackTrace,
    },
  });
}

/**
 * Create a tool.result_persist event
 */
export function createToolResultPersistEvent(context: {
  toolName?: string;
  toolCallId?: string;
  message?: unknown;
  isSynthetic?: boolean;
  agentId?: string;
  parentAgentId?: string;
  subagentKey?: string;
  sessionId?: string;
  sessionKey?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  correlationId?: string;
}): ToolEvent {
  return createCanonicalEvent({
    type: 'tool.result_persist',
    eventCategory: 'tool',
    eventName: 'tool_result_persist',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    toolCallId: context.toolCallId,
    correlationId: context.correlationId,
    data: {
      toolName: context.toolName,
      toolCallId: context.toolCallId,
      message: context.message,
      isSynthetic: context.isSynthetic,
      agentId: context.agentId,
      parentAgentId: context.parentAgentId,
      subagentKey: context.subagentKey,
      parentSessionId: context.parentSessionId,
      parentSessionKey: context.parentSessionKey,
    },
  });
}

/**
 * Track tool call timing and correlation.
 */
export class ToolCallTracker {
  private activeCalls: Map<
    string,
    {
      startTime: number;
      toolName: string;
      params?: Record<string, unknown>;
      runId?: string;
      toolCallId?: string;
      sessionId?: string;
      sessionKey?: string;
      agentId?: string;
      correlationId?: string;
    }
  > = new Map();

  startCall(
    toolName: string,
    params?: Record<string, unknown>,
    context?: {
      runId?: string;
      toolCallId?: string;
      sessionId?: string;
      sessionKey?: string;
      agentId?: string;
      correlationId?: string;
    },
  ): string {
    if (!toolName || typeof toolName !== 'string') {
      throw new Error('Tool name must be a non-empty string');
    }
    const callId = context?.toolCallId ?? randomUUID();
    this.activeCalls.set(callId, {
      startTime: Date.now(),
      toolName,
      params,
      ...context,
    });
    return callId;
  }

  endCall(callId: string): {
    durationMs: number;
    toolName: string;
    params?: Record<string, unknown>;
    runId?: string;
    toolCallId?: string;
    sessionId?: string;
    sessionKey?: string;
    agentId?: string;
    correlationId?: string;
  } | null {
    const call = this.activeCalls.get(callId);
    if (!call) {
      return null;
    }
    this.activeCalls.delete(callId);
    return {
      durationMs: Date.now() - call.startTime,
      toolName: call.toolName,
      params: call.params,
      runId: call.runId,
      toolCallId: call.toolCallId,
      sessionId: call.sessionId,
      sessionKey: call.sessionKey,
      agentId: call.agentId,
      correlationId: call.correlationId,
    };
  }

  getCall(callId: string): {
    toolName: string;
    params?: Record<string, unknown>;
    runId?: string;
    toolCallId?: string;
    sessionId?: string;
    sessionKey?: string;
    agentId?: string;
    correlationId?: string;
  } | null {
    const call = this.activeCalls.get(callId);
    if (!call) {
      return null;
    }
    return {
      toolName: call.toolName,
      params: call.params,
      runId: call.runId,
      toolCallId: call.toolCallId,
      sessionId: call.sessionId,
      sessionKey: call.sessionKey,
      agentId: call.agentId,
      correlationId: call.correlationId,
    };
  }

  getActiveCallCount(): number {
    return this.activeCalls.size;
  }

  clear(): void {
    this.activeCalls.clear();
  }
}
