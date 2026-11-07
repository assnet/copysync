/**
 * Link de pagamento de um plano×período: URL do gateway no catálogo de vitrine (`checkoutUrls`).
 *
 * Repassa da URL atual só `utm_*`, `gclid` e `fbclid`; parâmetro já presente no destino vence.
 * Plano desconhecido ou URL inválida → `null`: quem chama mostra a alternativa (vitrine interna). Função pura.
 */

import { PLAN_CATALOG, type BillingPeriod, type PlanCatalogItem, type PlanSlug } from './catalog';

const FORWARDED = new Set(['gclid', 'fbclid']);

function isForwarded(key: string): boolean {
  return key.startsWith('utm_') || FORWARDED.has(key);
}

export function buildCheckoutUrl(
  slug: PlanSlug,
  period: BillingPeriod,
  search = '',
  catalog: readonly PlanCatalogItem[] = PLAN_CATALOG,
): string | null {
  const target = catalog.find((p) => p.slug === slug)?.checkoutUrls[period]?.trim();
  if (!target) return null;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  new URLSearchParams(search).forEach((value, key) => {
    if (isForwarded(key) && !url.searchParams.has(key)) url.searchParams.set(key, value);
  });
  return url.toString();
}
