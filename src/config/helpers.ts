import { readFileSync } from 'node:fs';

export function isTrue(value: string): boolean {
  return value === 'true' || value === '1';
}

export function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseCsv(raw: string | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return parsed.length > 0 ? parsed : undefined;
}

export function loadSecretFromFile(secretFilePath?: string): string | undefined {
  if (!secretFilePath || secretFilePath.trim() === '') {
    return undefined;
  }

  try {
    const raw = readFileSync(secretFilePath, 'utf8').trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}
