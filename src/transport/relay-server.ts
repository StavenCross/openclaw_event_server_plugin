import { createServer, type Server, type Socket } from 'node:net';
import { OpenClawEvent } from '../events/types';
import { RuntimeLogger } from '../runtime/types';
import { isOpenClawEvent, type RelayEnvelope } from './protocol';

export function startRelayServer(params: {
  socketPath: string;
  maxPayloadBytes: number;
  authToken?: string;
  logger: RuntimeLogger;
  onEvent: (event: OpenClawEvent) => Promise<void>;
  onListening?: () => void;
  onClose?: () => void;
  onFatalError: (reason: string) => void;
}): Server {
  const server = createServer((socket) => {
    handleIncomingSocket(socket, params);
  });

  server.on('listening', () => {
    params.onListening?.();
  });
  server.on('error', (error) => {
    params.logger.error('[Transport] Owner ingest server error', error.message);
    params.onFatalError('owner ingest server error');
  });
  server.on('close', () => {
    params.onClose?.();
  });

  server.listen(params.socketPath);
  return server;
}

function handleIncomingSocket(
  socket: Socket,
  params: {
    maxPayloadBytes: number;
    authToken?: string;
    onEvent: (event: OpenClawEvent) => Promise<void>;
  },
): void {
  let buffer = '';
  let payloadBytes = 0;
  let handled = false;

  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    if (handled) {
      return;
    }
    payloadBytes += Buffer.byteLength(chunk, 'utf8');
    if (payloadBytes > params.maxPayloadBytes) {
      handled = true;
      socket.end(JSON.stringify({ ok: false, error: 'payload too large' }) + '\n');
      return;
    }
    buffer += chunk;
    if (!buffer.includes('\n')) {
      return;
    }
    handled = true;
    void processIncomingEnvelope(buffer, socket, params);
  });

  socket.on('end', () => {
    if (!handled) {
      handled = true;
      void processIncomingEnvelope(buffer, socket, params);
    }
  });
  socket.on('error', () => {
    // ignore per-connection errors
  });
}

async function processIncomingEnvelope(
  buffer: string,
  socket: Socket,
  params: {
    authToken?: string;
    onEvent: (event: OpenClawEvent) => Promise<void>;
  },
): Promise<void> {
  const firstLine = buffer.trim().split('\n')[0];
  if (!firstLine) {
    socket.end(JSON.stringify({ ok: false, error: 'empty payload' }) + '\n');
    return;
  }

  try {
    const envelope = JSON.parse(firstLine) as RelayEnvelope;
    if (params.authToken && envelope.authToken !== params.authToken) {
      socket.end(JSON.stringify({ ok: false, error: 'invalid transport auth token' }) + '\n');
      return;
    }
    if (!isOpenClawEvent(envelope.event)) {
      socket.end(JSON.stringify({ ok: false, error: 'invalid event payload' }) + '\n');
      return;
    }

    await params.onEvent(envelope.event);
    socket.end(JSON.stringify({ ok: true }) + '\n');
  } catch (error) {
    socket.end(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }) + '\n',
    );
  }
}
