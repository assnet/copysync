import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { adminCostsService } from '@/services/adminCosts.service';
import type { InfraCostTenantsPage } from './types';
import { useCostTenants } from './useCostTenants';

const page = (month: string, nextCursor: string | null, tenantId = `t-${month}`): InfraCostTenantsPage => ({
  month, status: 'open', basis: 'hours', fx: null, sharedBasis: 'contracted', unallocated: null, excluded: null,
  tenants: [{
    tenantId, tenantName: tenantId, planSlug: null, contractedSessions: 1, sessionHours: 1,
    shared: { usd: 1, brl: null }, connectedShared: null, projectedShared: null, ai: { usd: 0, brl: null }, total: { usd: 1, brl: null },
  }],
  nextCursor,
});

afterEach(() => vi.restoreAllMocks());

describe('useCostTenants', () => {
  it('"Carregar mais" respondido depois de trocar o mês não trava o botão nem mistura as listas', async () => {
    let resolveMore!: (p: InfraCostTenantsPage) => void;
    const spy = vi.spyOn(adminCostsService, 'getTenants')
      .mockResolvedValueOnce(page('2026-10', 'c1'))
      .mockImplementationOnce(() => new Promise((r) => { resolveMore = r; }))
      .mockResolvedValueOnce(page('2026-09', 'c2'));
    const { result, rerender } = renderHook(({ month }) => useCostTenants(month, 'all'), { initialProps: { month: '2026-10' } });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { void result.current.loadMore(); });
    expect(result.current.loadingMore).toBe(true);

    rerender({ month: '2026-09' });
    await waitFor(() => expect(result.current.rows[0]?.tenantId).toBe('t-2026-09'));
    expect(result.current.loadingMore).toBe(false);

    await act(async () => { resolveMore(page('2026-10', null, 'antigo')); });
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.rows.map((r) => r.tenantId)).toEqual(['t-2026-09']);
    expect(result.current.hasMore).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
