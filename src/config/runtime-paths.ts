import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';

function resolveRelativeRuntimePath(rawPath: string): string {
  const trimmedPath = rawPath.trim();
  if (trimmedPath === '' || isAbsolute(trimmedPath)) {
    return rawPath;
  }

  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  if (stateDir) {
    return resolve(stateDir, trimmedPath);
  }

  const configPath = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (configPath) {
    return resolve(dirname(configPath), trimmedPath);
  }

  return resolve(homedir(), '.openclaw', trimmedPath);
}

function sanitizePipeName(pathValue: string): string {
  return pathValue
    .replace(/^[A-Za-z]:/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 200);
}

/**
 * Transport relay uses filesystem sockets on Unix and named pipes on Windows.
 * This keeps the config surface stable while producing a valid platform-native
 * address for `net.listen()` and `net.createConnection()`.
 */
export function resolveTransportSocketPath(rawPath: string, platform = process.platform): string {
  if (platform !== 'win32') {
    return resolveRelativeRuntimePath(rawPath);
  }

  const trimmedPath = rawPath.trim();
  if (trimmedPath.startsWith('\\\\.\\pipe\\')) {
    return trimmedPath;
  }

  const resolvedPath = resolveRelativeRuntimePath(rawPath);
  const pipeName = sanitizePipeName(resolvedPath) || 'openclaw-event-server';
  return `\\\\.\\pipe\\${pipeName}`;
}

export function resolveRuntimePath(rawPath: string): string {
  return resolveRelativeRuntimePath(rawPath);
}
