import { createConnection } from 'node:net';
import { OpenClawEvent } from '../events/types';
import { serializeEnvelope } from './protocol';

export async function sendRelayEvent(params: {
  socketPath: string;
  authToken?: string;
  maxPayloadBytes: number;
  relayTimeoutMs: number;
  event: OpenClawEvent;
}): Promise<void> {
  const serialized = serializeEnvelope({
    authToken: params.authToken,
    event: params.event,
  });

  if (Buffer.byteLength(serialized, 'utf8') > params.maxPayloadBytes) {
    throw new Error('relay payload exceeds maxPayloadBytes');
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let responseBuffer = '';

    const socket = createConnection(params.socketPath);
    const timeout = setTimeout(() => {
      socket.destroy(new Error('relay timeout'));
    }, params.relayTimeoutMs);

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.removeAllListeners();
      callback();
    };

    socket.setEncoding('utf8');
    socket.once('connect', () => {
      socket.write(serialized, 'utf8');
    });
    socket.on('data', (chunk: string) => {
      responseBuffer += chunk;
    });
    socket.once('error', (error) => {
      finish(() => reject(error));
    });
    socket.once('close', () => {
      const firstLine = responseBuffer.trim().split('\n')[0];
      if (!firstLine) {
        finish(() => reject(new Error('relay closed without acknowledgement')));
        return;
      }

      try {
        const ack = JSON.parse(firstLine) as { ok?: boolean; error?: string };
        if (ack.ok) {
          finish(resolve);
          return;
        }
        finish(() => reject(new Error(ack.error ?? 'relay rejected event')));
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
  });
}
