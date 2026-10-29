import { describe, it, expect } from 'vitest';
import { pickGroup, type PickableGroup } from './pickGroup';
import { LinkRotationGroupStatus as S, LinkRotationStrategy as St } from '../enums/LinkRotationEnums';

type G = PickableGroup & { id: string };
const g = (id: string, over: Partial<G> = {}): G => ({
  id,
  status: S.ACTIVE,
  inviteCode: 'code',
  memberCount: 0,
  clicksSinceSync: 0,
  capacity: 100,
  clickCount: 0,
  position: 0,
  weight: 1,
  ...over,
});
const fixed = (v: number) => () => v;

describe('pickGroup', () => {
  it('BALANCED escolhe menor ocupação relativa', () => {
    const groups = [g('a', { memberCount: 50, capacity: 100 }), g('b', { memberCount: 60, capacity: 200, position: 1 })];
    expect(pickGroup(groups, St.BALANCED)?.id).toBe('b');
  });

  it('BALANCED empate → menor clickCount, depois menor position', () => {
    const tie = [g('a', { clickCount: 5, position: 0 }), g('b', { clickCount: 2, position: 1 })];
    expect(pickGroup(tie, St.BALANCED)?.id).toBe('b');
    const full = [g('c', { position: 2 }), g('d', { position: 1 })];
    expect(pickGroup(full, St.BALANCED)?.id).toBe('d');
  });

  it('SEQUENTIAL pula cheio, sem convite e não ativo', () => {
    const groups = [
      g('cheio', { position: 0, memberCount: 100 }),
      g('semLink', { position: 1, inviteCode: null }),
      g('pausado', { position: 2, status: S.PAUSED }),
      g('ok', { position: 4 }),
      g('ok2', { position: 3 }),
    ];
    expect(pickGroup(groups, St.SEQUENTIAL)?.id).toBe('ok2');
  });

  it('capacidade conta clicksSinceSync e memberCount nulo vale 0', () => {
    const groups = [g('a', { memberCount: 90, clicksSinceSync: 10 }), g('b', { memberCount: null, clicksSinceSync: 99, position: 1 })];
    expect(pickGroup(groups, St.SEQUENTIAL)?.id).toBe('b');
  });

  it('WEIGHTED roleta com rng fixo e peso ≤ 0 ignorado', () => {
    const groups = [g('a', { weight: 1, position: 0 }), g('zero', { weight: 0, position: 1 }), g('b', { weight: 3, position: 2 })];
    expect(pickGroup(groups, St.WEIGHTED, fixed(0))?.id).toBe('a');
    expect(pickGroup(groups, St.WEIGHTED, fixed(0.24))?.id).toBe('a');
    expect(pickGroup(groups, St.WEIGHTED, fixed(0.25))?.id).toBe('b');
    expect(pickGroup(groups, St.WEIGHTED, fixed(0.999))?.id).toBe('b');
    expect(pickGroup([g('z', { weight: 0 })], St.WEIGHTED, fixed(0.5))).toBeNull();
  });

  it('RANDOM uniforme com rng fixo', () => {
    const groups = [g('a', { position: 0 }), g('b', { position: 1 }), g('c', { position: 2 })];
    expect(pickGroup(groups, St.RANDOM, fixed(0))?.id).toBe('a');
    expect(pickGroup(groups, St.RANDOM, fixed(0.5))?.id).toBe('b');
    expect(pickGroup(groups, St.RANDOM, fixed(0.99))?.id).toBe('c');
  });

  it('nenhum elegível → null em todas as estratégias', () => {
    const groups = [g('a', { status: S.FULL }), g('b', { status: S.NEEDS_LINK }), g('c', { memberCount: 100 })];
    for (const st of Object.values(St)) expect(pickGroup(groups, st, fixed(0.5))).toBeNull();
    expect(pickGroup([], St.BALANCED)).toBeNull();
  });
});
