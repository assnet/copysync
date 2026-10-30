/**
 * Gate de plano compartilhado pelas telas de recurso pago (Página de Ofertas, Story de Oferta).
 * Redireciona só no `PLAN_FEATURE_UNAVAILABLE`: o `PLAN_LIMIT_REACHED` também é 403 e tem
 * tratamento próprio. Fica fora do interceptor global do `apiClient` (que expõe `code` no erro).
 */
export function isPlanFeatureUnavailable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'PLAN_FEATURE_UNAVAILABLE';
}
