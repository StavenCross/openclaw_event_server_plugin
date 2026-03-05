import { registerGatewayTypedHooks } from './register-gateway-hooks';
import { registerSessionHooks } from './register-session-hooks';
import { registerSubagentHooks } from './register-subagent-hooks';
import { registerToolHooks } from './register-tool-hooks';
import { RuntimeEventOps } from './runtime-events';
import { OpenClawPluginApi, PluginState, RuntimeLogger } from './types';

export interface TypedHookDeps {
  state: PluginState;
  logger: RuntimeLogger;
  ops: RuntimeEventOps;
}

export function registerTypedHooks(api: OpenClawPluginApi, deps: TypedHookDeps): void {
  registerToolHooks(api, deps);
  registerSessionHooks(api, deps);
  registerSubagentHooks(api, deps);
  registerGatewayTypedHooks(api, deps);
}
