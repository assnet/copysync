/** Textos da tela de recursos por plano (super admin). pt-BR, sem nome de marca. */
export const planEntitlementsAdminStrings = {
  pageTitle: 'Recursos por plano',
  pageSubtitle: 'Libere ou bloqueie recursos em cada plano. A mudança vale na hora para todos os clientes do plano.',
  listTitle: 'Recursos editáveis',
  retry: 'Tentar de novo',
  empty: 'Nenhum recurso editável',
  emptyHint: 'A lista de recursos que podem ser alterados por plano está vazia.',
  columns: { feature: 'Recurso', audience: 'Só super admin' },

  /** Nome de exibição do plano (o mesmo da vitrine em `features/plans/catalog.ts`). */
  planName: {
    COPYSYNC_LITE: 'LITE', COPYSYNC_PRO: 'PRO', COPYSYNC_MAX: 'MAX',
    SAVER_LITE: 'Saver LITE', SAVER_PRO: 'Saver PRO', SAVER_MAX: 'Saver MAX',
  } as Record<string, string>,

  /** Rótulo e descrição curta por chave; chave sem texto mostra o próprio nome técnico. */
  features: {
    marketplace_shein_enabled: {
      label: 'Afiliado Shein',
      description: 'Gerar ofertas com links de afiliado da Shein.',
    },
    offer_hunter_enabled: {
      label: 'Caçador de Ofertas',
      description: 'Buscar ofertas automaticamente no catálogo da Shein.',
    },
    offer_hunter_finds_per_day: {
      label: 'Achados por dia do Caçador',
      description: 'Quantas ofertas o Caçador pode encontrar por dia em cada cliente.',
    },
  } as Record<string, { label: string; description: string }>,

  /** Célula de plano de outro produto: a chave não se aplica (sem controle). */
  otherProduct: {
    text: '—',
    aria: (feature: string, plan: string) => `${feature} não se aplica ao plano ${plan}`,
    tooltip: 'Recurso de outro produto: não se aplica a este plano.',
  },

  notPresetHint: 'Sem valor gravado neste plano: conta como desligado.',
  notPresetHintNumber: 'Sem valor gravado neste plano: conta como 0.',
  switchAria: (feature: string, plan: string) => `${feature} no plano ${plan}`,
  switchTooltip: (feature: string, plan: string, on: boolean) =>
    on ? `${feature} liberado no ${plan}. Clique para bloquear.` : `${feature} bloqueado no ${plan}. Clique para liberar.`,

  /** Coluna "Só super admin": audiência do recurso (hoje só o Caçador de Ofertas). */
  audience: {
    none: '—',
    noneAria: 'Não se aplica a este recurso',
    aria: (feature: string) => `${feature}: só super admin`,
    tooltipOn: 'Só o super admin vê e usa este recurso, mesmo nos planos liberados',
    tooltipOff: 'Liberado para todos os clientes dos planos marcados',
    titleOn: (feature: string) => `Deixar ${feature} só para o super admin?`,
    titleOff: (feature: string) => `Liberar ${feature} para os clientes?`,
    descriptionOn: (feature: string) =>
      `${feature} deixa de aparecer para os clientes e só o super admin vê e usa, mesmo nos planos liberados. Vale na hora e fica registrado na auditoria.`,
    descriptionOff: (feature: string) =>
      `Todos os clientes dos planos marcados passam a ver e usar ${feature}, sem precisar entrar de novo. Vale na hora e fica registrado na auditoria.`,
    confirmOn: 'Só super admin',
    confirmOff: 'Liberar para clientes',
    saved: (feature: string, on: boolean) =>
      on ? `${feature} agora é só do super admin.` : `${feature} liberado para os clientes dos planos marcados.`,
  },

  /** Chave numérica: campo de número com salvar explícito (nada grava a cada tecla). */
  number: {
    aria: (feature: string, plan: string) => `${feature} no plano ${plan}`,
    placeholder: '0',
    range: (min: number, max: number) => `Número inteiro de ${min} a ${max}.`,
    invalid: (min: number, max: number) => `Use um número inteiro de ${min} a ${max}.`,
    save: (feature: string, plan: string) => `Salvar ${feature} no plano ${plan}`,
    saveTooltip: 'Salvar valor',
  },

  confirm: {
    titleNumber: (feature: string, plan: string) => `Alterar ${feature} no ${plan}?`,
    descriptionNumber: (from: number | null, to: number, plan: string) =>
      `O valor passa de ${from ?? 'sem valor'} para ${to}. A mudança vale na hora para todos os clientes do plano ${plan}, sem precisar entrar de novo. Fica registrada na auditoria.`,
    confirmNumber: 'Salvar',
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

  savedNumber: (feature: string, plan: string, value: number, tenants: number) => {
    const who = tenants === 1 ? '1 cliente atualizado' : `${tenants} clientes atualizados`;
    return `${feature} no ${plan} agora é ${value}. ${who}.`;
  },

  errors: {
    generic: 'Não foi possível concluir. Tente de novo em instantes.',
    load: 'Não foi possível carregar os recursos por plano.',
    VALIDATION_ERROR: 'Recurso, plano ou valor não pode ser gravado por aqui.',
    FORBIDDEN: 'Só o administrador da plataforma pode alterar recursos por plano.',
    BAD_REQUEST: 'Este recurso não tem a opção "Só super admin".',
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
