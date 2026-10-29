import { describe, expect, it } from 'vitest';
import { ANNUAL_DISCOUNT, PLAN_CATALOG, PREMIUM_SLUG_OFFER, STOREFRONT_BENEFIT_LABEL, priceFor, savingsFor } from './catalog';
import { formatPrice, linkRotationLimitLabel } from './strings';

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

  it('limites de rodízio iguais a api/src/modules/tenants/domain/planPresets.ts', () => {
    const bySlug = Object.fromEntries(PLAN_CATALOG.map((p) => [p.slug, [p.limits.linkRotations, p.limits.linkRotationGroups]]));
    expect(bySlug).toEqual({ starter: [1, 3], profissional: [1, 5], business: [2, 10] });
  });

  it('cada plano exibe o próprio limite de rodízio, com hint do recurso', () => {
    for (const p of PLAN_CATALOG) {
      const row = p.benefits.find((b) => b.label === linkRotationLimitLabel(p.limits.linkRotations, p.limits.linkRotationGroups));
      expect(row?.hint).toMatch(/nunca expira/i);
    }
  });

  it('rótulo do rodízio com plural correto', () => {
    expect(linkRotationLimitLabel(1, 3)).toBe('1 link de rodízio · até 3 grupos');
    expect(linkRotationLimitLabel(2, 10)).toBe('2 links de rodízio · até 10 grupos');
    expect(linkRotationLimitLabel(1, 1)).toBe('1 link de rodízio · até 1 grupo');
  });

  it('Página de Ofertas só no Profissional e Business (storefront_enabled false/true/true na API)', () => {
    const com = PLAN_CATALOG.filter((p) => p.benefits.some((b) => b.label === STOREFRONT_BENEFIT_LABEL)).map((p) => p.slug);
    expect(com).toEqual(['profissional', 'business']);
  });

  it('oferta do nome especial fica fora dos planos e sem checkout por ora', () => {
    expect(PREMIUM_SLUG_OFFER.checkoutUrl).toBeNull();
    expect(PREMIUM_SLUG_OFFER.title).not.toBe('');
    expect(PREMIUM_SLUG_OFFER.benefits.length).toBeGreaterThan(0);
  });
});
