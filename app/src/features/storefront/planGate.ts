/**
 * Gate de plano da Página de Ofertas. Redireciona só no `PLAN_FEATURE_UNAVAILABLE`: o
 * `PLAN_LIMIT_REACHED` também é 403 e tem tratamento próprio. Fica aqui, sem mexer no
 * interceptor global do `apiClient` (que expõe `code` no erro rejeitado).
 */
export const storefrontUpgradePath = '/plans?feature=storefront';

export function isPlanFeatureUnavailable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'PLAN_FEATURE_UNAVAILABLE';
}
