import { describe, expect, it } from 'vitest';
import { orderDispatchTargets } from './orderDispatchTargets';

const t = (sessionId: string, conversationId: string) => ({ sessionId, conversationId });
const targets = [t('s1', 'a1'), t('s2', 'b1'), t('s1', 'a2'), t('s1', 'a3'), t('s2', 'b2'), t('s3', 'c1'), t('sx', 'x1')];
const ids = (r: { conversationId: string }[]) => r.map((x) => x.conversationId);

describe('orderDispatchTargets', () => {
  it('SEQUENTIAL: todos de cada sessão, na ordem das sessões; sessão fora da lista é descartada', () => {
    expect(ids(orderDispatchTargets(targets, ['s2', 's1', 's3'], 'SEQUENTIAL'))).toEqual(['b1', 'b2', 'a1', 'a2', 'a3', 'c1']);
  });

  it('INTERLEAVED: um de cada sessão por vez; quem acaba sai da rodada', () => {
    expect(ids(orderDispatchTargets(targets, ['s1', 's2', 's3'], 'INTERLEAVED'))).toEqual(['a1', 'b1', 'c1', 'a2', 'b2', 'a3']);
  });

  it('uma sessão só: as duas ordens dão o mesmo resultado', () => {
    const one = targets.filter((x) => x.sessionId === 's1');
    expect(ids(orderDispatchTargets(one, ['s1'], 'INTERLEAVED'))).toEqual(ids(orderDispatchTargets(one, ['s1'], 'SEQUENTIAL')));
  });

  it('vazio devolve vazio', () => {
    expect(orderDispatchTargets([], ['s1'], 'SEQUENTIAL')).toEqual([]);
  });
});
