import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_SCHEMA } from '../../src/config';

describe('config schema parity', () => {
  it('keeps the transport schema in openclaw.plugin.json aligned with CONFIG_SCHEMA', () => {
    const pluginDefinition = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'openclaw.plugin.json'), 'utf8'),
    ) as {
      configSchema: {
        properties: {
          transport: unknown;
        };
      };
    };

    const runtimeSchema = CONFIG_SCHEMA as {
      properties: {
        transport: unknown;
      };
    };

    expect(pluginDefinition.configSchema.properties.transport).toEqual(runtimeSchema.properties.transport);
  });
});
