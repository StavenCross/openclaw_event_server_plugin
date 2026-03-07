import { MockOpenClawApi } from '../mocks/openclaw-runtime';

describe('plugin transport role transitions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      EVENT_PLUGIN_RUNTIME_KIND_OVERRIDE: 'gateway',
    };
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = originalEnv;
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

  it('resolves auto transport mode to owner for gateway runtimes', async () => {
    const seenModes: string[] = [];

    jest.doMock('../../src/transport/manager', () => ({
      TransportManager: class MockTransportManager {
        constructor(params: { config: { mode: string }; onRoleChange?: (role: 'owner' | 'follower') => void }) {
          seenModes.push(params.config.mode);
          params.onRoleChange?.('owner');
        }

        start(): void {}
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
    expect(seenModes).toEqual(['owner']);
    await expect(plugin.deactivate()).resolves.toBeUndefined();
  });

  it('resolves auto transport mode to follower for agent runtimes', async () => {
    process.env.EVENT_PLUGIN_RUNTIME_KIND_OVERRIDE = 'agent';
    const seenModes: string[] = [];

    jest.doMock('../../src/transport/manager', () => ({
      TransportManager: class MockTransportManager {
        constructor(params: { config: { mode: string }; onRoleChange?: (role: 'owner' | 'follower') => void }) {
          seenModes.push(params.config.mode);
          params.onRoleChange?.('follower');
        }

        start(): void {}
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
    expect(seenModes).toEqual(['follower']);
    await expect(plugin.deactivate()).resolves.toBeUndefined();
  });

  it('warns when auto mode cannot positively identify the runtime kind', async () => {
    process.env.EVENT_PLUGIN_RUNTIME_KIND_OVERRIDE = 'unknown';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const seenModes: string[] = [];

    jest.doMock('../../src/transport/manager', () => ({
      TransportManager: class MockTransportManager {
        constructor(params: { config: { mode: string }; onRoleChange?: (role: 'owner' | 'follower') => void }) {
          seenModes.push(params.config.mode);
          params.onRoleChange?.('follower');
        }

        start(): void {}
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

    expect(seenModes).toEqual(['follower']);
    expect(warnSpy).toHaveBeenCalledWith(
      '[event-plugin:warn]',
      '[Transport] Could not positively identify runtime kind in auto mode; defaulting to follower transport',
    );

    await expect(plugin.deactivate()).resolves.toBeUndefined();
  });
});
