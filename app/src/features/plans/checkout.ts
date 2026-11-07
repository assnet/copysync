/**
 * Link de pagamento de um plano×período: URL do gateway no catálogo de vitrine (`checkoutUrls`).
 *
 * Anexa a origem interna (`utm_source=app`, `utm_medium=in_app`, `utm_campaign=plans`,
 * `utm_content=<slug>-<período>`): dentro do painel o clique é interno, então os `utm_*` da URL
 * atual NÃO são repassados (a campanha que trouxe o visitante já foi contada no cadastro).
 * `gclid`/`fbclid` da URL atual seguem repassados (ids de clique de anúncio). Parâmetro já
 * presente no destino vence; a query do destino nunca é re-serializada. Com `prefill`, anexa o
 * autopreenchimento (`checkoutPrefill.ts`). Plano desconhecido ou URL inválida → `null`. Função pura.
 */

import { PLAN_CATALOG, type BillingPeriod, type PlanCatalogItem, type PlanSlug } from './catalog';
import { appendCheckoutPrefill, type CheckoutPrefill } from './checkoutPrefill';
import { appendQuery } from './queryAppend';

const FORWARDED = ['gclid', 'fbclid'] as const;

export function checkoutUtm(slug: PlanSlug, period: BillingPeriod): Record<string, string> {
  return { utm_source: 'app', utm_medium: 'in_app', utm_campaign: 'plans', utm_content: `${slug}-${period}` };
}

export function buildCheckoutUrl(
  slug: PlanSlug,
  period: BillingPeriod,
  search = '',
  catalog: readonly PlanCatalogItem[] = PLAN_CATALOG,
  prefill?: CheckoutPrefill | null,
): string | null {
  const target = catalog.find((p) => p.slug === slug)?.checkoutUrls[period]?.trim();
  if (!target) return null;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return null;
  }
  const additions = new URLSearchParams();
  for (const [key, value] of Object.entries(checkoutUtm(slug, period))) {
    if (!parsed.searchParams.has(key)) additions.set(key, value);
  }
  const current = new URLSearchParams(search);
  for (const key of FORWARDED) {
    const value = current.get(key);
    if (value && !parsed.searchParams.has(key)) additions.set(key, value);
  }
  return appendCheckoutPrefill(appendQuery(target, additions), prefill);
}
