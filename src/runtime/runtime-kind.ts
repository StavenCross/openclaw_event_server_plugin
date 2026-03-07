export type OpenClawRuntimeKind = 'gateway' | 'agent' | 'unknown';

interface RuntimeDetectionInput {
  argv?: string[];
  title?: string;
  env?: NodeJS.ProcessEnv;
}

const OVERRIDE_ENV = 'EVENT_PLUGIN_RUNTIME_KIND_OVERRIDE';

function normalizeTokens(argv: string[]): string[] {
  return argv
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function isLauncherToken(value: string): boolean {
  return (
    value === 'node' ||
    value.endsWith('/node') ||
    value.endsWith('\\node.exe') ||
    value.endsWith('.js') ||
    value.includes('/dist/')
  );
}

function detectFromArgv(argv: string[]): OpenClawRuntimeKind {
  const tokens = normalizeTokens(argv);

  // Prefer explicit executable names because they are the least ambiguous.
  if (tokens.some((value) => value === 'openclaw-gateway' || value.endsWith('/openclaw-gateway'))) {
    return 'gateway';
  }
  if (tokens.some((value) => value === 'openclaw-agent' || value.endsWith('/openclaw-agent'))) {
    return 'agent';
  }

  // Fall back to the first real OpenClaw CLI subcommand. This avoids treating a
  // later incidental argument like "gateway" as proof that the runtime is the
  // gateway process.
  const firstCommand = tokens.find((value) => !value.startsWith('-') && !isLauncherToken(value));
  if (firstCommand === 'gateway') {
    return 'gateway';
  }
  if (firstCommand === 'agent') {
    return 'agent';
  }

  return 'unknown';
}

function readOverride(env: NodeJS.ProcessEnv): OpenClawRuntimeKind | undefined {
  const override = env[OVERRIDE_ENV]?.trim().toLowerCase();
  if (override === 'gateway' || override === 'agent' || override === 'unknown') {
    return override;
  }
  return undefined;
}

export function detectOpenClawRuntimeKind(input: RuntimeDetectionInput = {}): OpenClawRuntimeKind {
  const env = input.env ?? process.env;
  const override = readOverride(env);
  if (override) {
    return override;
  }

  const title = (input.title ?? process.title ?? '').trim().toLowerCase();
  if (title.includes('openclaw-gateway')) {
    return 'gateway';
  }
  if (title.includes('openclaw-agent')) {
    return 'agent';
  }

  const argvKind = detectFromArgv(input.argv ?? process.argv);
  if (argvKind !== 'unknown') {
    return argvKind;
  }

  if (env.OPENCLAW_GATEWAY_PORT?.trim()) {
    return 'gateway';
  }

  return 'unknown';
}

export function resolveAutoTransportMode(runtimeKind: OpenClawRuntimeKind): 'owner' | 'follower' {
  // Unknown runtimes intentionally stay followers so an unexpected OpenClaw
  // process shape never self-promotes into the public transport hub.
  return runtimeKind === 'gateway' ? 'owner' : 'follower';
}
