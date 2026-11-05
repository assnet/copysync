import { describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env';
import { buildDatasourceUrl } from './datasourceUrl';

const BASE = 'postgresql://u:p%40ss@host:5432/db';

describe('buildDatasourceUrl (DATABASE_SOCKET_TIMEOUT_S)', () => {
  it('sem a env: undefined (Prisma usa a DATABASE_URL como hoje)', () => {
    expect(buildDatasourceUrl(`${BASE}?connection_limit=5`, undefined)).toBeUndefined();
  });

  it('URL sem query: acrescenta ?socket_timeout', () => {
    expect(buildDatasourceUrl(BASE, 30)).toBe(`${BASE}?socket_timeout=30`);
  });

  it('URL com query: acrescenta &socket_timeout e preserva o resto', () => {
    expect(buildDatasourceUrl(`${BASE}?connection_limit=5`, 30)).toBe(`${BASE}?connection_limit=5&socket_timeout=30`);
  });

  it('URL que já tem socket_timeout: não duplica', () => {
    const url = `${BASE}?connection_limit=5&socket_timeout=10`;
    expect(buildDatasourceUrl(url, 30)).toBe(url);
    expect(buildDatasourceUrl(`${BASE}?socket_timeout=10`, 30)).toBe(`${BASE}?socket_timeout=10`);
  });
});

describe('DATABASE_SOCKET_TIMEOUT_S (env)', () => {
  const parse = (v: string | undefined) => parseEnv({ ...process.env, DATABASE_SOCKET_TIMEOUT_S: v });

  it('ausente = undefined; inteiro positivo aceito', () => {
    const absent = parse(undefined);
    expect(absent.success && absent.data.DATABASE_SOCKET_TIMEOUT_S).toBeUndefined();
    const set = parse('30');
    expect(set.success && set.data.DATABASE_SOCKET_TIMEOUT_S).toBe(30);
  });

  it.each(['0', '-5', '1.5', 'abc'])('rejeita %s', (v) => {
    expect(parse(v).success).toBe(false);
  });
});
