# OpenClaw Event Server Plugin

OpenClaw Event Server Plugin turns agent runtime behavior into a real-time event stream you can automate against.

It gives you:

- A canonical event stream for agent/session/tool lifecycle activity
- Real-time delivery over WebSocket and HTTP webhooks
- A Hook Bridge to trigger scripts/webhooks from matching events
- Tool Guard controls to approve, patch, or block risky tool calls before execution

## Why Teams Use It

Common outcomes:

- Real-time operations visibility (`agent.status`, `agent.activity`, session events)
- Alerting and incident response from failures/stalls/tool errors
- Human approval gates for high-risk tool usage (`exec`, network/browser tools)
- Workflow chaining between parent/subagent runs
- Structured audit/event logs for compliance and analytics

## Example User Scenarios

- Content studio control room: watch multiple agents, detect stuck runs, gate publishing actions behind approvals.
- Founder ops autopilot: route session/tool events into Slack/automation for inbox triage and lead workflows.
- Stream reliability: detect stalled/ended agent sessions and trigger recovery hooks automatically.
- Knowledge capture: persist successful tool paths and outcomes to your internal systems.

## Install

### Option 1: from npm (recommended)

```bash
openclaw plugins install openclaw-event-server-plugin
```

### Option 2: from local source

```bash
npm install
npm run build
openclaw plugins install -l /absolute/path/to/openclaw_event_server_plugin
```

## Quick Start

Add plugin config in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "event-server-plugin": {
        "enabled": true,
        "config": {
          "webhooks": [
            {
              "url": "https://example.com/events",
              "method": "POST"
            }
          ],
          "transport": {
            "mode": "auto"
          },
          "hookBridge": {
            "enabled": false,
            "toolGuard": {
              "enabled": false
            }
          }
        }
      }
    }
  }
}
```

Then start OpenClaw and connect a WebSocket client to:

- `ws://127.0.0.1:9011/` (falls back across `9012-9016`)

For multi-runtime hosts, use `transport.mode: "auto"` and set `transport.authToken`. In `auto`, the gateway runtime owns transport and other OpenClaw runtimes relay their events into it.

Important deployment note:

- `auto` depends on the process looking like the real OpenClaw gateway runtime
- if you launch the gateway through a wrapper with a nonstandard process title/argv, set `EVENT_PLUGIN_RUNTIME_KIND_OVERRIDE=gateway`
- if you launch background workers or agent-side helpers through wrappers, set `EVENT_PLUGIN_RUNTIME_KIND_OVERRIDE=agent`

This keeps ownership predictable: gateway publishes the public event stream, all other runtimes remain local event producers.

Embedded runtime note:

- OpenClaw can rebuild plugin registries multiple times inside the same long-lived gateway process.
- The plugin now treats repeated `activate()` calls as a normal lifecycle event: it keeps the active transport/runtime state and re-binds hooks into the new registry.
- If you see `Plugin already activated; reusing active runtime state and binding hooks to the new plugin registry`, that is expected and prevents non-main embedded agents from losing tool hook emission.

## For Developers

```bash
npm install
npm run build
npm test
```

Useful files:

- `config.example.json`
- `CHANGELOG.md`
- `examples/tool-guard-bundles/`
- `TESTING.md`
- `CONTRIBUTING.md`
- `.nvmrc`
- `docs/release.md`

## Documentation

Implementation docs now live in [`docs/`](./docs/README.md):

- [API](./docs/api.md)
- [Events (exhaustive)](./docs/events.md)
- [Transport](./docs/transport.md)
- [Socket Layer](./docs/socket-layer.md)
- [Security](./docs/security.md)
- [Hook Bridge](./docs/hookbridge.md)
- [Tool Guard](./docs/Tool_guard.md)
- [Backend](./docs/backend.md)
- [UI Integration](./docs/ui.md)
- [Testing](./docs/testing.md)
- [Release](./docs/release.md)

## Compatibility

Compatibility is pinned to the OpenClaw hook surface fixture and verified by contract tests:

- fixture: `tests/fixtures/openclaw-hook-surface.v3caab92.json`
- contracts: `tests/contract/`

Release publishing is pinned to the repository toolchain in [`.nvmrc`](/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/.nvmrc), while CI also exercises newer supported Node majors for runtime compatibility.

## License

MIT
