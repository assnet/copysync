import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionResponse } from '@/types/api.types';

const sample: SubscriptionResponse = {
  tenantName: 'Loja',
  planSlug: 'starter',
  status: 'SUSPENDED',
  suspendedAt: '2026-11-01T12:00:00.000Z',
  expiresAt: null,
  limits: [
    { key: 'max_sessions', channel: 'whatsapp', kind: 'count', used: 1, limit: 2, enabled: true },
    { key: 'ai_rewrite_enabled', channel: null, kind: 'feature', used: null, limit: null, enabled: false },
  ],
};

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/services/apiClient', () => ({ apiClient: http }));

import { subscriptionService } from '@/services/subscription.service';

describe('subscriptionService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lê GET /subscription e devolve o data do envelope', async () => {
    http.get.mockResolvedValueOnce({ data: { success: true, data: sample } });
    expect(await subscriptionService.getSubscription()).toEqual(sample);
    expect(http.get).toHaveBeenCalledWith('/subscription');
  });

  it('propaga o erro da API', async () => {
    http.get.mockRejectedValueOnce(new Error('403'));
    await expect(subscriptionService.getSubscription()).rejects.toThrow('403');
  });
});
