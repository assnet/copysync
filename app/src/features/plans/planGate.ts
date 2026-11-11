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

/** Chaves de limite (`meta.key` do 403 `PLAN_LIMIT_REACHED`) com tratamento próprio nas telas. */
export const PLAN_LIMIT_KEYS = {
  mercadoLivreTags: 'mercado_livre_affiliate_tags',
} as const;

/** Link com etiqueta da conta do ML não vinculada e sem vaga no plano (403 `PLAN_LIMIT_REACHED`). */
export const isMercadoLivreTagLimit = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'PLAN_LIMIT_REACHED' && planFeatureKeyOf(err) === PLAN_LIMIT_KEYS.mercadoLivreTags;

/** `meta.limit` numérico do erro, quando vier. */
export function planLimitOf(err: unknown): number | null {
  const limit = (err as { meta?: { limit?: unknown } | null } | null)?.meta?.limit;
  return typeof limit === 'number' ? limit : null;
}
