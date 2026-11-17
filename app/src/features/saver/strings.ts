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

  /** Tela Grupos (T22). */
  groups: {
    usage: {
      title: 'Uso do plano',
      groups: 'Grupos salvos',
      contacts: 'Contatos guardados',
      scans: 'Leituras nas últimas 24 h',
      scansHint: 'Cada grupo lido conta uma leitura. A contagem considera as últimas 24 horas corridas.',
    },
    limitBanner: {
      title: 'Limite do plano',
      reached: (what: string) => `Você usou todo o limite de ${what} do seu plano.`,
      cta: 'Ver planos',
    },
    queueStopped: 'A leitura de grupos está pausada no momento. Seu pedido entra na fila e começa assim que ela voltar.',
    session: {
      title: 'Ler grupos de uma sessão',
      label: 'Sessão',
      untitled: 'Sessão sem nome',
      whatsapp: 'WhatsApp',
      telegram: 'Telegram',
      none: 'Nenhuma sessão conectada ainda',
      noneHint: 'Conecte um número do WhatsApp para ler os grupos dele.',
      connect: 'Conectar sessão',
      pick: 'Escolha uma sessão para ver os grupos dela.',
      telegramOnly: 'O Saver funciona só com sessões de WhatsApp. Escolha outra sessão.',
      disconnectedTitle: 'Sessão desconectada',
      disconnectedHint: 'Reconecte a sessão para ver os grupos dela.',
      reconnect: 'Reconectar sessão',
      loadFailed: 'Não foi possível carregar as sessões.',
      retry: 'Tentar de novo',
    },
    table: {
      search: 'Buscar grupo',
      searchAria: 'Buscar grupo pelo nome',
      empty: 'Esta sessão não participa de nenhum grupo.',
      noMatch: 'Nenhum grupo com esse nome.',
      selectAll: 'Marcar todos os grupos visíveis',
      selectGroup: 'Marcar grupo',
      untitledGroup: 'Grupo sem nome',
      saved: 'Já salvo',
      savedHint: 'Ler de novo atualiza os contatos deste grupo.',
      neverScanned: 'Nunca lido',
      lastScan: (when: string) => `Última leitura: ${when}`,
      selected: (n: number, max: number) => `${n} de até ${max} grupos por pedido`,
      tooMany: (max: number) => `Marque no máximo ${max} grupos por pedido.`,
      scansLeft: (n: number) => (n === 1 ? 'Resta 1 leitura nas últimas 24 h.' : `Restam ${n.toLocaleString('pt-BR')} leituras nas últimas 24 h.`),
      overScans: (n: number) => `Você marcou mais grupos do que as ${n.toLocaleString('pt-BR')} leituras que restam. Desmarque alguns ou veja os planos.`,
      submit: (n: number) => (n === 1 ? 'Salvar contatos de 1 grupo' : `Salvar contatos de ${n} grupos`),
      noExtractPermission: 'Só o administrador da conta pode ler grupos.',
      clear: 'Limpar seleção',
    },
    progress: {
      title: 'Leitura dos grupos',
      status: {
        QUEUED: 'Na fila',
        RUNNING: 'Lendo os grupos',
        DONE: 'Concluída',
        PARTIAL: 'Concluída com falhas',
        FAILED: 'Não foi concluída',
        CANCELLED: 'Cancelada',
      } as Record<string, string>,
      groups: (done: number, total: number) => `${done} de ${total} grupos`,
      members: (n: number) => `${n.toLocaleString('pt-BR')} membros encontrados`,
      newContacts: (n: number) => `${n.toLocaleString('pt-BR')} contatos novos`,
      failed: (n: number) => (n === 1 ? '1 grupo falhou' : `${n} grupos falharam`),
      paceHint: 'Os grupos são lidos um de cada vez, com intervalo, para proteger o seu número.',
      cancel: 'Cancelar o que falta',
      cancelHint: 'Os grupos já lidos continuam salvos.',
      close: 'Fechar',
    },
    saved: {
      title: 'Grupos salvos',
      subtitle: 'Só as contagens aparecem aqui. Os contatos saem apenas no arquivo exportado.',
      empty: 'Nenhum grupo salvo ainda',
      emptyHint: 'Escolha uma sessão acima, marque os grupos e salve os contatos.',
      loadFailed: 'Não foi possível carregar os grupos salvos.',
      selectAll: 'Marcar todos os grupos salvos',
      selectGroup: 'Marcar grupo para exportar',
      columns: { name: 'Grupo', members: 'Membros', phones: 'Com número', lidOnly: 'Número oculto', lastScan: 'Última leitura', actions: 'Ações' },
      lidOnlyHint: 'Membros que esconderam o número no WhatsApp. Entram no CSV sem telefone e ficam fora do vCard.',
      hiddenNotice: (n: number) =>
        n === 1
          ? '1 membro escondeu o número no WhatsApp. Ele entra no CSV sem telefone e fica fora do vCard.'
          : `${n.toLocaleString('pt-BR')} membros esconderam o número no WhatsApp. Eles entram no CSV sem telefone e ficam fora do vCard.`,
      scanStatus: { FAILED: 'A última leitura falhou', CANCELLED: 'A última leitura foi cancelada', QUEUED: 'Na fila', RUNNING: 'Lendo agora' } as Record<string, string>,
      remove: 'Remover grupo',
      removeTitle: 'Remover este grupo?',
      removeBody: 'O grupo sai da lista e das exportações. Leituras na fila deste grupo são canceladas. Para voltar, leia o grupo de novo.',
      removeConfirm: 'Remover',
      removeCancel: 'Cancelar',
      exportSelected: (n: number) => (n === 1 ? 'Exportar 1 grupo' : `Exportar ${n} grupos`),
      exportAll: 'Exportar todos',
    },
    dateTime: (iso: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)),
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
