/** Textos do acesso por produto. Sem nome de marca (white label). */
export const productAccessStrings = {
  /** Nome acessível do indicador enquanto a lista de tenants carrega. */
  loading: 'Carregando acesso aos produtos',
  /** Tooltip do cadeado no menu: produto fora do plano do tenant. */
  lockedTooltip: (product: string) => `${product} não está no seu plano. Veja os planos para liberar.`,
  /** Nome acessível do produto travado no menu. */
  lockedAria: (product: string) => `${product}: bloqueado, fora do seu plano`,
} as const;
