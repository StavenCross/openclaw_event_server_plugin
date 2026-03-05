import { HookBridgeAction, HookBridgeConfig, HookBridgeRule } from '../config';
import { OpenClawEvent } from '../events/types';
import { executeBridgeAction } from './hook-bridge-actions';
import { buildCoalesceKey, toErrorMessage } from './hook-bridge-utils';
import type { RuntimeLogger } from './types';

export interface HookTask {
  taskId: string;
  ruleId: string;
  actionId: string;
  action: HookBridgeAction;
  rule: HookBridgeRule;
  event: OpenClawEvent;
  enqueuedAt: number;
  coalesceKey?: string;
  mergedCount: number;
}

interface ActionOutcome {
  atMs: number;
  success: boolean;
}

const DEFAULT_COALESCE_WINDOW_MS = 10000;

export class HookBridgeDispatchEngine {
  private readonly config: HookBridgeConfig;
  private readonly logger: RuntimeLogger;
  private readonly queue: HookTask[] = [];
  private readonly queuedTaskById: Map<string, HookTask> = new Map();
  private readonly queuedTaskIdByCoalesceKey: Map<string, string> = new Map();
  private readonly highWatermarkActive: Set<number> = new Set();
  private readonly outcomes: ActionOutcome[] = [];

  private runningWorkers = 0;
  private drainResolvers: Array<() => void> = [];
  private queueFullSinceMs?: number;
  private backpressureActive = false;
  private failureRateAlertActive = false;

  constructor(config: HookBridgeConfig, logger: RuntimeLogger) {
    this.config = config;
    this.logger = logger;
  }

  enqueueTask(task: HookTask): void {
    const coalesced = this.tryCoalesceTask(task);
    if (coalesced) {
      return;
    }

    const runtime = this.config.runtime;
    if (this.queue.length >= runtime.maxPendingEvents) {
      if (runtime.dropPolicy === 'drop_newest') {
        this.emitDropTelemetry(task, 'drop_newest');
        this.evaluateQueuePressure();
        return;
      }

      const dropped = this.queue.shift();
      if (dropped) {
        this.queuedTaskById.delete(dropped.taskId);
        if (dropped.coalesceKey && this.queuedTaskIdByCoalesceKey.get(dropped.coalesceKey) === dropped.taskId) {
          this.queuedTaskIdByCoalesceKey.delete(dropped.coalesceKey);
        }
        this.emitDropTelemetry(dropped, 'drop_oldest');
      }
    }

    this.queue.push(task);
    this.queuedTaskById.set(task.taskId, task);
    if (task.coalesceKey) {
      this.queuedTaskIdByCoalesceKey.set(task.coalesceKey, task.taskId);
    }

    this.evaluateQueuePressure();
    this.pumpWorkers();
  }

  async stop(): Promise<void> {
    this.pumpWorkers();
    await this.waitForDrain();
  }

  private tryCoalesceTask(task: HookTask): boolean {
    const coalesce = task.rule.coalesce;
    if (!coalesce?.enabled) {
      return false;
    }

    const coalesceKey = buildCoalesceKey(task.ruleId, task.event, coalesce);
    if (!coalesceKey) {
      return false;
    }

    const queuedTaskId = this.queuedTaskIdByCoalesceKey.get(coalesceKey);
    if (!queuedTaskId) {
      task.coalesceKey = coalesceKey;
      return false;
    }

    const existing = this.queuedTaskById.get(queuedTaskId);
    if (!existing) {
      this.queuedTaskIdByCoalesceKey.delete(coalesceKey);
      task.coalesceKey = coalesceKey;
      return false;
    }

    const windowMs = coalesce.windowMs ?? DEFAULT_COALESCE_WINDOW_MS;
    if (Date.now() - existing.enqueuedAt > windowMs) {
      this.queuedTaskIdByCoalesceKey.delete(coalesceKey);
      task.coalesceKey = coalesceKey;
      return false;
    }

    const strategy = coalesce.strategy ?? 'latest';
    if (strategy === 'latest') {
      existing.event = task.event;
      existing.enqueuedAt = task.enqueuedAt;
    }

    existing.mergedCount += 1;
    this.logger.info(
      '[HookBridge] hookbridge.rule.coalesced',
      existing.ruleId,
      `key=${coalesceKey}`,
      `merged=${existing.mergedCount}`,
      `strategy=${strategy}`,
    );

    return true;
  }

  private pumpWorkers(): void {
    while (this.runningWorkers < this.config.runtime.concurrency && this.queue.length > 0) {
      void this.runWorker();
    }

    this.resolveDrainIfIdle();
  }

  private async runWorker(): Promise<void> {
    this.runningWorkers += 1;

    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift();
        if (!task) {
          continue;
        }

        this.queuedTaskById.delete(task.taskId);
        if (task.coalesceKey && this.queuedTaskIdByCoalesceKey.get(task.coalesceKey) === task.taskId) {
          this.queuedTaskIdByCoalesceKey.delete(task.coalesceKey);
        }

        this.evaluateQueuePressure();
        await this.executeTask(task);
      }
    } finally {
      this.runningWorkers -= 1;
      this.pumpWorkers();
    }
  }

  private async executeTask(task: HookTask): Promise<void> {
    const startMs = Date.now();
    let success = false;

    try {
      await executeBridgeAction({ config: this.config }, task.action, task.event, task.ruleId);
      success = true;
      this.logger.info('[HookBridge] action succeeded', task.ruleId, task.actionId, task.event.type);
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      this.logger.error('[HookBridge] action failed', task.ruleId, task.actionId, task.event.type, errorMessage);
      if (errorMessage.toLowerCase().includes('timed out')) {
        this.logger.warn('[HookBridge] hookbridge.action.timeout', task.ruleId, task.actionId, task.event.type);
      }
    }

    const durationMs = Date.now() - startMs;
    if (durationMs >= this.config.telemetry.slowActionMs) {
      this.logger.warn(
        '[HookBridge] hookbridge.action.slow',
        task.ruleId,
        task.actionId,
        task.action.type,
        `durationMs=${durationMs}`,
      );
    }

    this.recordOutcome(success);
    this.evaluateFailureRate();
  }

  private evaluateQueuePressure(): void {
    const max = this.config.runtime.maxPendingEvents;
    const queuePct = max === 0 ? 0 : Math.floor((this.queue.length / max) * 100);

    const thresholds = [...this.config.telemetry.highWatermarks].sort((a, b) => a - b);
    for (const threshold of thresholds) {
      if (queuePct >= threshold) {
        if (!this.highWatermarkActive.has(threshold)) {
          this.highWatermarkActive.add(threshold);
          this.logger.warn(
            '[HookBridge] hookbridge.queue.high_watermark',
            `thresholdPct=${threshold}`,
            `queueSize=${this.queue.length}`,
            `maxPending=${max}`,
          );
        }
      } else {
        this.highWatermarkActive.delete(threshold);
      }
    }

    const queueAtCapacity = this.queue.length >= max;
    if (queueAtCapacity) {
      if (!this.queueFullSinceMs) {
        this.queueFullSinceMs = Date.now();
      }

      if (!this.backpressureActive && Date.now() - this.queueFullSinceMs >= this.config.telemetry.saturationWindowMs) {
        this.backpressureActive = true;
        this.logger.warn(
          '[HookBridge] hookbridge.backpressure.active',
          `queueSize=${this.queue.length}`,
          `maxPending=${max}`,
        );
      }
      return;
    }

    this.queueFullSinceMs = undefined;
    if (this.backpressureActive) {
      this.backpressureActive = false;
      this.logger.info(
        '[HookBridge] hookbridge.backpressure.recovered',
        `queueSize=${this.queue.length}`,
        `maxPending=${max}`,
      );
    }
  }

  private emitDropTelemetry(task: HookTask, policy: 'drop_oldest' | 'drop_newest'): void {
    this.logger.warn(
      '[HookBridge] hookbridge.queue.drop',
      `policy=${policy}`,
      `ruleId=${task.ruleId}`,
      `actionId=${task.actionId}`,
      `eventType=${task.event.type}`,
      `queueSize=${this.queue.length}`,
      `maxPending=${this.config.runtime.maxPendingEvents}`,
    );
  }

  private recordOutcome(success: boolean): void {
    const nowMs = Date.now();
    this.outcomes.push({ atMs: nowMs, success });

    const minTimestamp = nowMs - this.config.telemetry.failureRateWindowMs;
    while (this.outcomes.length > 0 && this.outcomes[0].atMs < minTimestamp) {
      this.outcomes.shift();
    }
  }

  private evaluateFailureRate(): void {
    const samples = this.outcomes.length;
    const minSamples = this.config.telemetry.failureRateMinSamples;
    if (samples < minSamples) {
      if (this.failureRateAlertActive) {
        this.failureRateAlertActive = false;
        this.logger.info('[HookBridge] hookbridge.action.failure_rate_recovered', `samples=${samples}`);
      }
      return;
    }

    let failures = 0;
    for (const outcome of this.outcomes) {
      if (!outcome.success) {
        failures += 1;
      }
    }

    const failurePct = (failures / samples) * 100;
    if (failurePct >= this.config.telemetry.failureRateThresholdPct) {
      if (!this.failureRateAlertActive) {
        this.failureRateAlertActive = true;
        this.logger.warn(
          '[HookBridge] hookbridge.action.failure_rate',
          `samples=${samples}`,
          `failures=${failures}`,
          `failurePct=${failurePct.toFixed(2)}`,
        );
      }
      return;
    }

    if (this.failureRateAlertActive) {
      this.failureRateAlertActive = false;
      this.logger.info(
        '[HookBridge] hookbridge.action.failure_rate_recovered',
        `samples=${samples}`,
        `failurePct=${failurePct.toFixed(2)}`,
      );
    }
  }

  private waitForDrain(): Promise<void> {
    if (this.runningWorkers === 0 && this.queue.length === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  private resolveDrainIfIdle(): void {
    if (this.runningWorkers !== 0 || this.queue.length !== 0) {
      return;
    }

    const resolvers = this.drainResolvers;
    this.drainResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }
}
