import { describe, expect, it } from 'vitest';
import { sumSelectedMembers } from './groupMembers';
import type { SaverSessionGroup } from './types';

const g = (groupJid: string, memberCount: number | null, selectable = true): SaverSessionGroup => ({
  groupJid, name: groupJid, saved: false, savedGroupId: null, lastScannedAt: null, lastScanStatus: null,
  memberCount, kind: selectable ? 'GROUP' : 'COMMUNITY', selectable, unselectableReason: selectable ? null : 'COMMUNITY_PARENT',
});

describe('sumSelectedMembers', () => {
  const groups = [g('a', 10), g('b', 1200), g('c', null), g('d', 5, false)];
  it('nada marcado → null', () => expect(sumSelectedMembers(groups, [])).toBeNull());
  it('soma só os marcados e selecionáveis', () => {
    expect(sumSelectedMembers(groups, ['a', 'b', 'd'])).toEqual({ total: 1210, partial: false });
  });
  it('total desconhecido marca parcial', () => {
    expect(sumSelectedMembers(groups, ['a', 'c'])).toEqual({ total: 10, partial: true });
  });
});
