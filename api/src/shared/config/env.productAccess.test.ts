import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = { DATABASE_URL: 'postgresql://t:t@localhost:5432/t', JWT_SECRET: 'x'.repeat(40), NODE_ENV: 'test', CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
const parse = (extra: Record<string, string>) => {
  const r = parseEnv({ ...base, ...extra });
  if (!r.success) throw r.error;
  return r.data;
};

describe('env do acesso por produto', () => {
  it('padrão off (vazio também)', () => {
    expect(parse({}).PRODUCT_ACCESS_GATE_MODE).toBe('off');
    expect(parse({ PRODUCT_ACCESS_GATE_MODE: ' ' }).PRODUCT_ACCESS_GATE_MODE).toBe('off');
  });
  it('aceita log e ENFORCE', () => {
    expect(parse({ PRODUCT_ACCESS_GATE_MODE: 'log' }).PRODUCT_ACCESS_GATE_MODE).toBe('log');
    expect(parse({ PRODUCT_ACCESS_GATE_MODE: ' ENFORCE ' }).PRODUCT_ACCESS_GATE_MODE).toBe('enforce');
  });
  it('modo inválido derruba a validação', () => {
    expect(parseEnv({ ...base, PRODUCT_ACCESS_GATE_MODE: 'monitor' }).success).toBe(false);
  });
});
