import { describe, expect, it } from 'vitest';
import { countByFilter, groupAvatarInitials, groupMatchesFilter, pruneSelection, searchGroups, sortGroups } from './groupList';
import type { SaverSessionGroup } from './types';

const g = (name: string | null, over: Partial<SaverSessionGroup> = {}): SaverSessionGroup => ({
  groupJid: `${name}@g.us`, name, saved: false, savedGroupId: null, lastScannedAt: null, lastScanStatus: null,
  memberCount: null, kind: 'GROUP', selectable: true, unselectableReason: null, ...over,
});

describe('groupList', () => {
  const list = [
    g('Vendas', { memberCount: 10, saved: true, lastScannedAt: '2026-11-16T10:00:00.000Z' }),
    g('ávila', { memberCount: 300 }),
    g('Bairro', { kind: 'COMMUNITY', selectable: false }),
    g(null, { kind: 'COMMUNITY_ANNOUNCE', memberCount: 300 }),
  ];

  it('poda a seleção: some da sessão ou virou comunidade principal sai; nada a podar mantém a referência', () => {
    const sel = ['Vendas@g.us', 'Bairro@g.us', 'sumiu@g.us'];
    expect(pruneSelection(sel, list)).toEqual(['Vendas@g.us']);
    const ok = ['Vendas@g.us'];
    expect(pruneSelection(ok, list)).toBe(ok);
  });

  it('iniciais diferenciam nomes com número no fim', () => {
    expect(groupAvatarInitials('Achadinhos 10')).toBe('A10');
    expect(groupAvatarInitials('Achadinhos 11')).not.toBe(groupAvatarInitials('Achadinhos 12'));
    expect(groupAvatarInitials('Beleza em Conta')).toBe('BE');
    expect(groupAvatarInitials('123')).toBe('');
  });

  it('filtros rápidos', () => {
    expect(countByFilter(list)).toEqual({ all: 4, unread: 3, saved: 1, communities: 2 });
    expect(groupMatchesFilter(list[0]!, 'unread')).toBe(false);
  });

  it('busca ignora caixa e usa o texto de "sem nome"', () => {
    expect(searchGroups(list, 'VEN', 'Grupo sem nome').map((x) => x.name)).toEqual(['Vendas']);
    expect(searchGroups(list, 'sem nome', 'Grupo sem nome')).toHaveLength(1);
  });

  it('ordena por nome (acento não pesa) e por mais membros com desempate pelo nome', () => {
    expect(sortGroups(list, 'name', 'Z').map((x) => x.name)).toEqual(['ávila', 'Bairro', 'Vendas', null]);
    expect(sortGroups(list, 'members', 'Z').map((x) => x.name)).toEqual(['ávila', null, 'Vendas', 'Bairro']);
  });
});
