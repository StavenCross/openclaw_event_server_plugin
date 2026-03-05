import { createHmac, randomUUID } from 'node:crypto';
import { OpenClawEvent } from './types';

export type HmacConfig = {
  enabled: boolean;
  secret?: string;
  algorithm: 'sha256' | 'sha512';
};

function toSignablePayload(event: OpenClawEvent, timestamp: number, nonce: string): string {
  const payload = {
    ...event,
    signature: undefined,
  };
  return JSON.stringify({
    timestamp,
    nonce,
    payload,
  });
}

export function signEvent(event: OpenClawEvent, config: HmacConfig): OpenClawEvent {
  if (!config.enabled || !config.secret) {
    return event;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const raw = toSignablePayload(event, timestamp, nonce);
  const value = createHmac(config.algorithm, config.secret).update(raw).digest('hex');

  return {
    ...event,
    signature: {
      version: 'v1',
      algorithm: config.algorithm,
      timestamp,
      nonce,
      value,
    },
  };
}
