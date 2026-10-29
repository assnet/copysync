import { describe, expect, it, vi } from 'vitest';
import { makeDomain } from '../../application/use-cases/linkRotationTestFakes';
import { ACTIVE_LINK_DOMAIN_RETRY_MS, ACTIVE_LINK_DOMAIN_TTL_MS, ActiveLinkDomainCache } from './ActiveLinkDomainCache';

function setup(load: () => Promise<ReturnType<typeof makeDomain>[]>) {
  let t = 1_000;
  const onError = vi.fn();
  const cache = new ActiveLinkDomainCache(load, { now: () => t, onError });
  return { cache, onError, advance: (ms: number) => { t += ms; } };
}

describe('ActiveLinkDomainCache', () => {
  it('não carrega no construtor; recarrega só após 60 s', async () => {
    const load = vi.fn(async () => [makeDomain()]);
    const { cache, advance } = setup(load);
    expect(load).not.toHaveBeenCalled();
    await cache.get();
    advance(ACTIVE_LINK_DOMAIN_TTL_MS - 1);
    await cache.get();
    expect(load).toHaveBeenCalledTimes(1);
    advance(1);
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);
    expect(ACTIVE_LINK_DOMAIN_TTL_MS).toBe(60_000);
  });

  it('single flight: requisições simultâneas fazem uma consulta', async () => {
    const load = vi.fn(async () => [makeDomain()]);
    const { cache } = setup(load);
    await Promise.all([cache.get(), cache.get(), cache.listActive()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('falha sem lista anterior → null, loga e espera o retry', async () => {
    const load = vi.fn(async () => { throw new Error('db'); });
    const { cache, onError, advance } = setup(load);
    expect(await cache.get()).toBeNull();
    expect(await cache.listActive()).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    advance(ACTIVE_LINK_DOMAIN_RETRY_MS);
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('falha com lista anterior mantém a última boa', async () => {
    const load = vi.fn().mockResolvedValueOnce([makeDomain()]).mockRejectedValueOnce(new Error('db'));
    const { cache, advance } = setup(load);
    await cache.get();
    advance(ACTIVE_LINK_DOMAIN_TTL_MS);
    expect(await cache.get()).toHaveLength(1);
  });
});
