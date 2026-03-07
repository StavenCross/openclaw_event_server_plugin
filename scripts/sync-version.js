#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageVersion = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version;

const replacements = [
  {
    file: 'openclaw.plugin.json',
    replace: /"version":\s*"[^"]+"/,
    value: `"version": "${packageVersion}"`,
  },
  {
    file: 'src/version.ts',
    replace: /export const PLUGIN_VERSION = '[^']+';/,
    value: `export const PLUGIN_VERSION = '${packageVersion}';`,
  },
  {
    file: 'docs/api.md',
    replace: /pluginVersion: string` \(currently `[^`]+`\)/,
    value: `pluginVersion: string\` (currently \`${packageVersion}\`)`,
  },
  {
    file: 'docs/api.md',
    replace: /Header `User-Agent: OpenClaw-Event-Plugin\/[^`]+`/,
    value: `Header \`User-Agent: OpenClaw-Event-Plugin/${packageVersion}\``,
  },
];

for (const entry of replacements) {
  const filePath = path.join(rootDir, entry.file);
  const original = fs.readFileSync(filePath, 'utf8');
  if (!entry.replace.test(original)) {
    throw new Error(`Failed to update version in ${entry.file}`);
  }
  const updated = original.replace(entry.replace, entry.value);
  fs.writeFileSync(filePath, updated);
}
