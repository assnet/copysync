import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ML_SESSION_COOKIES, ML_TEMP_COOKIES } from './constants';

const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const apiConstantsPath = resolve(monorepoRoot, 'api/src/modules/extension/domain/constants.ts');

const extractArray = (content: string, name: string): string[] => {
  const re = new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]+)\\]`, 's');
  const match = content.match(re);
  if (!match) throw new Error(`${name} not found in API constants`);
  return match[1]
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(s => s && !s.startsWith('...'));
};

describe('cookie constant parity with API', () => {
  const apiContent = readFileSync(apiConstantsPath, 'utf8');

  it('ML_SESSION_COOKIES match API', () => {
    const apiList = extractArray(apiContent, 'ML_SESSION_COOKIES');
    expect([...ML_SESSION_COOKIES]).toEqual(apiList);
  });

  it('ML_TEMP_COOKIES match API', () => {
    const apiList = extractArray(apiContent, 'ML_TEMP_COOKIES');
    expect([...ML_TEMP_COOKIES]).toEqual(apiList);
  });
});
