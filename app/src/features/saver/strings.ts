/**
 * Textos do Saver no painel (pt-BR, sem nome de marca). Frase com variável é função tipada.
 * O rótulo do produto no menu mora em `features/navigation/strings.ts`.
 */
export const saverStrings = {
  menu: {
    groups: 'Grupos',
    settings: 'Configurações',
    plans: 'Planos',
    /** Super admin: base de contatos da plataforma. */
    platformContacts: 'Base de contatos',
  },

  /** Carregando a visibilidade do Saver (guard das rotas). */
  accessLoading: 'Carregando o Saver',

  pages: {
    groups: {
      title: 'Grupos',
      subtitle: 'Escolha a sessão, marque os grupos e salve os contatos de quem participa deles.',
    },
    settings: {
      title: 'Configurações',
      subtitle: 'Padrões da exportação e quem da equipe pode baixar os contatos.',
    },
    platformContacts: {
      title: 'Base de contatos',
      subtitle: 'Contatos extraídos por todas as contas. Acesso só do super admin, com registro na auditoria.',
    },
    /** Esqueleto até a tela ser preenchida. */
    comingSoon: 'Esta tela está sendo preparada.',
  },

  limits: {
    unlimited: 'Ilimitado',
    usage: (used: number, limit: number | null) =>
      limit === null ? `${used.toLocaleString('pt-BR')} · ilimitado` : `${used.toLocaleString('pt-BR')} de ${limit.toLocaleString('pt-BR')}`,
  },

  /** Mensagem por código de erro da API (design.md §7). */
  errors: {
    PRODUCT_UNAVAILABLE: 'O Saver não está no plano da sua conta. Veja os planos para liberar.',
    SAVER_UNAVAILABLE: 'O Saver ainda não está disponível para a sua conta.',
    PLAN_LIMIT_REACHED: 'Você chegou ao limite do seu plano. Veja os planos para continuar.',
    FORBIDDEN: 'Você não tem permissão para esta ação. Peça ao administrador da conta.',
    SESSION_NOT_CONNECTED: 'A sessão está desconectada. Reconecte para ver os grupos.',
    ENGINE_OPERATION_UNSUPPORTED: 'Disponível só para sessões de WhatsApp.',
    SESSION_NOT_FOUND: 'Sessão não encontrada. Escolha outra.',
    EXPORT_EMPTY: 'Nenhum contato nos grupos e filtros escolhidos.',
    SERVICE_UNAVAILABLE: 'Estamos atualizando o sistema. Tente de novo em instantes.',
    generic: 'Não foi possível concluir agora. Tente de novo.',
  } as Record<string, string>,

  /** Nome do limite atingido (`meta.key` do `PLAN_LIMIT_REACHED`). */
  limitKeys: {
    saver_groups: 'grupos salvos',
    saver_contacts: 'contatos guardados',
    saver_group_scans_per_day: 'leituras de grupo nas últimas 24 horas',
  } as Record<string, string>,
  limitReached: (what: string, limit: number) => `Você chegou ao limite de ${limit.toLocaleString('pt-BR')} ${what} do seu plano.`,
};
