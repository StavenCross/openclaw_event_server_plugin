import { type TransportConfig } from '../config';
import { type RuntimeLogger } from '../runtime/types';
import { type TransportRole } from './protocol';

/**
 * Build consistent structured log context for transport lifecycle messages so
 * operators can correlate role, queue depth, and socket state quickly.
 */
export function buildTransportLogContext(params: {
  config: TransportConfig;
  runtimeId: string;
  role: TransportRole;
  pendingEvents: number;
  reason?: string;
  error?: string;
}): Record<string, unknown> {
  return {
    runtimeId: params.runtimeId,
    transportMode: params.config.mode,
    role: params.role,
    socketPath: params.config.socketPath,
    lockPath: params.config.lockPath,
    pendingEvents: params.pendingEvents,
    ...(params.reason ? { reason: params.reason } : {}),
    ...(params.error ? { error: params.error } : {}),
  };
}

/**
 * Keep transport lifecycle logging consistent so incident-oriented messages all
 * carry the same structured context.
 */
export function logTransportInfo(
  logger: RuntimeLogger,
  message: string,
  params: Parameters<typeof buildTransportLogContext>[0] & {
    extra?: Record<string, unknown>;
  },
): void {
  logger.info(message, {
    ...buildTransportLogContext(params),
    ...(params.extra ?? {}),
  });
}

/**
 * Keep transport warning logs consistent for recovery-path failures and queue
 * backpressure events.
 */
export function logTransportWarn(
  logger: RuntimeLogger,
  message: string,
  params: Parameters<typeof buildTransportLogContext>[0] & {
    extra?: Record<string, unknown>;
  },
): void {
  logger.warn(message, {
    ...buildTransportLogContext(params),
    ...(params.extra ?? {}),
  });
}
