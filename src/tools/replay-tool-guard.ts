#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_CONFIG, mergeConfig, resolveRuntimeConfig, validateConfig } from '../config';
import { HookBridge } from '../runtime/hook-bridge';
import type { RuntimeLogger } from '../runtime/types';

interface ReplayInputCall {
  toolName: string;
  params?: Record<string, unknown>;
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  toolCallId?: string;
}

function parseArgs(argv: string[]): { configPath: string; inputPath: string } {
  let configPath = '';
  let inputPath = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') {
      configPath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--input') {
      inputPath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
  }

  if (!configPath || !inputPath) {
    throw new Error('Usage: node dist/tools/replay-tool-guard.js --config <config.json> --input <calls.json|calls.ndjson>');
  }

  return {
    configPath: resolve(configPath),
    inputPath: resolve(inputPath),
  };
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readReplayCalls(path: string): ReplayInputCall[] {
  const raw = readFileSync(path, 'utf8');
  if (path.endsWith('.ndjson')) {
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ReplayInputCall);
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Input must be a JSON array or NDJSON file');
  }
  return parsed as ReplayInputCall[];
}

async function main(): Promise<void> {
  const { configPath, inputPath } = parseArgs(process.argv.slice(2));
  const userConfig = readJsonFile(configPath) as Record<string, unknown>;

  const config = resolveRuntimeConfig(mergeConfig(DEFAULT_CONFIG, userConfig));
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid config:\n${validation.errors.join('\n')}`);
  }

  const logger: RuntimeLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    queue: () => undefined,
  };
  const bridge = new HookBridge(config.hookBridge, logger);
  const calls = readReplayCalls(inputPath);

  const rows: Array<{
    index: number;
    toolName: string;
    blocked: boolean;
    reason?: string;
    matchedRuleId?: string;
    source?: string;
  }> = [];

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    const decision = await bridge.evaluateBeforeToolCall({
      toolName: call.toolName,
      params: call.params ?? {},
      agentId: call.agentId,
      sessionId: call.sessionId,
      sessionKey: call.sessionKey,
      runId: call.runId,
      toolCallId: call.toolCallId,
    });
    rows.push({
      index,
      toolName: call.toolName,
      blocked: decision?.block === true,
      reason: decision?.blockReason,
      matchedRuleId: decision?.matchedRuleId,
      source: decision?.decisionSource,
    });
  }

  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  await bridge.stop();
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
