/**
 * Payload shaping helpers for modern lifecycle events.
 *
 * These hooks can expose raw prompts, model outputs, and transcript messages.
 * The plugin defaults to metadata-only payloads so operators opt in before that
 * content is shipped to logs, webhooks, or websocket consumers.
 */

import type { ModernLifecyclePrivacyConfig } from '../config';

function summarizeMessageRoles(messages: unknown[]): Record<string, number> | undefined {
  if (messages.length === 0) {
    return undefined;
  }

  const counts: Record<string, number> = {};
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) {
      counts.unknown = (counts.unknown ?? 0) + 1;
      continue;
    }

    const role = (message as { role?: unknown }).role;
    const normalizedRole = typeof role === 'string' && role.trim() !== '' ? role : 'unknown';
    counts[normalizedRole] = (counts[normalizedRole] ?? 0) + 1;
  }

  return counts;
}

function buildPromptMetrics(prompt: string): { promptLength: number } {
  return {
    promptLength: prompt.length,
  };
}

function buildAssistantTextLengths(assistantTexts: string[]): number[] | undefined {
  if (assistantTexts.length === 0) {
    return undefined;
  }
  return assistantTexts.map((value) => value.length);
}

export function buildBeforeModelResolveData(
  prompt: string,
  privacy: ModernLifecyclePrivacyConfig,
): Record<string, unknown> {
  return privacy.payloadMode === 'full'
    ? {
        prompt,
        ...buildPromptMetrics(prompt),
      }
    : buildPromptMetrics(prompt);
}

export function buildBeforePromptBuildData(params: {
  prompt: string;
  messages: unknown[];
  privacy: ModernLifecyclePrivacyConfig;
}): Record<string, unknown> {
  const roleSummary = summarizeMessageRoles(params.messages);
  const shared = {
    ...buildPromptMetrics(params.prompt),
    messageCount: params.messages.length,
    ...(roleSummary ? { messageRoles: roleSummary } : {}),
  };

  return params.privacy.payloadMode === 'full'
    ? {
        prompt: params.prompt,
        messages: params.messages,
        ...shared,
      }
    : shared;
}

export function buildLlmInputData(params: {
  provider: string;
  model: string;
  systemPrompt?: string;
  prompt: string;
  historyMessages: unknown[];
  imagesCount: number;
  privacy: ModernLifecyclePrivacyConfig;
  audit?: {
    promptChangedFromBeforePromptBuild?: boolean;
    promptLengthDeltaFromBeforePromptBuild?: number;
    promptLengthDeltaFromBeforeModelResolve?: number;
    historyMessageCountDeltaFromBeforePromptBuild?: number;
  };
}): Record<string, unknown> {
  const roleSummary = summarizeMessageRoles(params.historyMessages);
  const shared = {
    provider: params.provider,
    model: params.model,
    ...buildPromptMetrics(params.prompt),
    historyMessageCount: params.historyMessages.length,
    imagesCount: params.imagesCount,
    hasSystemPrompt: typeof params.systemPrompt === 'string' && params.systemPrompt.length > 0,
    ...(roleSummary ? { historyMessageRoles: roleSummary } : {}),
    ...(params.audit ?? {}),
  };

  return params.privacy.payloadMode === 'full'
    ? {
        ...shared,
        systemPrompt: params.systemPrompt,
        prompt: params.prompt,
        historyMessages: params.historyMessages,
      }
    : shared;
}

export function buildLlmOutputData(params: {
  provider: string;
  model: string;
  assistantTexts: string[];
  lastAssistant?: unknown;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  privacy: ModernLifecyclePrivacyConfig;
}): Record<string, unknown> {
  const shared = {
    provider: params.provider,
    model: params.model,
    assistantTextCount: params.assistantTexts.length,
    hasLastAssistant: params.lastAssistant !== undefined,
    ...(params.usage ? { usage: params.usage } : {}),
    ...(buildAssistantTextLengths(params.assistantTexts)
      ? { assistantTextLengths: buildAssistantTextLengths(params.assistantTexts) }
      : {}),
  };

  return params.privacy.payloadMode === 'full'
    ? {
        ...shared,
        assistantTexts: params.assistantTexts,
        lastAssistant: params.lastAssistant,
      }
    : shared;
}

export function buildAgentEndData(params: {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
  privacy: ModernLifecyclePrivacyConfig;
}): Record<string, unknown> {
  const roleSummary = summarizeMessageRoles(params.messages);
  const shared = {
    messageCount: params.messages.length,
    success: params.success,
    error: params.error,
    durationMs: params.durationMs,
    ...(roleSummary ? { messageRoles: roleSummary } : {}),
  };

  return params.privacy.payloadMode === 'full'
    ? {
        ...shared,
        messages: params.messages,
      }
    : shared;
}

export function buildBeforeCompactionData(params: {
  messageCount: number;
  compactingCount?: number;
  tokenCount?: number;
  messages?: unknown[];
  sessionFile?: string;
  privacy: ModernLifecyclePrivacyConfig;
}): Record<string, unknown> {
  const messageList = params.messages ?? [];
  const roleSummary = summarizeMessageRoles(messageList);
  const shared = {
    messageCount: params.messageCount,
    compactingCount: params.compactingCount,
    tokenCount: params.tokenCount,
    hasSessionFile: typeof params.sessionFile === 'string' && params.sessionFile.length > 0,
    ...(roleSummary ? { messageRoles: roleSummary } : {}),
  };

  return params.privacy.payloadMode === 'full'
    ? {
        ...shared,
        messages: params.messages,
        sessionFile: params.sessionFile,
      }
    : shared;
}

export function buildAfterCompactionData(params: {
  messageCount: number;
  compactedCount: number;
  tokenCount?: number;
  sessionFile?: string;
  privacy: ModernLifecyclePrivacyConfig;
}): Record<string, unknown> {
  const shared = {
    messageCount: params.messageCount,
    compactedCount: params.compactedCount,
    tokenCount: params.tokenCount,
    hasSessionFile: typeof params.sessionFile === 'string' && params.sessionFile.length > 0,
  };

  return params.privacy.payloadMode === 'full'
    ? {
        ...shared,
        sessionFile: params.sessionFile,
      }
    : shared;
}
