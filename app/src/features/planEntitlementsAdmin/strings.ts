/** Textos da tela de recursos por plano (super admin). pt-BR, sem nome de marca. */
export const planEntitlementsAdminStrings = {
  pageTitle: 'Recursos por plano',
  pageSubtitle: 'Libere ou bloqueie recursos em cada plano. A mudança vale na hora para todos os clientes do plano.',
  listTitle: 'Recursos editáveis',
  retry: 'Tentar de novo',
  empty: 'Nenhum recurso editável',
  emptyHint: 'A lista de recursos que podem ser alterados por plano está vazia.',
  columns: { feature: 'Recurso' },

  /** Nome de exibição do plano (o mesmo da vitrine em `features/plans/catalog.ts`). */
  planName: { COPYSYNC_LITE: 'LITE', COPYSYNC_PRO: 'PRO', COPYSYNC_MAX: 'MAX' } as Record<string, string>,

  /** Rótulo e descrição curta por chave; chave sem texto mostra o próprio nome técnico. */
  features: {
    marketplace_shein_enabled: {
      label: 'Afiliado Shein',
      description: 'Gerar ofertas com links de afiliado da Shein.',
    },
  } as Record<string, { label: string; description: string }>,

  notPresetHint: 'Sem valor gravado neste plano: conta como desligado.',
  switchAria: (feature: string, plan: string) => `${feature} no plano ${plan}`,
  switchTooltip: (feature: string, plan: string, on: boolean) =>
    on ? `${feature} liberado no ${plan}. Clique para bloquear.` : `${feature} bloqueado no ${plan}. Clique para liberar.`,

  confirm: {
    titleOn: (feature: string, plan: string) => `Liberar ${feature} no ${plan}?`,
    titleOff: (feature: string, plan: string) => `Bloquear ${feature} no ${plan}?`,
    description: (plan: string) =>
      `A mudança vale na hora para todos os clientes do plano ${plan}, sem precisar entrar de novo. Fica registrada na auditoria.`,
    confirmOn: 'Liberar',
    confirmOff: 'Bloquear',
    cancel: 'Cancelar',
  },

  saved: (feature: string, plan: string, on: boolean, tenants: number) => {
    const who = tenants === 1 ? '1 cliente atualizado' : `${tenants} clientes atualizados`;
    return `${feature} ${on ? 'liberado' : 'bloqueado'} no ${plan}. ${who}.`;
  },

  errors: {
    generic: 'Não foi possível concluir. Tente de novo em instantes.',
    load: 'Não foi possível carregar os recursos por plano.',
    VALIDATION_ERROR: 'Recurso ou plano não pode ser alterado por aqui.',
    FORBIDDEN: 'Só o administrador da plataforma pode alterar recursos por plano.',
  } as Record<string, string>,
};

export function featureLabel(key: string): string {
  return planEntitlementsAdminStrings.features[key]?.label ?? key;
}

export function planName(slug: string): string {
  return planEntitlementsAdminStrings.planName[slug] ?? slug;
}

export function planEntitlementErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  const e = planEntitlementsAdminStrings.errors;
  return (typeof code === 'string' && e[code]) || e.generic;
}
