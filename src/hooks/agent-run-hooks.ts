/**
 * Agent run lifecycle hook builders.
 *
 * These events mirror the modern OpenClaw typed hook surface around model
 * resolution, prompt construction, model I/O, and run completion. Keep the
 * payloads close to upstream names so downstream systems can reason about the
 * OpenClaw lifecycle without needing to know the raw hook APIs.
 */

import { AgentEvent } from '../events/types';
import { createCanonicalEvent } from './event-factory';
import {
  buildAgentEndData,
  buildBeforeModelResolveData,
  buildBeforePromptBuildData,
  buildLlmInputData,
  buildLlmOutputData,
} from './modern-lifecycle-payloads';
import type { ModernLifecyclePrivacyConfig } from '../config';

export function createBeforeModelResolveEvent(context: {
  prompt: string;
  privacy: ModernLifecyclePrivacyConfig;
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}): AgentEvent {
  return createCanonicalEvent({
    type: 'agent.before_model_resolve',
    eventCategory: 'agent',
    eventName: 'before_model_resolve',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    correlationId: context.correlationId,
    data: buildBeforeModelResolveData(context.prompt, context.privacy),
    metadata: context.metadata,
  });
}

export function createBeforePromptBuildEvent(context: {
  prompt: string;
  messages: unknown[];
  privacy: ModernLifecyclePrivacyConfig;
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}): AgentEvent {
  return createCanonicalEvent({
    type: 'agent.before_prompt_build',
    eventCategory: 'agent',
    eventName: 'before_prompt_build',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    correlationId: context.correlationId,
    data: buildBeforePromptBuildData({
      prompt: context.prompt,
      messages: context.messages,
      privacy: context.privacy,
    }),
    metadata: context.metadata,
  });
}

export function createLlmInputEvent(context: {
  runId?: string;
  sessionId: string;
  provider: string;
  model: string;
  prompt: string;
  historyMessages: unknown[];
  imagesCount: number;
  privacy: ModernLifecyclePrivacyConfig;
  systemPrompt?: string;
  audit?: {
    promptChangedFromBeforePromptBuild?: boolean;
    promptLengthDeltaFromBeforePromptBuild?: number;
    promptLengthDeltaFromBeforeModelResolve?: number;
    historyMessageCountDeltaFromBeforePromptBuild?: number;
  };
  agentId?: string;
  sessionKey?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}): AgentEvent {
  return createCanonicalEvent({
    type: 'agent.llm_input',
    eventCategory: 'agent',
    eventName: 'llm_input',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    correlationId: context.correlationId,
    data: buildLlmInputData({
      provider: context.provider,
      model: context.model,
      systemPrompt: context.systemPrompt,
      prompt: context.prompt,
      historyMessages: context.historyMessages,
      imagesCount: context.imagesCount,
      privacy: context.privacy,
      audit: context.audit,
    }),
    metadata: context.metadata,
  });
}

export function createLlmOutputEvent(context: {
  runId?: string;
  sessionId: string;
  provider: string;
  model: string;
  assistantTexts: string[];
  privacy: ModernLifecyclePrivacyConfig;
  lastAssistant?: unknown;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  agentId?: string;
  sessionKey?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}): AgentEvent {
  return createCanonicalEvent({
    type: 'agent.llm_output',
    eventCategory: 'agent',
    eventName: 'llm_output',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    correlationId: context.correlationId,
    data: buildLlmOutputData({
      provider: context.provider,
      model: context.model,
      assistantTexts: context.assistantTexts,
      lastAssistant: context.lastAssistant,
      usage: context.usage,
      privacy: context.privacy,
    }),
    metadata: context.metadata,
  });
}

export function createAgentEndEvent(context: {
  messages: unknown[];
  success: boolean;
  privacy: ModernLifecyclePrivacyConfig;
  error?: string;
  durationMs?: number;
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}): AgentEvent {
  return createCanonicalEvent({
    type: 'agent.end',
    eventCategory: 'agent',
    eventName: 'agent_end',
    source: 'plugin-hook',
    agentId: context.agentId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    correlationId: context.correlationId,
    error: context.success || !context.error ? undefined : { message: context.error, kind: 'agent' },
    data: buildAgentEndData({
      messages: context.messages,
      success: context.success,
      error: context.error,
      durationMs: context.durationMs,
      privacy: context.privacy,
    }),
    metadata: context.metadata,
  });
}
