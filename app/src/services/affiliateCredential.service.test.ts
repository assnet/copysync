import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/services/apiClient', () => ({ apiClient: http }));

import { affiliateCredentialService } from '@/services/affiliateCredential.service';

const open = { enabled: true, plans: [], riskNotice: null };

describe('affiliateCredentialService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('API antiga (sem marketplaceAvailability): só as 4 lojas antigas ficam visíveis, sem restrição', async () => {
    http.get.mockResolvedValueOnce({ data: { success: true, data: { items: [] } } });
    const list = await affiliateCredentialService.list();
    expect(list.marketplaceAvailability).toEqual({});
    expect(list.visibleProviders).toEqual(['SHOPEE', 'MERCADO_LIVRE', 'AMAZON', 'SHEIN']);
  });

  it('API nova: visíveis = lojas listadas (loja oculta ausente)', async () => {
    http.get.mockResolvedValueOnce({
      data: { success: true, data: { items: [], marketplaceAvailability: { SHOPEE: open, KABUM: open } } },
    });
    const list = await affiliateCredentialService.list();
    expect(list.visibleProviders).toEqual(['SHOPEE', 'KABUM']);
  });
});
