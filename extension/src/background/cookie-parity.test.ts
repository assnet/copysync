import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const extractArray = (content: string, name: string): string[] => {
  const re = new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]+)\\]`);
  const match = content.match(re);
  if (!match) throw new Error(`${name} not found`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
};

const extPath = resolve(__dirname, './constants.ts');
const apiPath = resolve(__dirname, '../../../api/src/modules/extension/domain/constants.ts');

const extSrc = readFileSync(extPath, 'utf8');
const apiSrc = readFileSync(apiPath, 'utf8');

describe('ML cookie parity (extension ↔ API)', () => {
  it('ML_SESSION_COOKIES match', () => {
    expect(extractArray(extSrc, 'ML_SESSION_COOKIES')).toEqual(extractArray(apiSrc, 'ML_SESSION_COOKIES'));
  });

  it('ML_TEMP_COOKIES match', () => {
    expect(extractArray(extSrc, 'ML_TEMP_COOKIES')).toEqual(extractArray(apiSrc, 'ML_TEMP_COOKIES'));
  });

  it('ML_SERVER_COOKIES is union of session + temp', () => {
    const session = extractArray(extSrc, 'ML_SESSION_COOKIES');
    const temp = extractArray(extSrc, 'ML_TEMP_COOKIES');
    const server = extractArray(apiSrc, 'ML_SESSION_COOKIES').concat(extractArray(apiSrc, 'ML_TEMP_COOKIES'));
    expect([...session, ...temp]).toEqual(server);
  });
});
