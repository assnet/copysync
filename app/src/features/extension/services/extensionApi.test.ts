import { describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), defaults: { baseURL: '/api' } }));
vi.mock('@/services/apiClient', () => ({ apiClient: http }));

import { extensionApi } from './extensionApi';

describe('extensionApi por marketplace', () => {
  it('disconnect("shein") usa a rota da extensão, nunca o DELETE genérico de credenciais', async () => {
    await extensionApi.disconnect('shein');
    expect(http.delete).toHaveBeenCalledWith('/extension/marketplaces/shein/session');
    expect(http.delete).not.toHaveBeenCalledWith('/integrations/affiliate-credentials/SHEIN');
  });

  it('revokeSession revoga pelo Bearer só as sessões da instalação; nunca a rota exclusiva da extensão', async () => {
    http.get.mockResolvedValue({ data: { data: [
      { id: 's1', installationId: 'inst-1' }, { id: 's2', installationId: 'outra' },
    ] } });
    await extensionApi.revokeSession('inst-1');
    expect(http.get).toHaveBeenCalledWith('/extension/sessions');
    expect(http.delete).toHaveBeenCalledWith('/extension/sessions/s1');
    expect(http.delete).not.toHaveBeenCalledWith('/extension/sessions/s2');
    expect(http.delete).not.toHaveBeenCalledWith('/extension/session');
  });

  it('consent("shein") envia a instalação', async () => {
    await extensionApi.consent('shein', 'inst-1');
    expect(http.post).toHaveBeenCalledWith('/extension/marketplaces/shein/consent', { installationId: 'inst-1' });
  });

  it('lê a credencial de cada marketplace da lista `{ items }`', async () => {
    http.get.mockResolvedValue({ data: { data: { items: [
      { provider: 'SHEIN', status: 'ACTIVE', hasSession: true, publicIdentifier: '1', sessionSyncedAt: 'a', rejectedAt: null },
    ], marketplaceAvailability: {} } } });
    const all = await extensionApi.getCredentialStatuses();
    expect(all.ml).toBeNull();
    expect(all.shein?.lastSyncAt).toBe('a');
  });
  it('aceita também a lista como array puro (API antiga)', async () => {
    http.get.mockResolvedValue({ data: { data: [
      { provider: 'MERCADO_LIVRE', status: 'ACTIVE', hasSession: true, publicIdentifier: 'tag', sessionSyncedAt: 'b', rejectedAt: null },
    ] } });
    const all = await extensionApi.getCredentialStatuses();
    expect(all.ml?.lastSyncAt).toBe('b');
    expect(all.shein).toBeNull();
  });
});
