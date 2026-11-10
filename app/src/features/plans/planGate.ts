/** Chaves de entitlement (`meta.key` do 403 `PLAN_FEATURE_UNAVAILABLE`) que as telas tratam. */
export const PLAN_FEATURE_KEYS = {
  storefront: 'storefront_enabled',
  offerStory: 'offer_story_enabled',
  shein: 'marketplace_shein_enabled',
} as const;

/** `meta.key` do erro, quando vier como texto. */
export function planFeatureKeyOf(err: unknown): string | null {
  const key = (err as { meta?: { key?: unknown } | null } | null)?.meta?.key;
  return typeof key === 'string' ? key : null;
}

/**
 * Gate de plano compartilhado pelas telas de recurso pago (Página de Ofertas, Story de Oferta).
 * Redireciona só no `PLAN_FEATURE_UNAVAILABLE`: o `PLAN_LIMIT_REACHED` também é 403 e tem
 * tratamento próprio. Fica fora do interceptor global do `apiClient` (que expõe `code` no erro).
 * Com `featureKey`: só conta o 403 desse recurso (ou sem chave); o de outro recurso (ex.: Shein
 * fora do plano ao extrair o link) não é o recurso da tela e não redireciona.
 */
export function isPlanFeatureUnavailable(err: unknown, featureKey?: string): boolean {
  if (typeof err !== 'object' || err === null || (err as { code?: unknown }).code !== 'PLAN_FEATURE_UNAVAILABLE') return false;
  if (!featureKey) return true;
  const key = planFeatureKeyOf(err);
  return key === null || key === featureKey;
}

/** Shein fora do plano (403 ao usar link da Shein). */
export const isSheinUnavailable = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'PLAN_FEATURE_UNAVAILABLE' && planFeatureKeyOf(err) === PLAN_FEATURE_KEYS.shein;
