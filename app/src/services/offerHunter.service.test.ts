import { describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({
  post: vi.fn((url: string) => Promise.resolve({
    data: { success: true, data: url.endsWith('/send-all') ? { sent: 2, skipped: [] } : { find: { id: 'f9' } } },
  })),
}));
vi.mock('@/services/apiClient', () => ({ apiClient: http }));

import { offerHunterService as svc } from '@/services/offerHunter.service';

describe('offerHunterService — ranking reaproveitável', () => {
  it('enviar item chama a rota do produto e devolve o achado', async () => {
    await expect(svc.sendRankingItem('h 1', 'r1', 'MLB1')).resolves.toEqual({ id: 'f9' });
    expect(http.post).toHaveBeenLastCalledWith('/offer-hunts/h%201/runs/r1/ranking/MLB1/send');
  });

  it('enviar todas chama a rota send-all', async () => {
    await expect(svc.sendAllRanking('h1', 'r1')).resolves.toEqual({ sent: 2, skipped: [] });
    expect(http.post).toHaveBeenLastCalledWith('/offer-hunts/h1/runs/r1/ranking/send-all');
  });
});
