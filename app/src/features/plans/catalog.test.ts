import { describe, expect, it } from 'vitest';
import { ANNUAL_DISCOUNT, PLAN_CATALOG, priceFor, savingsFor } from './catalog';
import { formatPrice } from './strings';

describe('catálogo de planos (vitrine)', () => {
  it('tem 3 planos, 1 recomendado, slugs únicos', () => {
    expect(PLAN_CATALOG).toHaveLength(3);
    expect(PLAN_CATALOG.filter((p) => p.recommended)).toHaveLength(1);
    expect(new Set(PLAN_CATALOG.map((p) => p.slug)).size).toBe(3);
  });

  it('preço "por" sempre menor que o "de"', () => {
    for (const p of PLAN_CATALOG) expect(p.price).toBeLessThan(p.priceFrom);
  });

  it('limites crescem do Starter ao Business (docs/produto-roadmap.md)', () => {
    const [s, p, b] = PLAN_CATALOG;
    expect(s!.limits.monitoredGroups).toBeLessThanOrEqual(p!.limits.monitoredGroups);
    expect(p!.limits.monitoredGroups).toBeLessThanOrEqual(b!.limits.monitoredGroups);
    expect(s!.limits.broadcastGroups).toBeLessThanOrEqual(p!.limits.broadcastGroups);
    expect(p!.limits.broadcastGroups).toBeLessThanOrEqual(b!.limits.broadcastGroups);
  });

  it('formata preço inteiro sem centavos e fracionado com 2 casas', () => {
    expect(formatPrice(97).replace(/\u00a0/g, ' ')).toBe('R$ 97');
    expect(formatPrice(64.9).replace(/\u00a0/g, ' ')).toBe('R$ 64,90');
  });

  it('anual fica perto do desconto anunciado e abaixo do mensal', () => {
    for (const p of PLAN_CATALOG) {
      expect(priceFor(p, 'annual')).toBeLessThan(priceFor(p, 'monthly'));
      const real = 1 - p.priceAnnualMonthly / p.price;
      expect(Math.abs(real - ANNUAL_DISCOUNT)).toBeLessThan(0.02);
      expect(savingsFor(p, 'annual')).toEqual({ value: (p.price - p.priceAnnualMonthly) * 12, per: 'year' });
      expect(savingsFor(p, 'monthly')).toEqual({ value: p.priceFrom - p.price, per: 'month' });
    }
  });
});
