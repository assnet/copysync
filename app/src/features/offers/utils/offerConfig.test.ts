import { describe, expect, it } from 'vitest';
import type { BroadcastGroupCatalogItem, BroadcastGroupUse } from '@/types/api.types';
import { unionBroadcastCount } from './offerConfig';

const item = (id: string, usedBy: BroadcastGroupUse[], channel: 'whatsapp' | 'telegram' = 'whatsapp'): BroadcastGroupCatalogItem =>
  ({ conversationId: id, sessionId: 's1', channel, title: null, avatarUrl: null, usedBy });
// 3 no gerador + 3 só no monitoramento = união 6
const catalog = {
  items: [item('g1', ['generator']), item('g2', ['generator']), item('g3', ['generator']), item('m1', ['monitor:s1']), item('m2', ['monitor:s1']), item('m3', ['monitor:s2'])],
  usage: { whatsapp: { broadcastGroups: 6 }, telegram: { broadcastGroups: 0 } },
};
const wa = (...ids: string[]) => ids.map((id) => ({ id, channel: 'whatsapp' as const }));

describe('unionBroadcastCount', () => {
  it('rascunho = gerador salvo: usa a união da API', () => {
    expect(unionBroadcastCount(wa('g1', 'g2', 'g3'), catalog)).toEqual({ whatsapp: 6, telegram: 0 });
  });
  it('marcar um novo soma 1', () => {
    expect(unionBroadcastCount(wa('g1', 'g2', 'g3', 'n1'), catalog).whatsapp).toBe(7);
  });
  it('marcar um já usado no monitoramento não soma', () => {
    expect(unionBroadcastCount(wa('g1', 'g2', 'g3', 'm1'), catalog).whatsapp).toBe(6);
  });
  it('desmarcar grupo só do gerador tira 1; usado também no monitoramento continua', () => {
    const shared = { ...catalog, items: [...catalog.items.slice(0, 2), item('g3', ['generator', 'monitor:s1']), ...catalog.items.slice(3)] };
    expect(unionBroadcastCount(wa('g2', 'g3'), shared).whatsapp).toBe(5);
    expect(unionBroadcastCount(wa('g1', 'g2'), shared).whatsapp).toBe(6);
  });
  it('id repetido no rascunho conta uma vez; canal do grupo vale', () => {
    expect(unionBroadcastCount([...wa('n1', 'n1'), { id: 't1', channel: 'telegram' }], catalog)).toEqual({ whatsapp: 4, telegram: 1 });
  });
  it('sem catálogo conta só o rascunho', () => {
    expect(unionBroadcastCount(wa('a', 'b'), null)).toEqual({ whatsapp: 2, telegram: 0 });
  });
});
