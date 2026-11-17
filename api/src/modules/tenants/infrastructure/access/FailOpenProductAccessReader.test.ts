import { describe, expect, it, vi } from 'vitest';
import { FailOpenProductAccessReader } from './FailOpenProductAccessReader';

const inner = (has: () => Promise<boolean>) => ({ has: vi.fn(has), list: vi.fn(async () => []), invalidate: vi.fn() });

describe('FailOpenProductAccessReader', () => {
  it('repassa o resultado do leitor', async () => {
    expect(await new FailOpenProductAccessReader(inner(async () => false)).has('t1', 'AFFILIATES')).toBe(false);
    expect(await new FailOpenProductAccessReader(inner(async () => true)).has('t1', 'AFFILIATES')).toBe(true);
  });

  it('falha de leitura libera', async () => {
    const r = new FailOpenProductAccessReader(inner(async () => { throw new Error('timeout'); }));
    expect(await r.has('t1', 'AFFILIATES')).toBe(true);
  });
});
