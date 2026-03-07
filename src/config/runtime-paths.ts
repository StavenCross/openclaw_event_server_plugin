import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, resolve } from 'node:path';

const MAX_UNIX_SOCKET_PATH_LENGTH = 100;

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
    const resolvedPath = resolveRelativeRuntimePath(rawPath);
    if (resolvedPath.length <= MAX_UNIX_SOCKET_PATH_LENGTH) {
      return resolvedPath;
    }

    const hash = createHash('sha256').update(resolvedPath).digest('hex').slice(0, 16);
    const suffix = extname(resolvedPath) || '.sock';
    return resolve(tmpdir(), `openclaw-event-${hash}${suffix}`);
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
