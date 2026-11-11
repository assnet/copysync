import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AffiliateCredentialItem } from '@/types/api.types';

const service = vi.hoisted(() => ({
  list: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  setStatus: vi.fn(),
  setIdentifiers: vi.fn(),
}));
vi.mock('@/services/affiliateCredential.service', () => ({ affiliateCredentialService: service }));

import { useAffiliateCredentials } from './useAffiliateCredentials';

const amazon: AffiliateCredentialItem = {
  provider: 'AMAZON',
  status: 'ACTIVE',
  publicIdentifier: 'minhaloja-20',
  publicIdentifierMasked: '••••a-20',
  hasSecret: false,
  hasSession: false,
  sessionSyncedAt: null,
  lastValidatedAt: null,
  rejectedAt: null,
  rejectedCode: null,
  updatedAt: '2026-10-22T10:00:00.000Z',
};

async function setup() {
  service.list.mockResolvedValue({ items: [amazon], marketplaceAvailability: {} });
  const hook = renderHook(() => useAffiliateCredentials());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const itemOf = (h: Awaited<ReturnType<typeof setup>>, p: string) =>
  h.result.current.entries.find((e) => e.spec.provider === p)?.item;

describe('useAffiliateCredentials', () => {
  it('mescla a lista com o catálogo dos três marketplaces', async () => {
    const h = await setup();
    expect(h.result.current.entries.map((e) => e.spec.provider)).toEqual(['SHOPEE', 'MERCADO_LIVRE', 'AMAZON', 'SHEIN']);
    expect(itemOf(h, 'AMAZON')).toEqual(amazon);
    expect(itemOf(h, 'SHOPEE')).toBeUndefined();
  });

  it('remoção que falha devolve a credencial e expõe o erro', async () => {
    const h = await setup();
    service.remove.mockRejectedValue(new Error('rede'));

    await act(() => h.result.current.remove('AMAZON'));

    expect(itemOf(h, 'AMAZON')).toEqual(amazon);
    expect(h.result.current.actionError).toBeTruthy();
  });

  it('com beforeRemove (ML pela extensão) revoga pela rota do marketplace e depois apaga a credencial', async () => {
    const h = await setup();
    const order: string[] = [];
    const beforeRemove = vi.fn(async () => { order.push('revoke'); });
    service.remove.mockImplementation(async () => { order.push('delete'); });

    await act(() => h.result.current.remove('AMAZON', beforeRemove));

    expect(order).toEqual(['revoke', 'delete']);
    expect(itemOf(h, 'AMAZON')).toBeUndefined();
  });

  it('beforeRemove que falha não apaga e devolve o card', async () => {
    const h = await setup();
    service.remove.mockClear();

    await act(() => h.result.current.remove('AMAZON', () => Promise.reject(new Error('rede'))));

    expect(service.remove).not.toHaveBeenCalled();
    expect(itemOf(h, 'AMAZON')).toEqual(amazon);
  });

  it('credencial já apagada noutra aba: card não volta e o aviso aparece', async () => {
    const h = await setup();
    const gone = Object.assign(new Error('x'), { code: 'AFFILIATE_CREDENTIAL_NOT_FOUND' });
    service.remove.mockRejectedValue(gone);

    await act(() => h.result.current.remove('AMAZON'));

    expect(itemOf(h, 'AMAZON')).toBeUndefined();
    expect(h.result.current.actionError).toMatch(/não existe mais/);
  });

  it('troca de status de credencial já apagada: card vira não configurado', async () => {
    const h = await setup();
    service.setStatus.mockRejectedValue(Object.assign(new Error('x'), { code: 'AFFILIATE_CREDENTIAL_NOT_FOUND' }));

    await act(() => h.result.current.setStatus('AMAZON', 'INACTIVE'));

    expect(itemOf(h, 'AMAZON')).toBeUndefined();
  });

  it('troca de status que falha volta ao status anterior', async () => {
    const h = await setup();
    service.setStatus.mockRejectedValue(new Error('rede'));

    await act(() => h.result.current.setStatus('AMAZON', 'INACTIVE'));

    expect(itemOf(h, 'AMAZON')?.status).toBe('ACTIVE');
    expect(h.result.current.actionError).toBeTruthy();
  });

  it('salvar não altera a lista quando a API recusa e repassa o erro', async () => {
    const h = await setup();
    service.upsert.mockRejectedValue(new Error('422'));

    await act(async () => {
      await expect(h.result.current.upsert('SHOPEE', { publicIdentifier: '123456', secret: 'a'.repeat(16) })).rejects.toThrow();
    });

    expect(itemOf(h, 'SHOPEE')).toBeUndefined();
  });
  it('duas cargas: a primeira termina depois e é descartada (vale a segunda)', async () => {
    const h = await setup();
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    service.list
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => new Promise((r) => { resolveSecond = r; }));
    const fresh = { ...amazon, publicIdentifierMasked: '••novo' };

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = h.result.current.reload(); });
    act(() => { second = h.result.current.refreshSilently(); });
    await act(async () => { resolveSecond({ items: [fresh], marketplaceAvailability: {} }); await second; });
    await act(async () => { resolveFirst({ items: [], marketplaceAvailability: {} }); await first; });

    expect(itemOf(h, 'AMAZON')).toEqual(fresh);
    expect(h.result.current.loading).toBe(false);
    expect(h.result.current.loadError).toBeNull();
  });

  it('refreshSilently não liga o spinner e atualiza os dados', async () => {
    const seen: boolean[] = [];
    service.list.mockResolvedValue({ items: [amazon], marketplaceAvailability: {} });
    const h = renderHook(() => {
      const r = useAffiliateCredentials();
      seen.push(r.loading);
      return r;
    });
    await waitFor(() => expect(h.result.current.loading).toBe(false));
    seen.length = 0;
    const updated = { ...amazon, status: 'INACTIVE' as const };
    service.list.mockResolvedValue({ items: [updated], marketplaceAvailability: {} });

    await act(() => h.result.current.refreshSilently());

    expect(seen).not.toContain(true);
    expect(h.result.current.entries.find((e) => e.spec.provider === 'AMAZON')?.item).toEqual(updated);
  });

  it('setIdentifiers funde principal, vinculadas e limite no item e recarrega em silêncio', async () => {
    const ml: AffiliateCredentialItem = {
      ...amazon, provider: 'MERCADO_LIVRE', publicIdentifier: 'tag_a', accountIdentifiers: ['tag_a', 'tag_b'], linkedIdentifiers: [], identifierLimit: 2,
    };
    service.list.mockResolvedValue({ items: [ml], marketplaceAvailability: {} });
    const h = renderHook(() => useAffiliateCredentials());
    await waitFor(() => expect(h.result.current.loading).toBe(false));
    service.list.mockClear();
    service.list.mockImplementationOnce(() => new Promise(() => {}));
    service.setIdentifiers.mockResolvedValue({ account: ['tag_a', 'tag_b'], primary: 'tag_b', linked: ['tag_a'], limit: 2, used: 2 });

    await act(() => h.result.current.setIdentifiers('MERCADO_LIVRE', { primary: 'tag_b', linked: ['tag_a'] }));

    expect(service.setIdentifiers).toHaveBeenCalledWith('MERCADO_LIVRE', { primary: 'tag_b', linked: ['tag_a'] });
    expect(itemOf(h as never, 'MERCADO_LIVRE')).toMatchObject({ publicIdentifier: 'tag_b', linkedIdentifiers: ['tag_a'], identifierLimit: 2 });
    expect(service.list).toHaveBeenCalledTimes(1);
  });

  it('setIdentifiers recusado repassa o erro e não mexe no item', async () => {
    const h = await setup();
    service.setIdentifiers.mockRejectedValue(Object.assign(new Error('x'), { code: 'PLAN_LIMIT_REACHED' }));

    await act(async () => {
      await expect(h.result.current.setIdentifiers('AMAZON', { primary: 'a', linked: [] })).rejects.toThrow();
    });

    expect(itemOf(h, 'AMAZON')).toEqual(amazon);
  });
});
