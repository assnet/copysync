import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => {
  const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });
  return {
    get: vi.fn((..._a: unknown[]) => ok({})),
    post: vi.fn((..._a: unknown[]) => ok({})),
    patch: vi.fn((..._a: unknown[]) => ok({})),
    put: vi.fn((..._a: unknown[]) => ok({ groups: [{ id: 'g1' }] })),
    delete: vi.fn((..._a: unknown[]) => Promise.resolve({ data: undefined })),
  };
});
vi.mock('@/services/apiClient', () => ({ apiClient: http }));

import { linkRotationService as svc } from '@/services/linkRotation.service';

describe('linkRotationService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('monta as URLs do contrato', async () => {
    await svc.getOverview();
    expect(http.get).toHaveBeenLastCalledWith('/link-rotation');
    await svc.create({ sessionId: 's', domainId: 'd', slug: 'promo' });
    expect(http.post).toHaveBeenLastCalledWith('/link-rotation', { sessionId: 's', domainId: 'd', slug: 'promo' });
    await svc.update('r1', { status: 'PAUSED' });
    expect(http.patch).toHaveBeenLastCalledWith('/link-rotation/r1', { status: 'PAUSED' });
    await svc.rename('r1', { slug: 'novo' });
    expect(http.post).toHaveBeenLastCalledWith('/link-rotation/r1/rename', { slug: 'novo' });
    await svc.remove('r1');
    expect(http.delete).toHaveBeenLastCalledWith('/link-rotation/r1');
    await svc.listGroups('r1', '  vip ');
    expect(http.get).toHaveBeenLastCalledWith('/link-rotation/r1/groups', { params: { search: 'vip' } });
    await svc.listGroups('r1');
    expect(http.get).toHaveBeenLastCalledWith('/link-rotation/r1/groups', { params: undefined });
    expect(await svc.saveGroups('r1', [{ groupJid: 'x@g.us' }])).toEqual([{ id: 'g1' }]);
    expect(http.put).toHaveBeenLastCalledWith('/link-rotation/r1/groups', { groups: [{ groupJid: 'x@g.us' }] });
    await svc.refreshGroup('r1', 'g1');
    expect(http.post).toHaveBeenLastCalledWith('/link-rotation/r1/groups/g1/refresh', {});
    await svc.getStats('r1');
    expect(http.get).toHaveBeenLastCalledWith('/link-rotation/r1/stats');
  });
});
