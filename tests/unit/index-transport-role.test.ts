import { MockOpenClawApi } from '../mocks/openclaw-runtime';

describe('plugin transport role transitions', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('stops the websocket singleton when transport demotes to follower', async () => {
    const startBroadcastServer = jest.fn();
    const stopBroadcastServer = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../../src/broadcast/websocketServer', () => ({
      startBroadcastServer,
      stopBroadcastServer,
      broadcastEvent: jest.fn(),
    }));

    jest.doMock('../../src/transport/manager', () => ({
      TransportManager: class MockTransportManager {
        private readonly onRoleChange?: (role: 'owner' | 'follower') => void;

        constructor(params: { onRoleChange?: (role: 'owner' | 'follower') => void }) {
          this.onRoleChange = params.onRoleChange;
        }

        start(): void {
          this.onRoleChange?.('owner');
          this.onRoleChange?.('follower');
        }

        dispatch(): Promise<void> {
          return Promise.resolve();
        }

        stop(): Promise<void> {
          return Promise.resolve();
        }
      },
    }));

    const { createPlugin } = await import('../../src/index');
    const plugin = createPlugin();
    const api = new MockOpenClawApi();
    api.config = {
      enabled: true,
      eventLog: {
        enabled: false,
      },
      transport: {
        mode: 'auto',
      },
    };

    plugin.activate(api as never);

    expect(startBroadcastServer).toHaveBeenCalledTimes(1);
    expect(stopBroadcastServer).toHaveBeenCalledTimes(1);
  });

  it('fails activation fast when configuration validation fails', async () => {
    const { createPlugin } = await import('../../src/index');
    const plugin = createPlugin();
    const api = new MockOpenClawApi();
    api.config = {
      enabled: true,
      transport: {
        mode: 'auto',
        lockPath: '',
      },
    };

    expect(() => plugin.activate(api as never)).toThrow(/Configuration validation failed/);
    await expect(plugin.deactivate()).resolves.toBeUndefined();
  });

  it('rejects repeated activation until the current instance is deactivated', async () => {
    const { createPlugin } = await import('../../src/index');
    const plugin = createPlugin();
    const api = new MockOpenClawApi();

    plugin.activate(api as never);
    expect(() => plugin.activate(api as never)).toThrow(
      'Plugin is already activated. Deactivate the current instance before reactivating.',
    );

    await expect(plugin.deactivate()).resolves.toBeUndefined();
    expect(() => plugin.activate(api as never)).not.toThrow();
    await expect(plugin.deactivate()).resolves.toBeUndefined();
  });
});
