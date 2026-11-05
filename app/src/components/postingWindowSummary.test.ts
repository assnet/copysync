import { describe, expect, it } from 'vitest';
import { postingWindowSummary } from './postingWindowSummary';

describe('postingWindowSummary', () => {
  it('dia inteiro e todos os dias', () => {
    const s = postingWindowSummary({ window: { lo: 0, hi: 1440, overnight: false }, weekdaysMask: 127 });
    expect(s.range).toBe('Dia inteiro — 24 h');
    expect(s.days).toBe('Todos os dias');
  });
  it('faixa e lista de dias', () => {
    const s = postingWindowSummary({ window: { lo: 480, hi: 1320, overnight: false }, weekdaysMask: 0b0000011 });
    expect(s.range).toBe('08:00 → 22:00 · 14 h');
    expect(s.days).toBe('Dom, Seg');
  });
  it('fim de semana', () => {
    expect(postingWindowSummary({ window: { lo: 480, hi: 1320, overnight: false }, weekdaysMask: 65 }).days).toBe('Fim de semana');
  });
});
