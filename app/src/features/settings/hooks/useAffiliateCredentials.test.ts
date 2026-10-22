import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AffiliateCredentialItem } from '@/types/api.types';

const service = vi.hoisted(() => ({
  list: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  setStatus: vi.fn(),
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
  updatedAt: '2026-10-22T10:00:00.000Z',
};

async function setup() {
  service.list.mockResolvedValue([amazon]);
  const hook = renderHook(() => useAffiliateCredentials());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const itemOf = (h: Awaited<ReturnType<typeof setup>>, p: string) =>
  h.result.current.entries.find((e) => e.spec.provider === p)?.item;

describe('useAffiliateCredentials', () => {
  it('mescla a lista com o catálogo dos três marketplaces', async () => {
    const h = await setup();
    expect(h.result.current.entries.map((e) => e.spec.provider)).toEqual(['SHOPEE', 'MERCADO_LIVRE', 'AMAZON']);
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
});
