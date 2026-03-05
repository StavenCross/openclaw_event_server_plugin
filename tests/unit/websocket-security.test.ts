import { BroadcastWebSocketServer } from '../../src/broadcast/websocketServer';
import { EventEmitter } from 'node:events';

type MockRequest = {
  headers: Record<string, string | undefined>;
  socket: { remoteAddress?: string };
  url?: string;
};

function mockRequest(params?: Partial<MockRequest>): MockRequest {
  return {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    url: '/',
    ...(params ?? {}),
  };
}

describe('WebSocket security authorization', () => {
  it('allows by default when no restrictions are set', () => {
    const server = new BroadcastWebSocketServer();
    const result = (server as unknown as { authorizeRequest: (request: unknown) => { allowed: boolean } })
      .authorizeRequest(mockRequest());
    expect(result.allowed).toBe(true);
  });

  it('rejects disallowed origin and ip', () => {
    const server = new BroadcastWebSocketServer({
      allowedOrigins: ['https://allowed.example'],
      allowedIps: ['10.0.0.1'],
    });

    const badOrigin = (server as any).authorizeRequest(
      mockRequest({ headers: { origin: 'https://blocked.example' } }),
    );
    expect(badOrigin.allowed).toBe(false);

    const badIp = (server as any).authorizeRequest(
      mockRequest({
        headers: { origin: 'https://allowed.example' },
        socket: { remoteAddress: '10.0.0.2' },
      }),
    );
    expect(badIp.allowed).toBe(false);
  });

  it('enforces auth token when required', () => {
    const server = new BroadcastWebSocketServer({
      requireAuth: true,
      authToken: 'secret-token',
    });

    expect((server as any).authorizeRequest(mockRequest()).allowed).toBe(false);
    expect(
      (server as any).authorizeRequest(
        mockRequest({ headers: { authorization: 'Bearer wrong-token' } }),
      ).allowed,
    ).toBe(false);

    expect(
      (server as any).authorizeRequest(
        mockRequest({ headers: { authorization: 'Bearer secret-token' } }),
      ).allowed,
    ).toBe(true);
  });

  it('extracts token from query and custom header', () => {
    const server = new BroadcastWebSocketServer({
      requireAuth: true,
      authToken: 'query-token',
    });

    expect(
      (server as any).authorizeRequest(
        mockRequest({ url: '/?token=query-token' }),
      ).allowed,
    ).toBe(true);

    const headerServer = new BroadcastWebSocketServer({
      requireAuth: true,
      authToken: 'header-token',
    });

    expect(
      (headerServer as any).authorizeRequest(
        mockRequest({ headers: { 'x-event-plugin-token': 'header-token' } }),
      ).allowed,
    ).toBe(true);
  });

  it('normalizes ipv4-mapped ipv6 addresses', () => {
    const server = new BroadcastWebSocketServer({
      allowedIps: ['127.0.0.1'],
    });

    const result = (server as any).authorizeRequest(
      mockRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } }),
    );
    expect(result.allowed).toBe(true);
  });

  it('terminates and removes client on client error event', () => {
    class FakeSocket extends EventEmitter {
      readyState = 1;
      public terminated = false;

      send(): void {
        // no-op
      }

      close(): void {
        // no-op
      }

      terminate(): void {
        this.terminated = true;
      }
    }

    const server = new BroadcastWebSocketServer();
    const socket = new FakeSocket();

    (server as any).handleConnection(socket, mockRequest());
    expect(server.getClientCount()).toBe(1);

    socket.emit('error', new Error('client boom'));
    expect(server.getClientCount()).toBe(0);
    expect(socket.terminated).toBe(true);
  });
});
