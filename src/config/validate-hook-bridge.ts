import { PluginConfig } from './config-types';
import { isAbsolute } from 'node:path';

export function validateHookBridgeConfig(config: PluginConfig, errors: string[]): void {
  if (config.hookBridge.localScriptDefaults.timeoutMs < 1000) {
    errors.push('Hook bridge localScriptDefaults.timeoutMs must be at least 1000');
  }
  if (config.hookBridge.localScriptDefaults.maxPayloadBytes < 1024) {
    errors.push('Hook bridge localScriptDefaults.maxPayloadBytes must be at least 1024');
  }
  if (config.hookBridge.runtime.maxPendingEvents < 1 || config.hookBridge.runtime.maxPendingEvents > 100000) {
    errors.push('Hook bridge runtime.maxPendingEvents must be between 1 and 100000');
  }
  if (config.hookBridge.runtime.concurrency < 1 || config.hookBridge.runtime.concurrency > 1024) {
    errors.push('Hook bridge runtime.concurrency must be between 1 and 1024');
  }
  if (!['drop_oldest', 'drop_newest'].includes(config.hookBridge.runtime.dropPolicy)) {
    errors.push('Hook bridge runtime.dropPolicy must be drop_oldest or drop_newest');
  }
  if (
    config.hookBridge.telemetry.slowActionMs < 1 ||
    config.hookBridge.telemetry.slowActionMs > 600000
  ) {
    errors.push('Hook bridge telemetry.slowActionMs must be between 1 and 600000');
  }
  if (
    config.hookBridge.telemetry.failureRateWindowMs < 1000 ||
    config.hookBridge.telemetry.failureRateWindowMs > 3600000
  ) {
    errors.push('Hook bridge telemetry.failureRateWindowMs must be between 1000 and 3600000');
  }
  if (
    config.hookBridge.telemetry.failureRateThresholdPct < 0 ||
    config.hookBridge.telemetry.failureRateThresholdPct > 100
  ) {
    errors.push('Hook bridge telemetry.failureRateThresholdPct must be between 0 and 100');
  }
  if (
    config.hookBridge.telemetry.failureRateMinSamples < 1 ||
    config.hookBridge.telemetry.failureRateMinSamples > 100000
  ) {
    errors.push('Hook bridge telemetry.failureRateMinSamples must be between 1 and 100000');
  }
  if (
    config.hookBridge.telemetry.saturationWindowMs < 100 ||
    config.hookBridge.telemetry.saturationWindowMs > 3600000
  ) {
    errors.push('Hook bridge telemetry.saturationWindowMs must be between 100 and 3600000');
  }
  const highWatermarks = config.hookBridge.telemetry.highWatermarks;
  if (!Array.isArray(highWatermarks) || highWatermarks.length === 0) {
    errors.push('Hook bridge telemetry.highWatermarks must be a non-empty array');
  } else if (
    highWatermarks.some(
      (value) => !Number.isFinite(value) || value <= 0 || value > 100 || Math.floor(value) !== value,
    )
  ) {
    errors.push('Hook bridge telemetry.highWatermarks values must be integers between 1 and 100');
  }

  if (config.hookBridge.toolGuard.timeoutMs < 100 || config.hookBridge.toolGuard.timeoutMs > 120000) {
    errors.push('Hook bridge toolGuard.timeoutMs must be between 100 and 120000');
  }
  if (!['allow', 'block'].includes(config.hookBridge.toolGuard.onError)) {
    errors.push('Hook bridge toolGuard.onError must be allow or block');
  }
  const scopeKeyBy = config.hookBridge.toolGuard.scopeKeyBy ?? 'tool_and_params';
  if (!['tool', 'tool_and_params'].includes(scopeKeyBy)) {
    errors.push('Hook bridge toolGuard.scopeKeyBy must be tool or tool_and_params');
  }
  if (
    !Number.isFinite(config.hookBridge.toolGuard.retryBackoffMs) ||
    config.hookBridge.toolGuard.retryBackoffMs < 0 ||
    config.hookBridge.toolGuard.retryBackoffMs > 3600000
  ) {
    errors.push('Hook bridge toolGuard.retryBackoffMs must be between 0 and 3600000');
  }
  if (
    !Number.isFinite(config.hookBridge.toolGuard.approvalCacheTtlMs) ||
    config.hookBridge.toolGuard.approvalCacheTtlMs < 0 ||
    config.hookBridge.toolGuard.approvalCacheTtlMs > 86400000
  ) {
    errors.push('Hook bridge toolGuard.approvalCacheTtlMs must be between 0 and 86400000');
  }
  if (!config.hookBridge.toolGuard.redaction.replacement || config.hookBridge.toolGuard.redaction.replacement.trim() === '') {
    errors.push('Hook bridge toolGuard.redaction.replacement cannot be empty');
  }
  if (!Array.isArray(config.hookBridge.toolGuard.redaction.fields)) {
    errors.push('Hook bridge toolGuard.redaction.fields must be an array');
  }

  if (config.hookBridge.enabled || config.hookBridge.toolGuard.enabled) {
    config.hookBridge.allowedActionDirs.forEach((dir, index) => {
      if (!dir || dir.trim() === '') {
        errors.push(`Hook bridge allowedActionDirs[${index}] cannot be empty`);
        return;
      }
      if (!isAbsolute(dir)) {
        errors.push(`Hook bridge allowedActionDirs[${index}] must be an absolute path`);
      }
    });

    for (const [actionId, action] of Object.entries(config.hookBridge.actions)) {
      if (!actionId.trim()) {
        errors.push('Hook bridge actions cannot use an empty action ID');
      }
      if (action.type === 'webhook') {
        if (!action.url || action.url.trim() === '') {
          errors.push(`Hook bridge action "${actionId}" requires a webhook URL`);
        } else {
          try {
            const parsed = new URL(action.url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              errors.push(`Hook bridge action "${actionId}" webhook URL must use HTTP or HTTPS`);
            }
          } catch {
            errors.push(`Hook bridge action "${actionId}" webhook URL is invalid`);
          }
        }
        if (action.timeoutMs !== undefined && (action.timeoutMs < 100 || action.timeoutMs > 120000)) {
          errors.push(`Hook bridge action "${actionId}" timeoutMs must be between 100 and 120000`);
        }
      }
      if (action.type === 'local_script') {
        if (!action.path || action.path.trim() === '') {
          errors.push(`Hook bridge action "${actionId}" requires a script path`);
        } else if (!isAbsolute(action.path)) {
          errors.push(`Hook bridge action "${actionId}" script path must be absolute`);
        }
        if (
          action.timeoutMs !== undefined &&
          (action.timeoutMs < 100 || action.timeoutMs > 120000)
        ) {
          errors.push(`Hook bridge action "${actionId}" timeoutMs must be between 100 and 120000`);
        }
        if (
          action.maxPayloadBytes !== undefined &&
          (action.maxPayloadBytes < 1024 || action.maxPayloadBytes > 1048576)
        ) {
          errors.push(
            `Hook bridge action "${actionId}" maxPayloadBytes must be between 1024 and 1048576`,
          );
        }
        if (
          action.args !== undefined &&
          (!Array.isArray(action.args) || action.args.some((value) => typeof value !== 'string'))
        ) {
          errors.push(`Hook bridge action "${actionId}" args must be an array of strings`);
        }
      }
    }

    config.hookBridge.rules.forEach((rule, index) => {
      if (!rule.id || rule.id.trim() === '') {
        errors.push(`Hook bridge rule ${index}: id is required`);
      }
      if (!rule.action || rule.action.trim() === '') {
        errors.push(`Hook bridge rule ${index}: action is required`);
      } else if (!config.hookBridge.actions[rule.action]) {
        errors.push(`Hook bridge rule ${index}: action "${rule.action}" is not registered`);
      }
      if (rule.cooldownMs !== undefined && rule.cooldownMs < 0) {
        errors.push(`Hook bridge rule ${index}: cooldownMs must be >= 0`);
      }
      if (rule.coalesce?.enabled) {
        if (
          rule.coalesce.windowMs !== undefined &&
          (!Number.isFinite(rule.coalesce.windowMs) || rule.coalesce.windowMs < 1)
        ) {
          errors.push(`Hook bridge rule ${index}: coalesce.windowMs must be >= 1`);
        }
        if (
          rule.coalesce.strategy !== undefined &&
          rule.coalesce.strategy !== 'first' &&
          rule.coalesce.strategy !== 'latest'
        ) {
          errors.push(`Hook bridge rule ${index}: coalesce.strategy must be first or latest`);
        }
        if (
          rule.coalesce.keyFields !== undefined &&
          (!Array.isArray(rule.coalesce.keyFields) ||
            rule.coalesce.keyFields.some((value) => typeof value !== 'string' || value.trim() === ''))
        ) {
          errors.push(`Hook bridge rule ${index}: coalesce.keyFields must be non-empty strings`);
        }
      }
      validateRuleWhen(rule.when, errors, `Hook bridge rule ${index}`);
    });
  }

  if (config.hookBridge.toolGuard.enabled) {
    config.hookBridge.toolGuard.rules.forEach((rule, index) => {
      if (!rule.id || rule.id.trim() === '') {
        errors.push(`Hook bridge toolGuard rule ${index}: id is required`);
      }
      if (
        rule.priority !== undefined &&
        (!Number.isFinite(rule.priority) || Math.floor(rule.priority) !== rule.priority)
      ) {
        errors.push(`Hook bridge toolGuard rule ${index}: priority must be an integer`);
      }
      const hasAction = typeof rule.action === 'string' && rule.action.trim() !== '';
      const hasDecision = typeof rule.decision === 'object' && rule.decision !== null;
      if (!hasAction && !hasDecision) {
        errors.push(`Hook bridge toolGuard rule ${index}: action or decision is required`);
      }
      if (hasAction && rule.action && !config.hookBridge.actions[rule.action]) {
        errors.push(`Hook bridge toolGuard rule ${index}: action "${rule.action}" is not registered`);
      }
      if (rule.cooldownMs !== undefined && rule.cooldownMs < 0) {
        errors.push(`Hook bridge toolGuard rule ${index}: cooldownMs must be >= 0`);
      }
      validateRuleWhen(rule.when, errors, `Hook bridge toolGuard rule ${index}`);
    });
  }
}

function validateRuleWhen(
  when: {
    idleForMsGte?: number;
    matchesRegex?: Record<string, string>;
    notMatchesRegex?: Record<string, string>;
    requiredPaths?: string[];
    typeChecks?: Record<string, string>;
    inList?: Record<string, unknown[]>;
    notInList?: Record<string, unknown[]>;
    domainAllowlist?: string[];
    domainBlocklist?: string[];
  },
  errors: string[],
  scope: string,
): void {
  if (
    when.idleForMsGte !== undefined &&
    (!Number.isFinite(when.idleForMsGte) || when.idleForMsGte < 0)
  ) {
    errors.push(`${scope}: idleForMsGte must be >= 0`);
  }

  if (when.matchesRegex) {
    for (const [path, pattern] of Object.entries(when.matchesRegex)) {
      try {
        void new RegExp(pattern);
      } catch {
        errors.push(`${scope}: matchesRegex pattern at "${path}" is invalid`);
      }
    }
  }

  if (when.notMatchesRegex) {
    for (const [path, pattern] of Object.entries(when.notMatchesRegex)) {
      try {
        void new RegExp(pattern);
      } catch {
        errors.push(`${scope}: notMatchesRegex pattern at "${path}" is invalid`);
      }
    }
  }

  if (
    when.requiredPaths !== undefined &&
    (!Array.isArray(when.requiredPaths) ||
      when.requiredPaths.some((value) => typeof value !== 'string' || value.trim() === ''))
  ) {
    errors.push(`${scope}: requiredPaths must be non-empty strings`);
  }

  if (when.typeChecks) {
    for (const [path, expectedType] of Object.entries(when.typeChecks)) {
      if (!['string', 'number', 'boolean', 'object', 'array'].includes(expectedType)) {
        errors.push(`${scope}: typeChecks at "${path}" must be string|number|boolean|object|array`);
      }
    }
  }

  if (when.inList) {
    for (const [path, values] of Object.entries(when.inList)) {
      if (!Array.isArray(values) || values.length === 0) {
        errors.push(`${scope}: inList at "${path}" must be a non-empty array`);
      }
    }
  }

  if (when.notInList) {
    for (const [path, values] of Object.entries(when.notInList)) {
      if (!Array.isArray(values) || values.length === 0) {
        errors.push(`${scope}: notInList at "${path}" must be a non-empty array`);
      }
    }
  }

  if (
    when.domainAllowlist !== undefined &&
    (!Array.isArray(when.domainAllowlist) ||
      when.domainAllowlist.some((value) => typeof value !== 'string' || value.trim() === ''))
  ) {
    errors.push(`${scope}: domainAllowlist must be non-empty strings`);
  }

  if (
    when.domainBlocklist !== undefined &&
    (!Array.isArray(when.domainBlocklist) ||
      when.domainBlocklist.some((value) => typeof value !== 'string' || value.trim() === ''))
  ) {
    errors.push(`${scope}: domainBlocklist must be non-empty strings`);
  }
}
