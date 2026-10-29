import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/services/apiClient', () => ({ apiClient: client }));

import { adminLinkDomainsService } from '@/services/adminLinkDomains.service';

const ok = (data: unknown) => ({ data: { success: true, data } });

describe('adminLinkDomainsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list', async () => {
    client.get.mockResolvedValue(ok({ items: [{ id: 'd1' }] }));
    expect(await adminLinkDomainsService.list()).toEqual([{ id: 'd1' }]);
    expect(client.get).toHaveBeenCalledWith('/admin/link-domains');
  });

  it('create', async () => {
    client.post.mockResolvedValue(ok({ id: 'd1' }));
    await adminLinkDomainsService.create({ hostname: 'exemplo.com' });
    expect(client.post).toHaveBeenCalledWith('/admin/link-domains', { hostname: 'exemplo.com' });
  });

  it('update', async () => {
    client.patch.mockResolvedValue(ok({ id: 'd1' }));
    await adminLinkDomainsService.update('d1', { landingUrl: null });
    expect(client.patch).toHaveBeenCalledWith('/admin/link-domains/d1', { landingUrl: null });
  });

  it('remove', async () => {
    client.delete.mockResolvedValue({ status: 204 });
    await adminLinkDomainsService.remove('d1');
    expect(client.delete).toHaveBeenCalledWith('/admin/link-domains/d1');
  });

  it('probe', async () => {
    const result = { ok: false, reason: 'TIMEOUT', status: null, probedAt: '2026-10-29T12:00:00.000Z' };
    client.post.mockResolvedValue(ok(result));
    expect(await adminLinkDomainsService.probe('d/1')).toEqual(result);
    expect(client.post).toHaveBeenCalledWith('/admin/link-domains/d%2F1/probe', {});
  });

  it('listGrants, grant e revokeGrant', async () => {
    client.get.mockResolvedValue(ok({ items: [{ id: 'g1' }] }));
    expect(await adminLinkDomainsService.listGrants('d1')).toEqual([{ id: 'g1' }]);
    expect(client.get).toHaveBeenCalledWith('/admin/link-domains/d1/premium-grants');

    client.post.mockResolvedValue(ok({ id: 'g1' }));
    await adminLinkDomainsService.grant('d1', { tenantId: 't1', slug: 'vip', expiresAt: null });
    expect(client.post).toHaveBeenCalledWith('/admin/link-domains/d1/premium-grants', { tenantId: 't1', slug: 'vip', expiresAt: null });

    client.delete.mockResolvedValue({ status: 204 });
    await adminLinkDomainsService.revokeGrant('d1', 'g/1');
    expect(client.delete).toHaveBeenCalledWith('/admin/link-domains/d1/premium-grants/g%2F1');
  });
});
