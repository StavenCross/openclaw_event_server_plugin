# Security

## Security Surfaces

This plugin has four primary security surfaces:

- WebSocket client access (`security.ws`)
- Webhook egress and auth headers
- Event integrity signing (`security.hmac`)
- Hook Bridge local script execution controls

## WebSocket Controls

`security.ws` supports:

- `bindAddress`: bind to loopback by default (`127.0.0.1`)
- `requireAuth`: require token to connect
- `authToken`: shared token
- `allowedOrigins`: Origin allowlist
- `allowedIps`: client IP allowlist

Recommended hardening:

- Keep `bindAddress=127.0.0.1` unless remote access is required.
- Enable `requireAuth` for non-local consumers.
- Set both `allowedOrigins` and `allowedIps` in shared-network environments.

## HMAC Signing

Enable HMAC signing with:

- `security.hmac.enabled=true`
- `security.hmac.secret` or `security.hmac.secretFilePath`
- `security.hmac.algorithm=sha256|sha512`

Each outbound event then includes a `signature` object:

- `version`
- `algorithm`
- `timestamp`
- `nonce`
- `value`

Use this to verify authenticity and freshness in downstream consumers.

## Payload Redaction

Two redaction scopes exist:

- Global transport redaction: `redaction.*`
- Tool guard event-param redaction: `hookBridge.toolGuard.redaction.*`

Redaction is recursive by key name (case-insensitive) and replaces values with the configured `replacement` string.

## Webhook Security

Webhook sender supports:

- HTTP(S)-only URL validation
- Optional bearer token per endpoint (`authToken`)
- Timeout and retry controls
- Correlation header injection

Recommended hardening:

- Use HTTPS endpoints only.
- Keep auth tokens in secrets/env, not committed config files.
- Restrict webhook endpoints to internal API gateways when possible.
- Treat gateway debug logs as sensitive operational data. In observed OpenClaw gateway output, debug/startup config dumps included plugin configuration values and embedded credentials. Avoid leaving gateway debug enabled in steady state, and do not ship logs off-box without redaction.

## Hook Bridge Script Security

Local scripts are restricted by:

- absolute `path` requirement
- `allowedActionDirs` allowlist
- timeout limits
- max payload byte limits

This prevents arbitrary script execution outside approved directories.

Best practices:

- Set `allowedActionDirs` to a dedicated, minimal directory.
- Keep scripts non-writable by untrusted users.
- Use separate service accounts for scripts that call external systems.

## Tool Guard Fail-Closed Choice

`hookBridge.toolGuard.onError` controls failure behavior:

- `allow`: fail-open on action errors/timeouts
- `block`: fail-closed on action errors/timeouts

For high-risk tools (`exec`, browser automation, network egress), prefer `block`.

## Transport Relay Security

If using single-owner transport with multiple runtimes:

- Set `transport.authToken` to require authenticated follower relay envelopes.
- Keep socket path in private directories with tight file permissions.

## Operational Safety Checklist

- Use loopback bind by default.
- Enable WS auth for shared hosts.
- Enable HMAC if events leave trusted boundary.
- Turn on redaction if prompts/content may contain secrets.
- Limit allowed local script directories.
- Prefer `toolGuard.onError=block` for privileged actions.
- Keep `.event-plugin-hmac.secret` and similar files out of VCS.
