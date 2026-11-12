import { describe, expect, it, vi } from 'vitest';
import { fetchFirstFxRate, isFxRateStale, isValidFxRate, resolveClosingFxRate, resolveFxRate, type FetchedFxRate, type IFxRateSource, type SavedFxRate } from './fxRate';
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

describe('resolveFxRate com cotação gravada', () => {
  const saved = { rate: 5.5606, referenceDate: '2026-11-11', source: 'ptax' as const, fetchedAt: new Date('2026-11-11T17:00:00Z') };

  it('sem override usa a gravada', () => {
    expect(resolveFxRate({ fx: fx(null), today: TODAY, saved })).toEqual({
      rate: 5.5606, referenceDate: '2026-11-11', source: 'ptax', fetchedAt: saved.fetchedAt, stale: false,
    });
  });

  it('override vence a gravada', () => {
    expect(resolveFxRate({ fx: fx({ rate: 5, date: '2026-11-12' }), today: TODAY, saved })?.source).toBe('override');
  });

  it('busca de hoje falhou → last_known', () => {
    expect(resolveFxRate({ fx: fx(null), today: TODAY, saved: { ...saved, source: 'sgs' }, fetchFailedToday: true })?.source).toBe('last_known');
  });

  it('gravada antiga fica stale; inválida = null', () => {
    expect(resolveFxRate({ fx: fx(null), today: TODAY, saved: { ...saved, referenceDate: '2026-11-01' } })?.stale).toBe(true);
    expect(resolveFxRate({ fx: fx(null), today: TODAY, saved: { ...saved, rate: 25 } })).toBeNull();
    expect(resolveFxRate({ fx: fx(null), today: TODAY, saved: null })).toBeNull();
  });
});

describe('isValidFxRate', () => {
  it('aceita só finito entre 1 e 20', () => {
    expect([1, 5.56, 20].every(isValidFxRate)).toBe(true);
    expect([0, 0.99, 20.01, 25, NaN, Infinity, '5.5'].some(isValidFxRate)).toBe(false);
  });
});

describe('fetchFirstFxRate', () => {
  const src = (name: 'ptax' | 'sgs', out: FetchedFxRate | null): IFxRateSource => ({ name, fetchLatest: vi.fn(async () => out) });
  const sgs: FetchedFxRate = { rate: 5.5, referenceDate: '2026-11-11', source: 'sgs' };

  it('PTAX respondeu → SGS não é chamado', async () => {
    const ptax: FetchedFxRate = { ...sgs, source: 'ptax' };
    const b = src('sgs', sgs);
    expect(await fetchFirstFxRate([src('ptax', ptax), b])).toEqual(ptax);
    expect(b.fetchLatest).not.toHaveBeenCalled();
  });

  it('PTAX falhou → SGS como fallback; as duas → null', async () => {
    expect(await fetchFirstFxRate([src('ptax', null), src('sgs', sgs)])).toEqual(sgs);
    expect(await fetchFirstFxRate([src('ptax', null), src('sgs', null)])).toBeNull();
  });
});

describe('resolveClosingFxRate', () => {
  const lastDay = new Date('2026-10-31T00:00:00Z');
  const r = (referenceDate: string, rate: number, source: 'ptax' | 'sgs' = 'ptax'): SavedFxRate =>
    ({ rate, referenceDate, source, fetchedAt: new Date(`${referenceDate}T17:00:00Z`) });
  const inMonth = [r('2026-10-30', 5.6), r('2026-10-01', 5.2, 'sgs'), r('2026-10-15', 5.3)];
  const before = r('2026-09-30', 5.1);

  it('last_business_day = última do mês; month_average = média (4 casas) com data/fonte da última', () => {
    const last = resolveClosingFxRate({ fx: { override: null }, method: 'last_business_day', lastDay, inMonth, before });
    expect(last).toEqual({ fx: expect.objectContaining({ rate: 5.6, referenceDate: '2026-10-30', source: 'ptax', stale: false }), fallback: false });
    const avg = resolveClosingFxRate({ fx: { override: null }, method: 'month_average', lastDay, inMonth, before });
    expect(avg.fx).toMatchObject({ rate: 5.3667, referenceDate: '2026-10-30', source: 'ptax' });
    expect(avg.fallback).toBe(false);
  });

  it('sem cotação no mês → última antes (fallback) nos dois métodos; nada → null sem fallback', () => {
    for (const method of ['last_business_day', 'month_average'] as const) {
      const out = resolveClosingFxRate({ fx: { override: null }, method, lastDay, inMonth: [], before });
      expect(out).toEqual({ fx: expect.objectContaining({ rate: 5.1, referenceDate: '2026-09-30', stale: true }), fallback: true });
      expect(resolveClosingFxRate({ fx: { override: null }, method, lastDay, inMonth: [], before: null })).toEqual({ fx: null, fallback: false });
    }
  });

  it('override ativo vence as gravadas', () => {
    const out = resolveClosingFxRate({ fx: { override: { rate: 6, date: '2026-10-20' } }, method: 'month_average', lastDay, inMonth, before });
    expect(out).toEqual({ fx: expect.objectContaining({ rate: 6, source: 'override', referenceDate: '2026-10-20' }), fallback: false });
  });
});
