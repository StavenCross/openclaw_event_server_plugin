import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  DEFAULT_CONFIG,
  loadEnvConfig,
  mergeConfig,
  resolveRuntimeConfig,
  validateConfig,
} from '../../src/config';

describe('HMAC secret file runtime behavior', () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tempDir = mkdtempSync(join(tmpdir(), 'event-plugin-hmac-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('fails validation when HMAC is enabled and secret file path is missing', () => {
    process.env.EVENT_PLUGIN_HMAC_ENABLED = 'true';
    process.env.EVENT_PLUGIN_HMAC_SECRET_FILE = join(tempDir, 'missing.secret');

    const merged = mergeConfig({}, loadEnvConfig());
    const validation = validateConfig(merged);

    expect(merged.security.hmac.enabled).toBe(true);
    expect(merged.security.hmac.secret).toBeUndefined();
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(
      'Security hmac.secret or hmac.secretFilePath is required when hmac.enabled is true',
    );
  });

  it('fails validation when HMAC secret file exists but is empty', () => {
    const secretFilePath = join(tempDir, 'empty.secret');
    writeFileSync(secretFilePath, '   \n', 'utf8');

    process.env.EVENT_PLUGIN_HMAC_ENABLED = 'true';
    process.env.EVENT_PLUGIN_HMAC_SECRET_FILE = secretFilePath;

    const merged = mergeConfig({}, loadEnvConfig());
    const validation = validateConfig(merged);

    expect(merged.security.hmac.enabled).toBe(true);
    expect(merged.security.hmac.secret).toBeUndefined();
    expect(validation.valid).toBe(false);
  });

  it('loads secret from file when path is valid', () => {
    const secretFilePath = join(tempDir, 'valid.secret');
    writeFileSync(secretFilePath, 'local-file-secret\n', 'utf8');

    process.env.EVENT_PLUGIN_HMAC_ENABLED = 'true';
    process.env.EVENT_PLUGIN_HMAC_SECRET_FILE = secretFilePath;

    const merged = mergeConfig({}, loadEnvConfig());
    const validation = validateConfig(merged);

    expect(merged.security.hmac.enabled).toBe(true);
    expect(merged.security.hmac.secret).toBe('local-file-secret');
    expect(validation.valid).toBe(true);
  });

  it('resolves runtime HMAC secret from file for config-only setups', () => {
    const secretFilePath = join(tempDir, 'runtime.secret');
    writeFileSync(secretFilePath, 'runtime-secret\n', 'utf8');

    const runtime = resolveRuntimeConfig({
      ...DEFAULT_CONFIG,
      security: {
        ...DEFAULT_CONFIG.security,
        hmac: {
          ...DEFAULT_CONFIG.security.hmac,
          enabled: true,
          secret: undefined,
          secretFilePath,
        },
      },
    });

    expect(runtime.security.hmac.secret).toBe('runtime-secret');
  });
});
