import { describe, expect, it } from 'vitest';
import { buildCheckoutUrl, checkoutSlug } from './checkout';

const BASE = 'https://app.example.com';

describe('buildCheckoutUrl', () => {
  it('monta o slug por plano e período', () => {
    expect(checkoutSlug('starter', 'monthly')).toBe('copysync-starter-mensal');
    expect(checkoutSlug('business', 'annual')).toBe('copysync-business-anual');
    expect(buildCheckoutUrl('profissional', 'annual', '', BASE)).toBe(
      `${BASE}/planos/copysync-profissional-anual`,
    );
  });

  it('env ausente, vazia ou inválida → null', () => {
    expect(buildCheckoutUrl('starter', 'monthly', '', undefined)).toBeNull();
    expect(buildCheckoutUrl('starter', 'monthly', '', '  ')).toBeNull();
    expect(buildCheckoutUrl('starter', 'monthly', '', 'nao-e-url')).toBeNull();
  });

  it('remove barra final da base', () => {
    expect(buildCheckoutUrl('starter', 'monthly', '', `${BASE}//`)).toBe(
      `${BASE}/planos/copysync-starter-mensal`,
    );
  });

  it('repassa só utm_*, gclid e fbclid', () => {
    const url = new URL(
      buildCheckoutUrl('starter', 'monthly', '?utm_source=ig&utm_campaign=x&gclid=g1&fbclid=f1&token=s&tab=2', BASE)!,
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utm_source: 'ig',
      utm_campaign: 'x',
      gclid: 'g1',
      fbclid: 'f1',
    });
  });

  it('parâmetro do destino vence o da URL atual', () => {
    const url = new URL(buildCheckoutUrl('starter', 'monthly', 'utm_source=ig', `${BASE}?utm_source=painel`)!);
    expect(url.pathname).toBe('/planos/copysync-starter-mensal');
    expect(url.searchParams.get('utm_source')).toBe('painel');
  });
});
