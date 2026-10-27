import { describe, expect, it } from 'vitest';
import { appendToLanes, laneGapMs } from './appendToLanes';

const at = (min: number) => new Date(Date.UTC(2026, 9, 28, 12, min));
const slot = (sessionId: string, min: number) => ({ sessionId, notBefore: at(min) });

describe('appendToLanes', () => {
  it('sem nada à frente mantém os horários', () => {
    const out = appendToLanes([slot('s1', 0), slot('s1', 2)], new Map(), 60_000);
    expect(out).toEqual([at(0), at(2)]);
  });

  it('desloca a oferta inteira para depois do fim da faixa + folga', () => {
    const out = appendToLanes([slot('s1', 0), slot('s1', 2)], new Map([['s1', at(10)]]), 60_000);
    expect(out).toEqual([at(11), at(13)]);
  });

  it('faixa que já terminou antes do início não desloca', () => {
    const out = appendToLanes([slot('s1', 30)], new Map([['s1', at(10)]]), 60_000);
    expect(out).toEqual([at(30)]);
  });

  it('com várias sessões usa o maior deslocamento e preserva a ordem', () => {
    const slots = [slot('s1', 0), slot('s2', 2), slot('s1', 4)];
    const tails = new Map([['s1', at(3)], ['s2', at(20)]]);
    // s2 começa em 2 e precisa ir para 21 → +19 em todos
    expect(appendToLanes(slots, tails, 60_000)).toEqual([at(19), at(21), at(23)]);
  });

  it('ignora faixa de sessão que a oferta não usa', () => {
    const out = appendToLanes([slot('s1', 0)], new Map([['s9', at(50)]]), 60_000);
    expect(out).toEqual([at(0)]);
  });
});

describe('laneGapMs', () => {
  it('fica dentro do intervalo', () => {
    expect(laneGapMs({ minMs: 1000, maxMs: 3000 }, () => 0)).toBe(1000);
    expect(laneGapMs({ minMs: 1000, maxMs: 3000 }, () => 1)).toBe(3000);
  });
});
