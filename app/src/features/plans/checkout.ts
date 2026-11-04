/**
 * Link da página de venda (redirect da central → página do gateway).
 *
 * Formato: `{VITE_BILLING_CHECKOUT_URL}/planos/copysync-{plano}-{periodo}` (decisão do `plans-modal`, alternativa A).
 * Repassa da URL atual só `utm_*`, `gclid` e `fbclid`; parâmetro já presente no destino vence.
 * Env ausente/vazia → `null`: quem chama mostra a alternativa (vitrine interna ou suporte). Função pura.
 */

import type { BillingPeriod, PlanSlug } from './catalog';

const PERIOD_SLUG: Record<BillingPeriod, string> = { monthly: 'mensal', annual: 'anual' };
const FORWARDED = new Set(['gclid', 'fbclid']);

function isForwarded(key: string): boolean {
  return key.startsWith('utm_') || FORWARDED.has(key);
}

export function checkoutSlug(slug: PlanSlug, period: BillingPeriod): string {
  return `copysync-${slug}-${PERIOD_SLUG[period]}`;
}

export function buildCheckoutUrl(
  slug: PlanSlug,
  period: BillingPeriod,
  search = '',
  base: string | undefined = import.meta.env.VITE_BILLING_CHECKOUT_URL,
): string | null {
  const root = base?.trim();
  if (!root) return null;
  let url: URL;
  try {
    url = new URL(root);
  } catch {
    return null;
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/planos/${checkoutSlug(slug, period)}`;
  new URLSearchParams(search).forEach((value, key) => {
    if (isForwarded(key) && !url.searchParams.has(key)) url.searchParams.set(key, value);
  });
  return url.toString();
}
