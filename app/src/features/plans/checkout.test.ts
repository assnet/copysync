import { describe, expect, it } from 'vitest';
import { PLAN_CATALOG, type PlanCatalogItem } from './catalog';
import { buildCheckoutUrl } from './checkout';

const CAKTO = {
  lite: { monthly: 'https://pay.cakto.com.br/8e4gepk_1291207', annual: 'https://pay.cakto.com.br/a92kn9k_1291217' },
  pro: { monthly: 'https://pay.cakto.com.br/fronsgu_1291227', annual: 'https://pay.cakto.com.br/f34qfgh_1291232' },
  max: { monthly: 'https://pay.cakto.com.br/kzoagvc_1291239', annual: 'https://pay.cakto.com.br/97nqcb8_1291245' },
} as const;

describe('buildCheckoutUrl', () => {
  it('6 links de pagamento (plano × período) vêm do catálogo', () => {
    for (const plan of PLAN_CATALOG) {
      expect(buildCheckoutUrl(plan.slug, 'monthly')).toBe(CAKTO[plan.slug].monthly);
      expect(buildCheckoutUrl(plan.slug, 'annual')).toBe(CAKTO[plan.slug].annual);
    }
  });

  it('repassa só utm_*, gclid e fbclid', () => {
    const url = new URL(buildCheckoutUrl('lite', 'monthly', '?utm_source=ig&utm_campaign=x&gclid=g1&fbclid=f1&token=s&tab=2')!);
    expect(url.origin + url.pathname).toBe(CAKTO.lite.monthly);
    expect(Object.fromEntries(url.searchParams)).toEqual({ utm_source: 'ig', utm_campaign: 'x', gclid: 'g1', fbclid: 'f1' });
  });

  it('parâmetro do destino vence o da URL atual; URL inválida → null', () => {
    const lite = PLAN_CATALOG[0];
    const custom = (monthly: string): PlanCatalogItem[] => [{ ...lite, checkoutUrls: { monthly, annual: monthly } }];
    const url = new URL(buildCheckoutUrl('lite', 'monthly', 'utm_source=ig', custom('https://pay.test/x?utm_source=painel'))!);
    expect(url.searchParams.get('utm_source')).toBe('painel');
    expect(buildCheckoutUrl('lite', 'monthly', '', custom('nao-e-url'))).toBeNull();
    expect(buildCheckoutUrl('pro', 'monthly', '', custom('https://pay.test/x'))).toBeNull();
  });
});
