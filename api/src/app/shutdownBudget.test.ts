import { describe, expect, it } from 'vitest';
import { mediaDrainBudgetMs, SHUTDOWN_DEADLINE_MS, SHUTDOWN_TAIL_RESERVE_MS } from './shutdownBudget';

describe('mediaDrainBudgetMs', () => {
  it('sem tempo decorrido = 27 s − 10 s', () => {
    expect(mediaDrainBudgetMs(0)).toBe(SHUTDOWN_DEADLINE_MS - SHUTDOWN_TAIL_RESERVE_MS);
    expect(mediaDrainBudgetMs(0)).toBe(17_000);
  });

  it('desconta o decorrido', () => {
    expect(mediaDrainBudgetMs(4_500)).toBe(12_500);
  });

  it('nunca negativo: decorrido no limite ou além', () => {
    expect(mediaDrainBudgetMs(17_000)).toBe(0);
    expect(mediaDrainBudgetMs(26_000)).toBe(0);
    expect(mediaDrainBudgetMs(60_000)).toBe(0);
  });

  it('decorrido negativo ou inválido conta como 0', () => {
    expect(mediaDrainBudgetMs(-1_000)).toBe(17_000);
    expect(mediaDrainBudgetMs(Number.NaN)).toBe(17_000);
    expect(mediaDrainBudgetMs(Number.POSITIVE_INFINITY)).toBe(17_000);
  });

  it('prazo e reserva configuráveis', () => {
    expect(mediaDrainBudgetMs(1_000, 10_000, 5_000)).toBe(4_000);
    expect(mediaDrainBudgetMs(0, 5_000, 10_000)).toBe(0);
  });
});
