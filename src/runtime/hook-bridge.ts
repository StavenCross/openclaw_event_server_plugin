import {
  HookBridgeConfig,
  HookBridgeGuardDecision,
  HookBridgeRule,
  HookBridgeToolGuardRule,
  PluginConfig,
} from '../config';
import { OpenClawEvent } from '../events/types';
import { executeBridgeGuardAction } from './hook-bridge-actions';
import { HookBridgeDispatchEngine } from './hook-bridge-dispatch-engine';
import {
  buildToolGuardEvent,
  buildToolGuardScopeKey,
  matchesRule,
  renderGuardTemplate,
  resolveDecisionTemplates,
} from './hook-bridge-tool-guard';
import { readPath, toErrorMessage } from './hook-bridge-utils';
import type { HookBridgeGuardDecisionOutcome, HookBridgeRunner, RuntimeLogger } from './types';

const TOOL_GUARD_TRACE =
  process.env.EVENT_PLUGIN_TOOL_GUARD_TRACE === '1' ||
  process.env.EVENT_PLUGIN_TOOL_GUARD_TRACE === 'true';

export class HookBridge implements HookBridgeRunner {
  private readonly config: HookBridgeConfig;
  private readonly logger: RuntimeLogger;
  private readonly dispatchEngine: HookBridgeDispatchEngine;
  private readonly parentStatusByAgent: Map<string, string> = new Map();
  private readonly lastTriggerByRule: Map<string, number> = new Map();
  private readonly blockedRetryStateByScope: Map<string, { blockedAtMs: number; reason?: string }> = new Map();
  private readonly approvalCacheByScope: Map<
    string,
    { expiresAtMs: number; decision: HookBridgeGuardDecision; ruleId?: string; actionId?: string }
  > = new Map();

  private acceptingEvents = true;
  private nextTaskId = 1;

  private trace(...args: unknown[]): void {
    if (!TOOL_GUARD_TRACE) {
      return;
    }
    this.logger.info('[ToolGuardTrace]', ...args);
  }

  constructor(config: HookBridgeConfig, logger: RuntimeLogger) {
    this.config = config;
    this.logger = logger;
    this.dispatchEngine = new HookBridgeDispatchEngine(config, logger);
  }

  onEvent(event: OpenClawEvent): void {
    if (!this.config.enabled || !this.acceptingEvents) {
      return;
    }

    this.observeAgentStatus(event);

    for (const rule of this.config.rules) {
      if (rule.enabled === false) {
        continue;
      }
      if (!matchesRule(event, rule, this.parentStatusByAgent)) {
        continue;
      }
      if (!this.canTrigger(rule)) {
        continue;
      }

      this.lastTriggerByRule.set(rule.id, Date.now());
      if (this.config.dryRun) {
        this.logger.info('[HookBridge] dry-run matched rule', rule.id, 'for event', event.type);
        continue;
      }

      const action = this.config.actions[rule.action];
      if (!action) {
        this.logger.error('[HookBridge] Rule references unknown action', rule.id, rule.action);
        continue;
      }

      this.dispatchEngine.enqueueTask({
        taskId: `task-${this.nextTaskId++}`,
        ruleId: rule.id,
        actionId: rule.action,
        action,
        rule,
        event,
        enqueuedAt: Date.now(),
        mergedCount: 0,
      });
    }
  }

  async stop(): Promise<void> {
    this.acceptingEvents = false;
    await this.dispatchEngine.stop();
  }

  async evaluateBeforeToolCall(params: {
    toolName: string;
    params: Record<string, unknown>;
    agentId?: string;
    sessionId?: string;
    sessionKey?: string;
    runId?: string;
    toolCallId?: string;
  }): Promise<HookBridgeGuardDecisionOutcome | undefined> {
    const guardConfig = this.config.toolGuard;
    if (!guardConfig.enabled || !this.acceptingEvents) {
      this.trace('hookBridge.evaluate.skip', {
        reason: !guardConfig.enabled ? 'toolGuard.disabled' : 'hookBridge.notAccepting',
        toolName: params.toolName,
        toolCallId: params.toolCallId ?? null,
      });
      return undefined;
    }

    const toolEvent = buildToolGuardEvent(params);
    const nowMs = Date.now();
    const scopeKey = buildToolGuardScopeKey(
      params.toolName,
      params.params,
      guardConfig.scopeKeyBy ?? 'tool_and_params',
    );
    this.cleanupToolGuardState(nowMs, guardConfig.retryBackoffMs);
    this.trace('hookBridge.evaluate.start', {
      toolName: params.toolName,
      toolCallId: params.toolCallId ?? null,
      scopeKey,
      rulesCount: guardConfig.rules.length,
    });

    const blockedState = this.blockedRetryStateByScope.get(scopeKey);
    if (
      guardConfig.retryBackoffMs > 0 &&
      blockedState &&
      nowMs - blockedState.blockedAtMs < guardConfig.retryBackoffMs
    ) {
      const remainingMs = guardConfig.retryBackoffMs - (nowMs - blockedState.blockedAtMs);
      const templateReason =
        guardConfig.retryBackoffReason ??
        'Retry blocked. Back off briefly before retrying this tool call.';
      return {
        block: true,
        blockReason: renderGuardTemplate(templateReason, toolEvent).replace(
          /\{\{\s*retryBackoffRemainingMs\s*\}\}/g,
          String(remainingMs),
        ),
        matched: true,
        decisionSource: 'backoff',
      };
    }

    const cached = this.approvalCacheByScope.get(scopeKey);
    if (cached && cached.expiresAtMs > nowMs) {
      return {
        ...resolveDecisionTemplates(cached.decision, toolEvent),
        matched: true,
        decisionSource: 'cache',
        matchedRuleId: cached.ruleId,
        matchedActionId: cached.actionId,
      };
    }

    const sortedRules = [...guardConfig.rules]
      .map((rule, index) => ({ rule, index }))
      .sort((a, b) => {
        const priorityA = a.rule.priority ?? 0;
        const priorityB = b.rule.priority ?? 0;
        if (priorityA !== priorityB) {
          return priorityB - priorityA;
        }
        return a.index - b.index;
      })
      .map((entry) => entry.rule);

    for (const rule of sortedRules) {
      if (rule.enabled === false) {
        continue;
      }
      if (!matchesRule(toolEvent, rule, this.parentStatusByAgent)) {
        this.trace('hookBridge.rule.skip', {
          ruleId: rule.id,
          reason: 'matcher.false',
          toolName: params.toolName,
          toolCallId: params.toolCallId ?? null,
        });
        continue;
      }
      if (!this.canTrigger(rule)) {
        this.trace('hookBridge.rule.skip', {
          ruleId: rule.id,
          reason: 'cooldown.active',
          toolName: params.toolName,
          toolCallId: params.toolCallId ?? null,
        });
        continue;
      }
      this.trace('hookBridge.rule.match', {
        ruleId: rule.id,
        actionId: rule.action ?? null,
        hasDecision: Boolean(rule.decision),
        toolName: params.toolName,
        toolCallId: params.toolCallId ?? null,
      });

      const stopOnMatch = rule.stopOnMatch ?? guardConfig.stopOnMatchDefault ?? false;

      this.lastTriggerByRule.set(rule.id, Date.now());
      if (rule.decision) {
        if (guardConfig.dryRun) {
          this.logger.info(
            '[HookBridge] toolGuard dry-run decision',
            rule.id,
            params.toolName,
            JSON.stringify(rule.decision),
          );
          if (stopOnMatch) {
            return {
              matched: true,
              matchedRuleId: rule.id,
            };
          }
          continue;
        }
        const resolvedDecision = resolveDecisionTemplates(rule.decision, toolEvent);
        const outcome: HookBridgeGuardDecisionOutcome = {
          ...resolvedDecision,
          matched: true,
          matchedRuleId: rule.id,
          decisionSource: 'rule',
        };
        this.recordToolGuardDecision(scopeKey, outcome, guardConfig, nowMs);
        this.trace('hookBridge.rule.decision', {
          ruleId: rule.id,
          toolName: params.toolName,
          toolCallId: params.toolCallId ?? null,
          outcome,
        });
        return outcome;
      }

      const actionId = rule.action;
      if (!actionId || actionId.trim() === '') {
        this.logger.error('[HookBridge] Tool guard rule missing action', rule.id);
        if (guardConfig.onError === 'block') {
          return { block: true, blockReason: `Tool guard action missing for rule "${rule.id}"` };
        }
        continue;
      }

      const action = this.config.actions[actionId];
      if (!action) {
        this.logger.error('[HookBridge] Tool guard references unknown action', rule.id, actionId);
        if (guardConfig.onError === 'block') {
          return { block: true, blockReason: `Tool guard action not found: ${actionId}` };
        }
        continue;
      }

      try {
        const decision = await executeBridgeGuardAction(
          { config: this.config },
          action,
          toolEvent,
          rule.id,
          guardConfig.timeoutMs,
        );
        if (!decision) {
          this.trace('hookBridge.action.no-decision', {
            ruleId: rule.id,
            actionId,
            toolName: params.toolName,
            toolCallId: params.toolCallId ?? null,
            stopOnMatch,
          });
          if (stopOnMatch) {
            return {
              matched: true,
              matchedRuleId: rule.id,
              matchedActionId: actionId,
            };
          }
          continue;
        }
        if (guardConfig.dryRun) {
          this.logger.info(
            '[HookBridge] toolGuard dry-run decision',
            rule.id,
            params.toolName,
            JSON.stringify(decision),
          );
          if (stopOnMatch) {
            return {
              matched: true,
              matchedRuleId: rule.id,
              matchedActionId: actionId,
            };
          }
          continue;
        }
        const resolvedDecision = resolveDecisionTemplates(decision, toolEvent);
        const outcome: HookBridgeGuardDecisionOutcome = {
          ...resolvedDecision,
          matched: true,
          matchedRuleId: rule.id,
          matchedActionId: actionId,
          decisionSource: 'action',
        };
        this.recordToolGuardDecision(scopeKey, outcome, guardConfig, nowMs);
        this.trace('hookBridge.action.decision', {
          ruleId: rule.id,
          actionId,
          toolName: params.toolName,
          toolCallId: params.toolCallId ?? null,
          outcome,
        });
        return outcome;
      } catch (error) {
        const message = toErrorMessage(error);
        this.logger.error('[HookBridge] Tool guard action failed', rule.id, actionId, message);
        if (guardConfig.onError === 'block') {
          const outcome: HookBridgeGuardDecisionOutcome = {
            block: true,
            blockReason: `Tool guard failed for rule "${rule.id}": ${message}`,
            matched: true,
            matchedRuleId: rule.id,
            matchedActionId: actionId,
            decisionSource: 'action',
          };
          this.recordToolGuardDecision(scopeKey, outcome, guardConfig, nowMs);
          this.trace('hookBridge.action.error.block', {
            ruleId: rule.id,
            actionId,
            toolName: params.toolName,
            toolCallId: params.toolCallId ?? null,
            error: message,
            outcome,
          });
          return outcome;
        }
        if (stopOnMatch) {
          this.trace('hookBridge.action.error.stopOnMatch', {
            ruleId: rule.id,
            actionId,
            toolName: params.toolName,
            toolCallId: params.toolCallId ?? null,
            error: message,
          });
          return {
            matched: true,
            matchedRuleId: rule.id,
            matchedActionId: actionId,
          };
        }
      }
    }

    this.trace('hookBridge.evaluate.no-match', {
      toolName: params.toolName,
      toolCallId: params.toolCallId ?? null,
    });
    return undefined;
  }

  private observeAgentStatus(event: OpenClawEvent): void {
    if (event.type !== 'agent.status' || !event.agentId) {
      return;
    }

    const status = readPath(event, 'data.status');
    if (typeof status === 'string' && status.trim()) {
      this.parentStatusByAgent.set(event.agentId, status);
    }
  }

  private canTrigger(rule: HookBridgeRule | HookBridgeToolGuardRule): boolean {
    if (!rule.cooldownMs || rule.cooldownMs <= 0) {
      return true;
    }

    const lastTriggeredAt = this.lastTriggerByRule.get(rule.id);
    if (!lastTriggeredAt) {
      return true;
    }

    return Date.now() - lastTriggeredAt >= rule.cooldownMs;
  }

  private cleanupToolGuardState(nowMs: number, retryBackoffMs: number): void {
    for (const [key, cached] of this.approvalCacheByScope.entries()) {
      if (cached.expiresAtMs <= nowMs) {
        this.approvalCacheByScope.delete(key);
      }
    }

    if (retryBackoffMs <= 0) {
      this.blockedRetryStateByScope.clear();
      return;
    }

    for (const [key, blocked] of this.blockedRetryStateByScope.entries()) {
      if (nowMs - blocked.blockedAtMs >= retryBackoffMs) {
        this.blockedRetryStateByScope.delete(key);
      }
    }
  }

  private recordToolGuardDecision(
    scopeKey: string,
    outcome: HookBridgeGuardDecisionOutcome,
    guardConfig: HookBridgeConfig['toolGuard'],
    nowMs: number,
  ): void {
    if (outcome.block) {
      this.blockedRetryStateByScope.set(scopeKey, {
        blockedAtMs: nowMs,
        reason: outcome.blockReason,
      });
      return;
    }

    if (guardConfig.approvalCacheTtlMs <= 0) {
      return;
    }

    this.approvalCacheByScope.set(scopeKey, {
      expiresAtMs: nowMs + guardConfig.approvalCacheTtlMs,
      decision: {
        block: false,
        params: outcome.params,
      },
      ruleId: outcome.matchedRuleId,
      actionId: outcome.matchedActionId,
    });
  }
}

export function createHookBridge(config: PluginConfig, logger: RuntimeLogger): HookBridgeRunner | undefined {
  if (!config.hookBridge.enabled && !config.hookBridge.toolGuard.enabled) {
    return undefined;
  }

  return new HookBridge(config.hookBridge, logger);
}
