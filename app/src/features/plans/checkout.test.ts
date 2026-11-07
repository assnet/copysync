import { describe, expect, it } from 'vitest';
import { PLAN_CATALOG, type PlanCatalogItem } from './catalog';
import { buildCheckoutUrl, checkoutUtm } from './checkout';

const CAKTO = {
  lite: { monthly: 'https://pay.cakto.com.br/8e4gepk_1291207', annual: 'https://pay.cakto.com.br/a92kn9k_1291217' },
  pro: { monthly: 'https://pay.cakto.com.br/fronsgu_1291227', annual: 'https://pay.cakto.com.br/f34qfgh_1291232' },
  max: { monthly: 'https://pay.cakto.com.br/kzoagvc_1291239', annual: 'https://pay.cakto.com.br/97nqcb8_1291245' },
} as const;

const utmQuery = (slug: string, period: string) =>
  `utm_source=app&utm_medium=in_app&utm_campaign=plans&utm_content=${slug}-${period}`;
const lite = PLAN_CATALOG[0];
const custom = (monthly: string): PlanCatalogItem[] => [{ ...lite, checkoutUrls: { monthly, annual: monthly } }];

describe('buildCheckoutUrl', () => {
  it('6 links de pagamento (plano × período) com a UTM interna', () => {
    for (const plan of PLAN_CATALOG) {
      for (const period of ['monthly', 'annual'] as const) {
        expect(buildCheckoutUrl(plan.slug, period)).toBe(`${CAKTO[plan.slug][period]}?${utmQuery(plan.slug, period)}`);
      }
    }
  });

  it('UTM sem nome do produto nos valores', () => {
    expect(checkoutUtm('pro', 'annual')).toEqual({ utm_source: 'app', utm_medium: 'in_app', utm_campaign: 'plans', utm_content: 'pro-annual' });
  });

  it('utm_* da URL atual não passa (interna prevalece); gclid e fbclid passam; o resto não', () => {
    const url = new URL(buildCheckoutUrl('lite', 'monthly', '?utm_source=ig&utm_term=t&gclid=g1&fbclid=f1&token=s')!);
    expect(url.origin + url.pathname).toBe(CAKTO.lite.monthly);
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...checkoutUtm('lite', 'monthly'), gclid: 'g1', fbclid: 'f1' });
  });

  it('parâmetro do destino vence e a query do destino sai byte a byte igual', () => {
    const target = 'https://pay.test/x?utm_source=painel&sck=a%20b+c&gclid=';
    const out = buildCheckoutUrl('lite', 'monthly', 'gclid=g1', custom(target))!;
    expect(out.startsWith(`${target}&`)).toBe(true);
    const url = new URL(out);
    expect(url.searchParams.getAll('utm_source')).toEqual(['painel']);
    expect(url.searchParams.getAll('gclid')).toEqual(['']);
  });

  it('preserva o hash do destino', () => {
    expect(buildCheckoutUrl('lite', 'monthly', '', custom('https://pay.test/x#topo'))).toBe(`https://pay.test/x?${utmQuery('lite', 'monthly')}#topo`);
  });

  it('URL inválida ou plano ausente → null', () => {
    expect(buildCheckoutUrl('lite', 'monthly', '', custom('nao-e-url'))).toBeNull();
    expect(buildCheckoutUrl('pro', 'monthly', '', custom('https://pay.test/x'))).toBeNull();
  });

  it('com prefill: anexa no gateway hospedado, depois da UTM', () => {
    const prefill = { email: 'ana@x.com', confirmEmail: 'ana@x.com', name: 'Ana Souza' };
    expect(buildCheckoutUrl('max', 'annual', '', PLAN_CATALOG, prefill)).toBe(
      `${CAKTO.max.annual}?${utmQuery('max', 'annual')}&name=Ana+Souza&email=ana%40x.com&confirmEmail=ana%40x.com`,
    );
  });

  it('com prefill: host diferente não recebe dado pessoal', () => {
    const out = buildCheckoutUrl('lite', 'monthly', '', custom('https://pay.test/x'), { email: 'ana@x.com', name: 'Ana' })!;
    expect(out).toBe(`https://pay.test/x?${utmQuery('lite', 'monthly')}`);
  });
});
