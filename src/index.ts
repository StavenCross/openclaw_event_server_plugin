/**
 * OpenClaw Event Server Plugin
 *
 * Broadcasts raw internal/plugin hook events with a canonical envelope and
 * emits synthetic agent status/activity events for downstream consumers.
 */

import { randomUUID } from 'node:crypto';
import {
  CONFIG_SCHEMA,
  DEFAULT_CONFIG,
  PluginConfig,
  loadEnvConfig,
  mergeConfig,
  resolveRuntimeConfig,
  validateConfig,
} from './config';
import { stopBroadcastServer, startBroadcastServer } from './broadcast/websocketServer';
import { AgentStatusReducer } from './hooks/status-reducer';
import { AgentRunTracker } from './hooks/agent-run-tracker';
import { SubagentTracker } from './hooks/subagent-tracker';
import { SessionTracker } from './hooks/session-hooks';
import { ToolCallTracker } from './hooks/tool-hooks';
import { EventFileLogger, getRuntimeLogger } from './logging';
import { createHookBridge } from './runtime/hook-bridge';
import { createInternalHandlers } from './runtime/internal-handlers';
import { detectOpenClawRuntimeKind, resolveAutoTransportMode } from './runtime/runtime-kind';
import { createRuntimeEventOps } from './runtime/runtime-events';
import { registerTypedHooks } from './runtime/typed-hooks';
import { OpenClawPluginApi, PendingToolCall, PluginState, RuntimeLogger } from './runtime/types';
import { PLUGIN_VERSION } from './version';
import {
  getApiConfig,
  getWebSocketPorts,
  isStatusTickerDisabled,
  isWebSocketDisabled,
  normalizeError,
  registerInternalHook,
} from './runtime/utils';
import { TransportManager } from './transport/manager';
const DEFAULT_WS_PORTS = [9011, 9012, 9013, 9014, 9015, 9016];
const TOOL_GUARD_TRACE =
  process.env.EVENT_PLUGIN_TOOL_GUARD_TRACE === '1' ||
  process.env.EVENT_PLUGIN_TOOL_GUARD_TRACE === 'true';

function toMessage(args: unknown[]): string {
  return args
    .map((value) => {
      if (typeof value === 'string') {
        return value;
      }
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(' ');
}

export function createPlugin() {
  const state: PluginState = {
    config: { ...DEFAULT_CONFIG },
    toolTracker: new ToolCallTracker(),
    pendingToolCalls: new Map<string, PendingToolCall>(),
    pendingToolCallsByContext: new WeakMap<object, PendingToolCall>(),
    sessionTracker: new SessionTracker(),
    agentRunTracker: new AgentRunTracker(),
    statusReducer: new AgentStatusReducer(),
    subagentTracker: new SubagentTracker(),
    eventFileLogger: undefined,
    eventFileLoggerReady: undefined,
    statusTimer: undefined,
    isInitialized: false,
    websocketEnabled: true,
    runtimeId: randomUUID(),
    runtimeKind: 'unknown',
    transportRole: 'follower',
    transportManager: undefined,
    hookBridge: undefined,
  };

  const logger: RuntimeLogger = {
    debug: (...args: unknown[]) => {
      if (state.config.logging.debug) {
        getRuntimeLogger().debug('[event-plugin:debug]', ...args);
        state.eventFileLogger?.logRuntime('debug', '[event-plugin:debug]', args);
      }
    },
    info: (...args: unknown[]) => {
      getRuntimeLogger().info('[event-plugin:info]', ...args);
      state.eventFileLogger?.logRuntime('info', '[event-plugin:info]', args);
    },
    warn: (...args: unknown[]) => {
      getRuntimeLogger().warn('[event-plugin:warn]', ...args);
      state.eventFileLogger?.logRuntime('warn', '[event-plugin:warn]', args);
    },
    error: (...args: unknown[]) => {
      if (state.config.logging.logErrors) {
        getRuntimeLogger().error('[event-plugin:error]', ...args);
        state.eventFileLogger?.logRuntime('error', '[event-plugin:error]', args);
      }
    },
    queue: (...args: unknown[]) => {
      if (state.config.logging.logQueue) {
        getRuntimeLogger().debug('[event-plugin:queue]', ...args);
        state.eventFileLogger?.logRuntime('debug', '[event-plugin:queue]', args);
      }
    },
  };

  function stopEventFileLogger(): void {
    if (!state.eventFileLogger) {
      return;
    }

    void state.eventFileLogger.stop().catch((error: unknown) => {
      getRuntimeLogger().error('[event-plugin:error] Failed to stop event file logger', toMessage([error]));
    });
    state.eventFileLogger = undefined;
    state.eventFileLoggerReady = undefined;
  }

  function resetState(ops: ReturnType<typeof createRuntimeEventOps>): void {
    ops.stopStatusTimer();
    state.queue?.stop();
    state.queue = undefined;
    state.toolTracker.clear();
    state.pendingToolCalls.clear();
    state.pendingToolCallsByContext = new WeakMap<object, PendingToolCall>();
    state.sessionTracker.clear();
    state.agentRunTracker.clear();
    state.statusReducer.clear();
    state.subagentTracker.clear();
    state.runtimeKind = 'unknown';
    state.transportRole = 'follower';
    if (state.transportManager) {
      void state.transportManager.stop().catch((error: unknown) => {
        getRuntimeLogger().error('[event-plugin:error] Failed to stop transport manager', toMessage([error]));
      });
      state.transportManager = undefined;
    }
    if (state.hookBridge) {
      void state.hookBridge.stop().catch((error: unknown) => {
        getRuntimeLogger().error('[event-plugin:error] Failed to stop hook bridge', toMessage([error]));
      });
      state.hookBridge = undefined;
    }
    stopEventFileLogger();
  }

  function initializeConfig(api: OpenClawPluginApi): void {
    const baseConfig = getApiConfig<PluginConfig>(api);
    const envConfig = loadEnvConfig();
    state.config = resolveRuntimeConfig(mergeConfig(baseConfig, envConfig));
    state.statusReducer = new AgentStatusReducer({
      workingWindowMs: state.config.status.workingWindowMs,
      sleepingWindowMs: state.config.status.sleepingWindowMs,
    });

    state.runtimeKind = detectOpenClawRuntimeKind();
    if (state.config.transport.mode === 'auto') {
      state.config = {
        ...state.config,
        transport: {
          ...state.config.transport,
          mode: resolveAutoTransportMode(state.runtimeKind),
        },
      };

      logger.info('[Transport] Resolved auto transport mode for runtime', {
        runtimeKind: state.runtimeKind,
        transportMode: state.config.transport.mode,
      });
      if (state.runtimeKind === 'unknown') {
        logger.warn(
          '[Transport] Could not positively identify runtime kind in auto mode; defaulting to follower transport',
        );
      }
    }

    const validation = validateConfig(state.config);
    if (!validation.valid) {
      throw new Error(`Configuration validation failed: ${validation.errors.join('; ')}`);
    }

    if (TOOL_GUARD_TRACE) {
      logger.info('[ToolGuardTrace] config.input', {
        apiConfigKeys: Object.keys(baseConfig),
        hasHookBridge: Boolean(baseConfig.hookBridge),
        hasToolGuard: Boolean(baseConfig.hookBridge?.toolGuard),
        apiEnabled: baseConfig.enabled,
      });

      const actionIds = Object.keys(state.config.hookBridge.actions ?? {});
      const bridgeRuleIds = (state.config.hookBridge.rules ?? []).map((rule) => rule.id);
      const guardRuleIds = (state.config.hookBridge.toolGuard.rules ?? []).map((rule) => rule.id);
      logger.info('[ToolGuardTrace] config.loaded', {
        hookBridgeEnabled: state.config.hookBridge.enabled,
        toolGuardEnabled: state.config.hookBridge.toolGuard.enabled,
        toolGuardDryRun: state.config.hookBridge.toolGuard.dryRun,
        toolGuardOnError: state.config.hookBridge.toolGuard.onError,
        toolGuardRules: guardRuleIds,
        bridgeRules: bridgeRuleIds,
        actions: actionIds,
      });
    }
  }

  function initializeEventFileLogger(): void {
    if (!state.config.eventLog.enabled) {
      return;
    }
    state.eventFileLogger = new EventFileLogger(state.config.eventLog);
    state.eventFileLoggerReady = state.eventFileLogger.start().catch((error: unknown) => {
      state.eventFileLogger = undefined;
      state.eventFileLoggerReady = undefined;
      getRuntimeLogger().error('[event-plugin:error] Failed to start event file logger', toMessage([error]));
    });
  }

  function maybeStartWebSocketServer(): void {
    if (isWebSocketDisabled()) {
      state.websocketEnabled = false;
      void stopBroadcastServer();
      logger.info('WebSocket broadcast server disabled via EVENT_PLUGIN_DISABLE_WS');
      return;
    }

    state.websocketEnabled = true;
    try {
      const wsPorts = getWebSocketPorts(DEFAULT_WS_PORTS);
      startBroadcastServer({
        port: wsPorts[0],
        fallbackPorts: wsPorts.slice(1),
        host: state.config.security.ws.bindAddress,
        requireAuth: state.config.security.ws.requireAuth,
        authToken: state.config.security.ws.authToken,
        allowedOrigins: state.config.security.ws.allowedOrigins,
        allowedIps: state.config.security.ws.allowedIps,
      });
      logger.info(
        `WebSocket broadcast server startup requested on ws://${state.config.security.ws.bindAddress}:${wsPorts[0]} (fallbacks: ${wsPorts
          .slice(1)
          .join(', ') || 'none'})`,
      );
    } catch (error) {
      const startupError = normalizeError(error);
      logger.error('Failed to start WebSocket broadcast server:', startupError.message);
    }
  }

  function initializeTransport(ops: ReturnType<typeof createRuntimeEventOps>): void {
    state.transportManager = new TransportManager({
      config: state.config.transport,
      logger,
      runtimeId: state.runtimeId,
      onOwnerEvent: ops.transportEvent,
      onRoleChange: (role) => {
        state.transportRole = role;
        if (role === 'follower') {
          state.websocketEnabled = false;
          // A demoted owner must release the singleton WebSocket server
          // immediately so followers never continue serving broadcast traffic.
          void stopBroadcastServer().catch((error: unknown) => {
            getRuntimeLogger().error(
              '[event-plugin:error] Failed to stop WebSocket server after follower demotion',
              toMessage([error]),
            );
          });
          state.queue?.stop();
          state.queue = undefined;
          stopEventFileLogger();
          logger.info(
            'Running as follower transport runtime; transport ownership is delegated to another process',
          );
          return;
        }

        if (!state.eventFileLogger) {
          initializeEventFileLogger();
        }
        maybeStartWebSocketServer();
        ops.maybeInitializeQueue();
      },
    });
    state.transportManager.start();
  }

  function registerHooks(api: OpenClawPluginApi, ops: ReturnType<typeof createRuntimeEventOps>): void {
    const handlers = createInternalHandlers({ state, ops });

    registerInternalHook(
      logger,
      api,
      'message:received',
      { name: 'event-plugin.message-received', description: 'Broadcast message.received events' },
      handlers.handleMessageReceived,
    );
    registerInternalHook(
      logger,
      api,
      'message:transcribed',
      { name: 'event-plugin.message-transcribed', description: 'Broadcast message.transcribed events' },
      handlers.handleMessageTranscribed,
    );
    registerInternalHook(
      logger,
      api,
      'message:preprocessed',
      { name: 'event-plugin.message-preprocessed', description: 'Broadcast message.preprocessed events' },
      handlers.handleMessagePreprocessed,
    );
    registerInternalHook(
      logger,
      api,
      'message:sent',
      { name: 'event-plugin.message-sent', description: 'Broadcast message.sent events' },
      handlers.handleMessageSent,
    );
    registerInternalHook(
      logger,
      api,
      'command:new',
      { name: 'event-plugin.command-new', description: 'Broadcast command.new events' },
      (event) => handlers.handleCommand('new', event),
    );
    registerInternalHook(
      logger,
      api,
      'command:reset',
      { name: 'event-plugin.command-reset', description: 'Broadcast command.reset events' },
      (event) => handlers.handleCommand('reset', event),
    );
    registerInternalHook(
      logger,
      api,
      'command:stop',
      { name: 'event-plugin.command-stop', description: 'Broadcast command.stop events' },
      (event) => handlers.handleCommand('stop', event),
    );
    registerInternalHook(
      logger,
      api,
      'agent:bootstrap',
      { name: 'event-plugin.agent-bootstrap', description: 'Broadcast agent.bootstrap events' },
      handlers.handleAgentBootstrap,
    );
    registerInternalHook(
      logger,
      api,
      'agent:error',
      { name: 'event-plugin.agent-error', description: 'Broadcast agent.error events' },
      handlers.handleAgentError,
    );
    registerInternalHook(
      logger,
      api,
      'agent:session:start',
      { name: 'event-plugin.agent-session-start', description: 'Broadcast agent.session_start events' },
      (event) => handlers.handleAgentSessionEvent('agent.session_start', event),
    );
    registerInternalHook(
      logger,
      api,
      'agent:session:end',
      { name: 'event-plugin.agent-session-end', description: 'Broadcast agent.session_end events' },
      (event) => handlers.handleAgentSessionEvent('agent.session_end', event),
    );
    registerInternalHook(
      logger,
      api,
      'gateway:startup',
      { name: 'event-plugin.gateway-startup', description: 'Broadcast gateway.startup events' },
      handlers.handleGatewayStartup,
    );

    registerTypedHooks(api, { state, logger, ops });
  }

  function activate(api: OpenClawPluginApi): void {
    const ops = createRuntimeEventOps(state, logger);

    if (state.isInitialized) {
      logger.warn(
        'Plugin already activated; reusing active runtime state and binding hooks to the new plugin registry',
      );
      registerHooks(api, ops);
      return;
    }

    logger.info('Activating OpenClaw Event Server Plugin v' + PLUGIN_VERSION);

    resetState(ops);
    state.runtimeId = randomUUID();
    initializeConfig(api);
    state.hookBridge = createHookBridge(state.config, logger);

    if (!state.config.enabled) {
      state.websocketEnabled = false;
      void stopBroadcastServer();
      state.isInitialized = true;
      logger.info('Plugin is disabled via configuration');
      return;
    }

    initializeTransport(ops);
    registerHooks(api, ops);

    if (!isStatusTickerDisabled()) {
      ops.startStatusTimer(state.config.status.tickIntervalMs, () => {
        void ops.emitAgentStatusTransitions();
        void ops.emitSubagentIdleTransitions();
      });
    }

    state.isInitialized = true;
    logger.info('Plugin activated successfully', {
      runtimeId: state.runtimeId,
      runtimeKind: state.runtimeKind,
      transportRole: state.transportRole,
      transportMode: state.config.transport.mode,
    });
  }

  async function deactivate(): Promise<void> {
    const ops = createRuntimeEventOps(state, logger);
    const transportManager = state.transportManager;
    state.transportManager = undefined;
    await transportManager?.stop();
    resetState(ops);
    state.websocketEnabled = true;
    state.isInitialized = false;
    await stopBroadcastServer();
    logger.info('Plugin deactivated');
  }

  return {
    id: 'event-server-plugin',
    name: 'OpenClaw Event Server Plugin',
    version: PLUGIN_VERSION,
    configSchema: CONFIG_SCHEMA,
    activate,
    deactivate,
  };
}

const plugin = createPlugin();

export default plugin;
