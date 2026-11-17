import { describe, expect, it } from 'vitest';
import {
  countByFilter, countHiddenNumbersLikely, countMostlyHidden, hiddenNumbersLikely, isMostlyHidden, groupAvatarInitials, groupMatchesFilter, pruneSelection, searchGroups, sortGroups,
} from './groupList';
import type { SaverGroup, SaverSessionGroup } from './types';

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
    expect(countByFilter(list)).toEqual({ all: 4, unread: 3, saved: 1, communities: 2, selfAdmin: 0 });
    expect(groupMatchesFilter(list[0]!, 'unread')).toBe(false);
  });

  it('filtro "Sou admin": só selfIsAdmin true; false, null e ausente ficam fora', () => {
    const admins = [g('a', { selfIsAdmin: true }), g('b', { selfIsAdmin: false }), g('c', { selfIsAdmin: null }), g('d')];
    expect(admins.filter((x) => groupMatchesFilter(x, 'selfAdmin')).map((x) => x.name)).toEqual(['a']);
    expect(countByFilter(admins).selfAdmin).toBe(1);
  });

  it('números ocultos prováveis: comunidade/avisos com sessão não admin; desconhecido e grupo comum não avisam', () => {
    const ann = g('ann', { kind: 'COMMUNITY_ANNOUNCE', selfIsAdmin: false });
    const parent = g('pai', { kind: 'COMMUNITY', selectable: false, selfIsAdmin: false });
    const rows = [
      ann, parent, g('adm', { kind: 'COMMUNITY_ANNOUNCE', selfIsAdmin: true }),
      g('nulo', { kind: 'COMMUNITY_ANNOUNCE', selfIsAdmin: null }), g('semcampo', { kind: 'COMMUNITY_ANNOUNCE' }),
      g('comum', { selfIsAdmin: false }),
    ];
    expect(rows.filter(hiddenNumbersLikely)).toEqual([ann, parent]);
    // Só marcados, ainda na sessão e legíveis.
    expect(countHiddenNumbersLikely(rows, rows.map((x) => x.groupJid).concat('sumiu@g.us'))).toBe(1);
    expect(countHiddenNumbersLikely(rows, ['comum@g.us'])).toBe(0);
  });

  it('quase todos ocultos: a partir de 80% dos membros; sem contagem não entra', () => {
    const s = (memberCount: number, lidOnlyCount: number) => ({ memberCount, lidOnlyCount }) as SaverGroup;
    expect(isMostlyHidden(s(10, 8))).toBe(true);
    expect(isMostlyHidden(s(10, 10))).toBe(true);
    expect(isMostlyHidden(s(100, 79))).toBe(false);
    expect(isMostlyHidden(s(0, 0))).toBe(false);
    expect(isMostlyHidden(s(0, 5))).toBe(false);
    expect(countMostlyHidden([s(10, 9), s(10, 3), s(0, 0), s(500, 400)])).toBe(2);
    expect(countMostlyHidden([])).toBe(0);
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
