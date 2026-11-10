import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = { ...process.env, OFFER_DISPATCH_CONCURRENCY: undefined };
const parse = (v?: string) => parseEnv({ ...base, OFFER_DISPATCH_CONCURRENCY: v });

describe('OFFER_DISPATCH_CONCURRENCY', () => {
  it('padrão 1 (envio serial de hoje)', () => {
    const r = parse(undefined);
    expect(r.success && r.data.OFFER_DISPATCH_CONCURRENCY).toBe(1);
  });

  it('aceita 1 e 2', () => {
    for (const v of ['1', '2']) {
      const r = parse(v);
      expect(r.success && r.data.OFFER_DISPATCH_CONCURRENCY).toBe(Number(v));
    }
  });

  it('rejeita 0, 3, fração, NaN e vazio', () => {
    for (const v of ['0', '3', '1.5', 'abc', '']) expect(parse(v).success).toBe(false);
  });
});
