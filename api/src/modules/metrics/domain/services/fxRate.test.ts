import { describe, expect, it } from 'vitest';
import { isFxRateStale, resolveFxRate } from './fxRate';
import { defaultInfraCostSettings } from './infraCostSettings';

const TODAY = new Date('2026-11-12T15:00:00.000Z');
const fx = (override: { rate: number; date: string } | null) => ({ ...defaultInfraCostSettings().fx, override });

describe('resolveFxRate', () => {
  it('override manual vence', () => {
    expect(resolveFxRate({ fx: fx({ rate: 5.4321, date: '2026-11-10' }), today: TODAY })).toEqual({
      rate: 5.4321, referenceDate: '2026-11-10', source: 'override', fetchedAt: null, stale: false,
    });
  });

  it('sem override na P1 = null (fx_missing no calculador)', () => {
    expect(resolveFxRate({ fx: fx(null), today: TODAY })).toBeNull();
  });

  it('stale com mais de 5 dias corridos', () => {
    expect(resolveFxRate({ fx: fx({ rate: 5, date: '2026-11-06' }), today: TODAY })?.stale).toBe(true);
  });
});

describe('isFxRateStale', () => {
  it('5 dias não envelhece; 6 envelhece', () => {
    expect(isFxRateStale('2026-11-07', TODAY)).toBe(false);
    expect(isFxRateStale('2026-11-06', TODAY)).toBe(true);
  });
});
