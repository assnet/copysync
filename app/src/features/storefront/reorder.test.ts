import { describe, expect, it } from 'vitest';
import { canMove, moveById, moveItem, tabIds, tabStatus } from './reorder';

const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('moveItem', () => {
  it('move de uma posição para outra sem mutar a lista', () => {
    expect(moveItem(list, 0, 2).map((o) => o.id)).toEqual(['b', 'c', 'a']);
    expect(moveItem(list, 2, 0).map((o) => o.id)).toEqual(['c', 'a', 'b']);
    expect(list.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('índice fora da lista ou igual devolve a mesma ordem', () => {
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, -1, 0)).toBe(list);
    expect(moveItem(list, 0, 3)).toBe(list);
  });
});

describe('moveById (▲▼ e arrastar)', () => {
  it('sobe e desce um item', () => {
    expect(moveById(list, 'b', 'up').map((o) => o.id)).toEqual(['b', 'a', 'c']);
    expect(moveById(list, 'b', 'down').map((o) => o.id)).toEqual(['a', 'c', 'b']);
  });

  it('solta sobre outro item (arrastar)', () => {
    expect(moveById(list, 'a', 'c').map((o) => o.id)).toEqual(['b', 'c', 'a']);
  });

  it('nas pontas ou com id ausente não muda', () => {
    expect(moveById(list, 'a', 'up')).toBe(list);
    expect(moveById(list, 'c', 'down')).toBe(list);
    expect(moveById(list, 'x', 'up')).toBe(list);
    expect(moveById(list, 'a', 'x')).toBe(list);
  });

  it('canMove desabilita as setas nas pontas', () => {
    expect(canMove(list, 'a', 'up')).toBe(false);
    expect(canMove(list, 'a', 'down')).toBe(true);
    expect(canMove(list, 'c', 'down')).toBe(false);
    expect(canMove(list, 'x', 'up')).toBe(false);
  });
});

describe('aba', () => {
  it('ids da aba na ordem atual e status da aba', () => {
    expect(tabIds(list)).toEqual(['a', 'b', 'c']);
    expect(tabStatus('drafts')).toBe('DRAFT');
    expect(tabStatus('published')).toBe('PUBLISHED');
  });
});
