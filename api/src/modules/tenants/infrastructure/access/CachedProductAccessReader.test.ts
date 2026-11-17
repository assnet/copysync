import { describe, expect, it, vi } from 'vitest';
import type { TenantProduct } from '../../domain/contracts/ITenantProductRepository';
import { CachedProductAccessReader } from './CachedProductAccessReader';
import { AlwaysGrantedProductAccessReader } from './AlwaysGrantedProductAccessReader';

const line = (product: TenantProduct['product'], status: TenantProduct['status']): TenantProduct => ({
  tenantId: 't1', product, status, planSlug: null, expiresAt: null, source: 'BILLING', inactiveSince: null, updatedAt: new Date(0),
});

function setup(rows: TenantProduct[] = []) {
  let t = 1_000;
  const findAll = vi.fn(async () => rows);
  const reader = new CachedProductAccessReader({ findAll }, { now: () => t, ttlMs: 45_000 });
  return { reader, findAll, advance: (ms: number) => { t += ms; } };
}

describe('CachedProductAccessReader', () => {
  it('sem linha: legado ativo, novo inativo', async () => {
    const { reader } = setup();
    expect(await reader.has('t1', 'AFFILIATES')).toBe(true);
    expect(await reader.has('t1', 'CHAT')).toBe(true);
    expect(await reader.has('t1', 'SAVER')).toBe(false);
    expect(await reader.list('t1')).toEqual(['AFFILIATES', 'CHAT']);
  });

  it('linha decide; CHAT acompanha AFFILIATES', async () => {
    const { reader } = setup([line('AFFILIATES', 'INACTIVE'), line('SAVER', 'ACTIVE')]);
    expect(await reader.has('t1', 'AFFILIATES')).toBe(false);
    expect(await reader.has('t1', 'CHAT')).toBe(false);
    expect(await reader.list('t1')).toEqual(['SAVER']);
  });

  it('cache por 45 s e uma consulta para leituras simultâneas', async () => {
    const { reader, findAll, advance } = setup();
    await Promise.all([reader.has('t1', 'AFFILIATES'), reader.has('t1', 'SAVER'), reader.list('t1')]);
    expect(findAll).toHaveBeenCalledTimes(1);
    advance(44_999);
    await reader.has('t1', 'CHAT');
    expect(findAll).toHaveBeenCalledTimes(1);
    advance(1);
    await reader.has('t1', 'CHAT');
    expect(findAll).toHaveBeenCalledTimes(2);
  });

  it('invalidate força nova leitura só do tenant', async () => {
    const { reader, findAll } = setup();
    await reader.list('t1');
    await reader.list('t2');
    reader.invalidate('t1');
    await reader.list('t1');
    await reader.list('t2');
    expect(findAll.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['t1', 't2', 't1']);
  });

  it('leitura em andamento durante invalidate não repõe dado velho', async () => {
    let release!: (v: TenantProduct[]) => void;
    const findAll = vi.fn()
      .mockImplementationOnce(() => new Promise<TenantProduct[]>((r) => { release = r; }))
      .mockResolvedValue([line('SAVER', 'ACTIVE')]);
    const reader = new CachedProductAccessReader({ findAll });
    const first = reader.has('t1', 'SAVER');
    reader.invalidate('t1');
    release([]);
    expect(await first).toBe(false);
    expect(await reader.has('t1', 'SAVER')).toBe(true);
  });

  it('erro sobe e não fica guardado', async () => {
    const findAll = vi.fn().mockRejectedValueOnce(new Error('db')).mockResolvedValue([]);
    const reader = new CachedProductAccessReader({ findAll });
    await expect(reader.has('t1', 'AFFILIATES')).rejects.toThrow('db');
    expect(await reader.has('t1', 'AFFILIATES')).toBe(true);
  });

  it('prazo estourado = erro', async () => {
    const reader = new CachedProductAccessReader({ findAll: () => new Promise(() => {}) }, { readTimeoutMs: 5 });
    await expect(reader.list('t1')).rejects.toThrow('timeout');
  });
});

describe('AlwaysGrantedProductAccessReader', () => {
  it('libera tudo', async () => {
    const r = new AlwaysGrantedProductAccessReader();
    expect(await r.has()).toBe(true);
    expect(await r.list()).toEqual(['AFFILIATES', 'CHAT', 'SAVER']);
  });
});
