import { detectOpenClawRuntimeKind, resolveAutoTransportMode } from '../../src/runtime/runtime-kind';

describe('runtime kind detection', () => {
  it('detects gateway runtimes from process title', () => {
    expect(detectOpenClawRuntimeKind({ title: 'openclaw-gateway', argv: ['node'] })).toBe('gateway');
    expect(resolveAutoTransportMode('gateway')).toBe('owner');
  });

  it('detects agent runtimes from process title', () => {
    expect(detectOpenClawRuntimeKind({ title: 'openclaw-agent', argv: ['node'] })).toBe('agent');
    expect(resolveAutoTransportMode('agent')).toBe('follower');
  });

  it('detects gateway runtimes from argv tokens', () => {
    expect(detectOpenClawRuntimeKind({ argv: ['node', 'dist/index.js', 'gateway', '--port', '18789'] })).toBe(
      'gateway',
    );
  });

  it('does not misclassify incidental later argv tokens as the runtime kind', () => {
    expect(
      detectOpenClawRuntimeKind({
        argv: ['node', 'dist/index.js', 'message', 'send', '--target', 'gateway'],
        env: {},
      }),
    ).toBe('unknown');
  });

  it('supports explicit runtime override env', () => {
    expect(
      detectOpenClawRuntimeKind({
        title: 'openclaw-agent',
        env: { EVENT_PLUGIN_RUNTIME_KIND_OVERRIDE: 'gateway' },
      }),
    ).toBe('gateway');
  });

  it('defaults unknown runtimes to follower transport', () => {
    expect(detectOpenClawRuntimeKind({ title: 'node', argv: ['node', 'script.js'], env: {} })).toBe('unknown');
    expect(resolveAutoTransportMode('unknown')).toBe('follower');
  });
});
