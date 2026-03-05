import { GatewayEvent } from '../events/types';
import { createCanonicalEvent } from './event-factory';

export function createGatewayStartupEvent(context: {
  port?: number;
  data?: Record<string, unknown>;
}): GatewayEvent {
  return createCanonicalEvent({
    type: 'gateway.startup',
    eventCategory: 'gateway',
    eventName: 'gateway:startup',
    source: 'internal-hook',
    data: {
      port: context.port,
      ...(context.data ?? {}),
    },
  });
}

export function createGatewayPluginStartEvent(context: {
  port?: number;
  data?: Record<string, unknown>;
}): GatewayEvent {
  return createCanonicalEvent({
    type: 'gateway.start',
    eventCategory: 'gateway',
    eventName: 'gateway_start',
    source: 'plugin-hook',
    data: {
      port: context.port,
      ...(context.data ?? {}),
    },
  });
}

export function createGatewayPluginStopEvent(context: {
  reason?: string;
  data?: Record<string, unknown>;
}): GatewayEvent {
  return createCanonicalEvent({
    type: 'gateway.stop',
    eventCategory: 'gateway',
    eventName: 'gateway_stop',
    source: 'plugin-hook',
    data: {
      reason: context.reason,
      ...(context.data ?? {}),
    },
  });
}

