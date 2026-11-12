import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAN_CATALOG } from '@/features/plans/catalog';
import { sampleSettings } from '@/features/infraCosts/testFixtures';

const http = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/services/apiClient', () => ({ apiClient: http }));

import { adminCostsService } from '@/services/adminCosts.service';

const view = { settings: sampleSettings(), origin: 'default' as const, updatedAt: null };

describe('adminCostsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lê a configuração', async () => {
    http.get.mockResolvedValueOnce({ data: { success: true, data: view } });
    expect(await adminCostsService.getSettings()).toEqual(view);
    expect(http.get).toHaveBeenCalledWith('/admin/costs/settings');
  });

  it('salva só configuração e expectedUpdatedAt, sem preço de plano no corpo', async () => {
    http.put.mockResolvedValueOnce({ data: { success: true, data: view } });
    const settings = { ...sampleSettings(), planPrices: PLAN_CATALOG.map((p) => p.price) };
    await adminCostsService.updateSettings({ settings, expectedUpdatedAt: '2026-11-12T10:00:00.000Z', price: 97 } as never);
    const [url, body] = http.put.mock.calls[0];
    expect(url).toBe('/admin/costs/settings');
    expect(Object.keys(body).sort()).toEqual(['expectedUpdatedAt', 'settings']);
    expect(body.settings).toEqual(sampleSettings());
    expect(JSON.stringify(body)).not.toMatch(/"(price|planPrices|priceAnnualMonthly|priceFrom)"/);
  });

  it('resumo do mês: só o mês na query', async () => {
    http.get.mockResolvedValue({ data: { success: true, data: { month: '2026-11' } } });
    await adminCostsService.getSummary('2026-11');
    expect(http.get).toHaveBeenLastCalledWith('/admin/costs/summary', { params: { month: '2026-11' } });
    await adminCostsService.getSummary(null);
    expect(http.get).toHaveBeenLastCalledWith('/admin/costs/summary', { params: undefined });
  });

  it('propaga o erro da API (409)', async () => {
    http.put.mockRejectedValueOnce(new Error('409'));
    await expect(adminCostsService.updateSettings({ settings: sampleSettings(), expectedUpdatedAt: null })).rejects.toThrow('409');
  });

  it('por cliente: só mês, plano e cursor; nunca limit/offset', async () => {
    http.get.mockResolvedValue({ data: { data: { tenants: [] } } });
    await adminCostsService.getTenants({ month: '2026-10', plan: 'COPYSYNC_PRO', cursor: 'abc' });
    expect(http.get).toHaveBeenLastCalledWith('/admin/costs/tenants', { params: { month: '2026-10', plan: 'COPYSYNC_PRO', cursor: 'abc' } });
    await adminCostsService.getTenants();
    expect(http.get).toHaveBeenLastCalledWith('/admin/costs/tenants', { params: undefined });
  });

  it('histórico', async () => {
    http.get.mockResolvedValue({ data: { data: { months: [] } } });
    await adminCostsService.getHistory();
    expect(http.get).toHaveBeenLastCalledWith('/admin/costs/history');
  });
});
