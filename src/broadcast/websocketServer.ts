/**
 * WebSocket Broadcast Server
 *
 * Dumb broadcaster - emits all events to connected clients.
 * No filtering, no transformation, no knowledge of consumers.
 */

import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'node:http';
import { getErrorMessage, getRuntimeLogger } from '../logging';

const DEFAULT_PORT = 9011;

interface WebSocketServerOptions {
  port?: number;
  host?: string;
  path?: string;
  fallbackPorts?: number[];
  requireAuth?: boolean;
  authToken?: string;
  allowedOrigins?: string[];
  allowedIps?: string[];
}

function isAddressInUseError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const err = error as NodeJS.ErrnoException;
  return err.code === 'EADDRINUSE' || String(err.message ?? '').includes('EADDRINUSE');
}

function toPayload(event: unknown): Record<string, unknown> {
  if (typeof event === 'object' && event !== null) {
    return { ...(event as Record<string, unknown>) };
  }

  return {
    event,
  };
}

export class BroadcastWebSocketServer {
  private wss: WebSocketServer | null = null;
  private port: number;
  private host: string;
  private path: string;
  private readonly configuredPorts: number[];
  private readonly requireAuth: boolean;
  private readonly authToken?: string;
  private readonly allowedOrigins: Set<string>;
  private readonly allowedIps: Set<string>;
  private candidatePorts: number[] = [];
  private clients: Set<WebSocket> = new Set();
  private isRunning: boolean = false;
  private startupGeneration = 0;

  constructor(options: WebSocketServerOptions = {}) {
    this.port = options.port ?? DEFAULT_PORT;
    this.host = options.host ?? '127.0.0.1';
    this.path = options.path ?? '/';
    this.requireAuth = options.requireAuth ?? false;
    this.authToken = options.authToken;
    this.allowedOrigins = new Set(options.allowedOrigins ?? []);
    this.allowedIps = new Set(options.allowedIps ?? []);
    const fallbackPorts = options.fallbackPorts ?? [];
    this.configuredPorts = [this.port, ...fallbackPorts].filter(
      (value, index, arr) => arr.indexOf(value) === index,
    );
  }

  /**
   * Start the WebSocket broadcast server
   */
  public start(): void {
    const logger = getRuntimeLogger();
    if (this.isRunning) {
      logger.info('[WebSocketServer] Already running, skipping startup');
      return;
    }
    if (this.wss) {
      logger.info('[WebSocketServer] Startup already in progress, skipping duplicate start');
      return;
    }

    this.candidatePorts = [...this.configuredPorts];
    this.startupGeneration += 1;
    this.tryStartNextPort(this.startupGeneration);
  }

  private tryStartNextPort(generation: number): void {
    const logger = getRuntimeLogger();
    if (generation !== this.startupGeneration) {
      return;
    }

    const nextPort = this.candidatePorts.shift();
    if (nextPort === undefined) {
      logger.error('[WebSocketServer] No available ports left for startup');
      this.isRunning = false;
      return;
    }

    this.port = nextPort;

    try {
      const server = new WebSocketServer({
        port: this.port,
        host: this.host,
        path: this.path,
      });
      this.wss = server;

      server.on('listening', () => {
        if (generation !== this.startupGeneration || this.wss !== server) {
          server.close();
          return;
        }
        this.isRunning = true;
        logger.info(`[WebSocketServer] Broadcasting on ws://${this.host}:${this.port}${this.path}`);
      });

      server.on('connection', (ws: WebSocket, request: IncomingMessage) => {
        this.handleConnection(ws, request);
      });

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (generation !== this.startupGeneration || this.wss !== server) {
          return;
        }

        if (isAddressInUseError(error)) {
          logger.warn(`[WebSocketServer] Port ${this.port} in use, trying fallback port...`);
          this.wss = null;
          server.close();
          this.tryStartNextPort(generation);
          return;
        }

        logger.error('[WebSocketServer] Server error:', error.message);
        this.isRunning = false;
      });

      server.on('close', () => {
        logger.info('[WebSocketServer] Server closed');
        if (this.wss === server) {
          this.wss = null;
          this.isRunning = false;
          this.clients.clear();
        }
      });
    } catch (error) {
      if (isAddressInUseError(error)) {
        logger.warn(`[WebSocketServer] Port ${this.port} in use, trying fallback port...`);
        this.wss?.close();
        this.wss = null;
        this.tryStartNextPort(generation);
        return;
      }

      logger.error('[WebSocketServer] Failed to start:', getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Handle a new client connection
   */
  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const logger = getRuntimeLogger();
    const auth = this.authorizeRequest(request);
    if (!auth.allowed) {
      logger.warn(`[WebSocketServer] Rejected client connection: ${auth.reason}`);
      ws.close(4003, 'Unauthorized');
      return;
    }

    const clientId = this.generateClientId();
    logger.info(`[WebSocketServer] Client connected: ${clientId}`);

    this.clients.add(ws);

    ws.on('pong', () => {
      // Client is alive
    });

    ws.on('close', () => {
      logger.info(`[WebSocketServer] Client disconnected: ${clientId}`);
      this.clients.delete(ws);
    });

    ws.on('error', (error: Error) => {
      logger.error(`[WebSocketServer] Client error (${clientId}):`, error.message);
      this.clients.delete(ws);
      try {
        ws.terminate();
      } catch {
        // ignore cleanup errors
      }
    });

    // Send welcome message
    this.sendToClient(ws, {
      type: 'welcome',
      message: 'Connected to OpenClaw Event Server broadcast',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast an event to all connected clients
   */
  public broadcast(event: unknown): void {
    const logger = getRuntimeLogger();
    if (!this.isRunning || !this.wss) {
      logger.warn('[WebSocketServer] Not running, skipping broadcast');
      return;
    }

    const payload = {
      ...toPayload(event),
      broadcastAt: new Date().toISOString(),
    };

    const data = JSON.stringify(payload);
    let sentCount = 0;
    let errorCount = 0;

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
          sentCount++;
        } catch (error) {
          logger.error('[WebSocketServer] Failed to send to client:', getErrorMessage(error));
          errorCount++;
        }
      }
    });

    if (sentCount > 0) {
      const eventType = readEventType(payload);
      logger.info(`[WebSocketServer] Broadcast to ${sentCount} client(s): ${eventType}`);
    }

    if (errorCount > 0) {
      logger.warn(`[WebSocketServer] Failed to send to ${errorCount} client(s)`);
    }
  }

  /**
   * Send a message to a specific client
   */
  private sendToClient(ws: WebSocket, message: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Stop the WebSocket server
   */
  public stop(): Promise<void> {
    const logger = getRuntimeLogger();
    return new Promise((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }

      const server = this.wss;
      this.startupGeneration += 1;
      this.wss = null;
      logger.info('[WebSocketServer] Stopping server...');

      // Close all client connections
      this.clients.forEach((client) => {
        client.close(1000, 'Server shutting down');
      });
      this.clients.clear();

      // Close the server
      try {
        server.close(() => {
          this.isRunning = false;
          logger.info('[WebSocketServer] Server stopped');
          resolve();
        });
      } catch {
        this.isRunning = false;
        resolve();
      }
    });
  }

  /**
   * Get the number of connected clients
   */
  public getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Check if the server is running
   */
  public isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get active server port
   */
  public getPort(): number {
    return this.port;
  }

  /**
   * Generate a unique client ID for logging
   */
  private generateClientId(): string {
    return `client-${Math.random().toString(36).substring(2, 9)}`;
  }

  private authorizeRequest(request: IncomingMessage): { allowed: boolean; reason?: string } {
    const origin = request.headers.origin;
    if (this.allowedOrigins.size > 0 && (!origin || !this.allowedOrigins.has(origin))) {
      return { allowed: false, reason: 'origin not allowed' };
    }

    const remoteIp = this.normalizeIp(request.socket.remoteAddress);
    if (this.allowedIps.size > 0 && (!remoteIp || !this.allowedIps.has(remoteIp))) {
      return { allowed: false, reason: 'ip not allowed' };
    }

    if (!this.requireAuth) {
      return { allowed: true };
    }

    if (!this.authToken || this.authToken.trim() === '') {
      return { allowed: false, reason: 'auth token missing on server' };
    }

    const token = this.extractToken(request);
    if (!token || token !== this.authToken) {
      return { allowed: false, reason: 'invalid auth token' };
    }

    return { allowed: true };
  }

  private normalizeIp(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    if (value.startsWith('::ffff:')) {
      return value.slice('::ffff:'.length);
    }
    return value;
  }

  private extractToken(request: IncomingMessage): string | undefined {
    const headerToken = request.headers['x-event-plugin-token'];
    if (typeof headerToken === 'string' && headerToken.trim() !== '') {
      return headerToken.trim();
    }

    const authHeader = request.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length).trim();
    }

    try {
      const parsed = new URL(request.url ?? '', 'ws://localhost');
      const token = parsed.searchParams.get('token');
      return token && token.trim() !== '' ? token.trim() : undefined;
    } catch {
      return undefined;
    }
  }
}

function readEventType(payload: Record<string, unknown>): string {
  return typeof payload.type === 'string' ? payload.type : 'event';
}

// Singleton instance
let broadcastServer: BroadcastWebSocketServer | null = null;

/**
 * Get or create the broadcast server instance
 */
export function getBroadcastServer(options?: WebSocketServerOptions): BroadcastWebSocketServer {
  if (!broadcastServer) {
    broadcastServer = new BroadcastWebSocketServer(options);
  }
  return broadcastServer;
}

/**
 * Start the broadcast server (singleton)
 */
export function startBroadcastServer(options?: WebSocketServerOptions): BroadcastWebSocketServer {
  const server = getBroadcastServer(options);
  server.start();
  return server;
}

/**
 * Broadcast an event to all connected clients
 */
export function broadcastEvent(event: unknown): void {
  if (broadcastServer) {
    broadcastServer.broadcast(event);
  } else {
    getRuntimeLogger().warn('[WebSocketServer] No server instance, cannot broadcast');
  }
}

/**
 * Stop the broadcast server (singleton)
 */
export async function stopBroadcastServer(): Promise<void> {
  if (broadcastServer) {
    await broadcastServer.stop();
    broadcastServer = null;
  }
}
