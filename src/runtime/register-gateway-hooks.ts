import { createGatewayPluginStartEvent, createGatewayPluginStopEvent } from '../hooks/gateway-hooks';
import type { OpenClawPluginApi } from './types';
import type { TypedHookDeps } from './typed-hooks';
import { isRecord, readNumber, readString, registerTypedHook } from './utils';

export function registerGatewayTypedHooks(api: OpenClawPluginApi, deps: TypedHookDeps): void {
  const { state, logger, ops } = deps;

  registerTypedHook(
    logger,
    api,
    'gateway_start',
    { name: 'event-plugin.gateway-start', description: 'Broadcast gateway.start events' },
    async (rawEvent) => {
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const event = createGatewayPluginStartEvent({
        port: readNumber(raw.port),
        data: raw,
      });
      await ops.broadcastEvent(event);
    },
  );

  registerTypedHook(
    logger,
    api,
    'gateway_stop',
    { name: 'event-plugin.gateway-stop', description: 'Broadcast gateway.stop events' },
    async (rawEvent) => {
      const raw = isRecord(rawEvent) ? rawEvent : {};
      const event = createGatewayPluginStopEvent({
        reason: readString(raw.reason),
        data: raw,
      });
      await ops.broadcastEvent(event);
      state.statusReducer.markAllOffline();
      await ops.emitAgentStatusTransitions('gateway.stop');
    },
  );
}
