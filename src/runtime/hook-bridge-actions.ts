import { spawn } from 'node:child_process';
import { basename, resolve, sep } from 'node:path';
import { HookBridgeAction, HookBridgeConfig, HookBridgeGuardDecision } from '../config';
import { OpenClawEvent } from '../events/types';
import { toCanonicalPath, trimPreview } from './hook-bridge-utils';

interface LocalScriptResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface ActionContext {
  config: HookBridgeConfig;
}

const TOOL_GUARD_TRACE =
  process.env.EVENT_PLUGIN_TOOL_GUARD_TRACE === '1' ||
  process.env.EVENT_PLUGIN_TOOL_GUARD_TRACE === 'true';

function trace(...args: unknown[]): void {
  if (!TOOL_GUARD_TRACE) {
    return;
  }
  // Keep trace independent from plugin logger to simplify action-path debugging.
  // eslint-disable-next-line no-console
  console.log('[event-plugin:trace]', ...args);
}

export async function executeBridgeAction(
  context: ActionContext,
  action: HookBridgeAction,
  event: OpenClawEvent,
  ruleId: string,
): Promise<void> {
  if (action.type === 'webhook') {
    trace('hookBridge.action.dispatch', { kind: 'webhook', ruleId, url: action.url });
    await executeWebhookAction(action, event, ruleId);
    return;
  }

  trace('hookBridge.action.dispatch', { kind: 'local_script', ruleId, path: action.path });
  await executeLocalScriptAction(context.config, action, event, ruleId);
}

export async function executeBridgeGuardAction(
  context: ActionContext,
  action: HookBridgeAction,
  event: OpenClawEvent,
  ruleId: string,
  defaultTimeoutMs: number,
): Promise<HookBridgeGuardDecision | undefined> {
  if (action.type === 'webhook') {
    trace('toolGuard.action.dispatch', {
      kind: 'webhook',
      ruleId,
      url: action.url,
      timeoutMs: action.timeoutMs ?? defaultTimeoutMs ?? 10000,
    });
    const responseBody = await executeWebhookAction(action, event, ruleId, defaultTimeoutMs);
    const parsed = parseHookBridgeDecision(responseBody);
    trace('toolGuard.action.result', {
      kind: 'webhook',
      ruleId,
      rawPreview: trimPreview(responseBody, 300),
      parsed: parsed ?? null,
    });
    return parsed;
  }

  trace('toolGuard.action.dispatch', {
    kind: 'local_script',
    ruleId,
    path: action.path,
    timeoutMs: action.timeoutMs ?? defaultTimeoutMs ?? context.config.localScriptDefaults.timeoutMs,
  });
  const stdout = await executeLocalScriptAction(context.config, action, event, ruleId, defaultTimeoutMs);
  const parsed = parseHookBridgeDecision(stdout);
  trace('toolGuard.action.result', {
    kind: 'local_script',
    ruleId,
    path: action.path,
    rawPreview: trimPreview(stdout, 300),
    parsed: parsed ?? null,
  });
  return parsed;
}

async function executeWebhookAction(
  action: Extract<HookBridgeAction, { type: 'webhook' }>,
  event: OpenClawEvent,
  ruleId: string,
  defaultTimeoutMs?: number,
): Promise<string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(action.headers ?? {}),
  };
  if (action.authToken) {
    headers.authorization = `Bearer ${action.authToken}`;
  }

  const timeoutMs = action.timeoutMs ?? defaultTimeoutMs ?? 10000;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    trace('hookBridge.webhook.request', {
      ruleId,
      url: action.url,
      method: action.method ?? 'POST',
      timeoutMs,
    });
    const response = await fetch(action.url, {
      method: action.method ?? 'POST',
      headers,
      body: JSON.stringify({ ruleId, event }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Webhook action failed with status ${response.status}`);
    }
    const text = await response.text();
    trace('hookBridge.webhook.response', {
      ruleId,
      status: response.status,
      bodyPreview: trimPreview(text, 300),
    });
    return text;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function executeLocalScriptAction(
  config: HookBridgeConfig,
  action: Extract<HookBridgeAction, { type: 'local_script' }>,
  event: OpenClawEvent,
  ruleId: string,
  defaultTimeoutMs?: number,
): Promise<string> {
  const absolutePath = resolve(action.path);
  const canonicalPath = toCanonicalPath(absolutePath);
  if (!canonicalPath) {
    throw new Error(`Script path could not be resolved: ${absolutePath}`);
  }
  if (!isAllowedLocalScriptPath(config, canonicalPath)) {
    throw new Error(`Script path is not allowed: ${absolutePath}`);
  }

  const timeoutMs = action.timeoutMs ?? defaultTimeoutMs ?? config.localScriptDefaults.timeoutMs;
  const maxPayloadBytes = action.maxPayloadBytes ?? config.localScriptDefaults.maxPayloadBytes;
  const payload = JSON.stringify({ ruleId, event });
  const payloadBytes = Buffer.byteLength(payload, 'utf8');
  if (payloadBytes > maxPayloadBytes) {
    throw new Error(`Script payload exceeds maxPayloadBytes (${payloadBytes} > ${maxPayloadBytes})`);
  }

  const result = await runLocalScript({
    scriptPath: canonicalPath,
    args: action.args ?? [],
    payload,
    timeoutMs,
  });

  if (result.timedOut) {
    throw new Error(`Script timed out after ${timeoutMs}ms (${basename(canonicalPath)})`);
  }

  if (result.exitCode !== 0) {
    throw new Error(
      `Script exited with code ${String(result.exitCode)} (stderr: ${trimPreview(result.stderr)})`,
    );
  }

  trace('hookBridge.local_script.result', {
    ruleId,
    script: canonicalPath,
    exitCode: result.exitCode,
    signal: result.signal,
    stdoutPreview: trimPreview(result.stdout, 300),
    stderrPreview: trimPreview(result.stderr, 300),
  });
  return result.stdout;
}

function isAllowedLocalScriptPath(config: HookBridgeConfig, scriptPath: string): boolean {
  if (config.allowedActionDirs.length === 0) {
    return false;
  }

  return config.allowedActionDirs.some((dir) => {
    const absoluteDir = resolve(dir);
    const canonicalDir = toCanonicalPath(absoluteDir);
    if (!canonicalDir) {
      return false;
    }
    return scriptPath === canonicalDir || scriptPath.startsWith(`${canonicalDir}${sep}`);
  });
}

async function runLocalScript(params: {
  scriptPath: string;
  args: string[];
  payload: string;
  timeoutMs: number;
}): Promise<LocalScriptResult> {
  const { scriptPath, args, payload, timeoutMs } = params;

  return new Promise<LocalScriptResult>((resolvePromise, rejectPromise) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const child = spawn(scriptPath, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 1000).unref();
    }, timeoutMs);

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      rejectPromise(error);
    });

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.stdin.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      rejectPromise(error);
    });

    child.on('close', (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      resolvePromise({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });

    child.stdin.end(payload);
  });
}

function parseHookBridgeDecision(raw: string): HookBridgeGuardDecision | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }

  const value = parsed as Record<string, unknown>;
  const hasBlockBoolean = typeof value.block === 'boolean';
  const block = value.block === true;
  const blockReason = typeof value.blockReason === 'string' ? value.blockReason : undefined;
  const blockReasonTemplate =
    typeof value.blockReasonTemplate === 'string' ? value.blockReasonTemplate : undefined;
  const params =
    typeof value.params === 'object' && value.params !== null
      ? (value.params as Record<string, unknown>)
      : undefined;
  const hasParams = params !== undefined;

  if (!hasBlockBoolean && !hasParams) {
    return undefined;
  }

  return {
    block: hasBlockBoolean ? block : undefined,
    blockReason,
    blockReasonTemplate,
    params,
  };
}
