import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BroadcastGroupsResponse, OfferConfigResponse, SessionItem } from '@/types/api.types';
import type { SelectedGroup } from './ConfigGroupsStep';
import { ConfigGroupsStep } from './ConfigGroupsStep';

vi.mock('../../hooks/useSessionGroups', () => ({
  useSessionGroups: () => ({ items: [], partial: false, loading: false, failed: false, retry: vi.fn() }),
}));

const used = (id: string, usedBy: BroadcastGroupsResponse['items'][number]['usedBy']) =>
  ({ conversationId: id, sessionId: 's1', channel: 'whatsapp' as const, title: null, avatarUrl: null, usedBy });
const catalog: BroadcastGroupsResponse = {
  items: [used('g1', ['generator']), used('g2', ['generator']), used('g3', ['generator']), used('m1', ['monitor:s1']), used('m2', ['monitor:s1']), used('m3', ['monitor:s1'])],
  limits: { whatsapp: { broadcastGroups: 10 }, telegram: { broadcastGroups: 0 } },
  usage: { whatsapp: { broadcastGroups: 6 }, telegram: { broadcastGroups: 0 } },
};
// O passo não busca o catálogo: recebe do assistente (uma busca só)
vi.mock('@/features/broadcastGroups/hooks/useBroadcastGroups', () => ({
  useBroadcastGroups: () => { throw new Error('ConfigGroupsStep não deve buscar o catálogo'); },
}));

const session = { id: 's1', name: 'Sessão', engine: 'BAILEYS', status: 'CONNECTED', avatarUrl: null } as unknown as SessionItem;
const limits: OfferConfigResponse['limits'] = {
  whatsapp: { sessions: null, broadcastGroups: 10 },
  telegram: { sessions: null, broadcastGroups: null },
};
const sel = (...ids: string[]) =>
  new Map<string, SelectedGroup>(ids.map((id) => [id, { title: id, avatarUrl: null, sessionId: 's1' }]));
const chip = (selected: ReadonlyMap<string, SelectedGroup>, cat: BroadcastGroupsResponse | null = catalog) => {
  render(<ConfigGroupsStep sessions={[session]} selected={selected} limits={limits} catalog={cat} onToggle={vi.fn()} onClear={vi.fn()} />);
  return screen.getByText(/^WhatsApp \d+\/10$/).textContent;
};

describe('chip de grupos do gerador pela união', () => {
  beforeEach(() => sessionStorage.clear());

  it('3 no gerador + 3 só no monitoramento: 6/10', () => {
    expect(chip(sel('g1', 'g2', 'g3'))).toBe('WhatsApp 6/10');
  });
  it('marcar 1 novo: 7/10', () => {
    expect(chip(sel('g1', 'g2', 'g3', 'n1'))).toBe('WhatsApp 7/10');
  });
  it('marcar 1 já usado no monitoramento: continua 6/10', () => {
    expect(chip(sel('g1', 'g2', 'g3', 'm1'))).toBe('WhatsApp 6/10');
  });
  it('sem catálogo: conta só a seleção', () => {
    expect(chip(sel('g1', 'g2', 'g3'), null)).toBe('WhatsApp 3/10');
  });
});
