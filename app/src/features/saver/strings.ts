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

  /** Tela de configurações (T25). */
  settings: {
    loading: 'Carregando as configurações',
    loadError: 'Não foi possível carregar as configurações.',
    retry: 'Tentar de novo',
    readOnly: 'Só o administrador da conta altera estas configurações. Você vê os padrões em uso.',
    defaults: {
      title: 'Padrões da exportação',
      subtitle: 'Já vêm marcados ao baixar os contatos. Dá para trocar em cada exportação.',
    },
    prefix: {
      label: 'Prefixo do nome',
      placeholder: 'Ex.: Cliente',
      help: 'Vai antes do nome de cada contato no arquivo, para achar todos juntos na agenda.',
      example: (prefix: string) => `Na agenda: "${prefix} Maria Souza"`,
      tooLong: (max: number) => `Use até ${max} caracteres.`,
      counter: (used: number, max: number) => `${used}/${max}`,
    },
    excludeAdmins: {
      title: 'Deixar os administradores do grupo de fora',
      description: 'Quem administra o grupo não entra no arquivo.',
    },
    format: {
      label: 'Formato do arquivo',
      CSV: 'Planilha (CSV)',
      VCARD: 'Agenda (vCard)',
      help: {
        CSV: 'Abre no Excel e no Google Planilhas.',
        VCARD: 'Importa direto na agenda do celular.',
      },
    },
    autoRefresh: {
      title: 'Atualização diária',
      description: 'Lê de novo, uma vez por dia, os grupos salvos para trazer quem entrou.',
      unavailable: 'Seu plano não inclui a atualização diária. Veja os planos para liberar.',
      unavailableShort: 'Não incluída no seu plano',
    },
    save: 'Salvar',
    saving: 'Salvando',
    discard: 'Descartar alterações',
    unsaved: 'Alterações não salvas',
    saved: 'Configurações salvas.',
    lastSaved: (when: string) => `Salvo em ${when}`,
    neverSaved: 'Usando os valores padrão.',
  },

  /** Seção "Quem pode exportar" (só `ADMIN`). */
  grants: {
    title: 'Quem pode exportar',
    subtitle: 'Administradores sempre podem. Operadores só baixam os contatos se você liberar.',
    empty: 'Nenhum operador na equipe ainda.',
    emptyHint: 'Quem entrar na conta como operador aparece aqui para você liberar a exportação.',
    loadError: 'Não foi possível carregar a equipe.',
    switchLabel: (name: string) => `Liberar a exportação para ${name}`,
    tooltipOn: 'Pode baixar os contatos. Clique para tirar a liberação.',
    tooltipOff: 'Não pode baixar os contatos. Clique para liberar.',
    allowed: 'Pode exportar',
    blocked: 'Sem permissão',
    toggleFailed: 'Não foi possível mudar a permissão. Ela voltou ao que era.',
  },

  limits: {
    unlimited: 'Ilimitado',
    /** Limite 0: o plano não inclui (nunca "0 de 0"). */
    notIncluded: 'Não incluso no plano',
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
    /** Conta sem plano do Saver (todos os limites 0). */
    noPlan: {
      title: 'Seu plano ainda não inclui o Saver',
      body: 'Escolha um plano para salvar grupos, guardar os contatos e baixar a lista quando quiser.',
      cta: 'Ver planos',
    },
    /** Super admin numa conta sem o Saver (`overview.pilot`): limites do plano MAX para testar. */
    pilot: {
      title: 'Modo piloto do super admin',
      body: 'Esta conta não tem plano do Saver. Para você testar, valem os limites do plano MAX: leia grupos e guarde contatos normalmente.',
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
      members: (n: number | null) => (n === null ? '—' : n === 1 ? '1 membro' : `${n.toLocaleString('pt-BR')} membros`),
      membersUnknown: 'O WhatsApp não informou o total de membros deste grupo.',
      selectedMembers: (n: number, partial: boolean) =>
        `${partial ? 'Pelo menos ' : ''}${n.toLocaleString('pt-BR')} ${n === 1 ? 'membro' : 'membros'} nos grupos marcados`,
      kind: { COMMUNITY: 'Comunidade', COMMUNITY_ANNOUNCE: 'Avisos da comunidade' } as Record<string, string>,
      kindHint: {
        COMMUNITY: 'A comunidade não tem membros próprios. Marque o grupo de avisos dela para salvar todos os membros.',
        COMMUNITY_ANNOUNCE: 'Grupo de avisos da comunidade: reúne todos os membros dela.',
      } as Record<string, string>,
      unselectable: { COMMUNITY_PARENT: 'Não dá para ler a comunidade em si. Use o grupo de avisos dela.' } as Record<string, string>,
      filtersAria: 'Filtrar grupos',
      filters: { all: 'Todos', unread: 'Não lidos', saved: 'Já salvos', communities: 'Comunidades', selfAdmin: 'Sou admin' } as Record<string, string>,
      filterHints: {
        all: 'Todos os grupos desta sessão.',
        unread: 'Grupos que você ainda não leu.',
        saved: 'Grupos com contatos já salvos. Ler de novo atualiza a lista.',
        communities: 'Comunidades e grupos de avisos.',
        selfAdmin: 'Grupos em que esta sessão é administradora.',
      } as Record<string, string>,
      sortLabel: 'Ordenar por',
      sort: { name: 'Nome', members: 'Mais membros' } as Record<string, string>,
      noMatchFilter: 'Nenhum grupo neste filtro.',
      resetFilters: 'Ver todos os grupos',
      showing: (shown: number, total: number) =>
        `Mostrando ${shown.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} ${total === 1 ? 'grupo' : 'grupos'}`,
      showMore: (n: number) => (n === 1 ? 'Mostrar mais 1 grupo' : `Mostrar mais ${n.toLocaleString('pt-BR')} grupos`),
      selectionBar: 'Grupos marcados',
      selfAdmin: 'Você é admin',
      selfAdminHint: 'Esta sessão é administradora do grupo.',
      hiddenNumbers: 'Números ocultos: esta sessão não é admin',
      hiddenNumbersHint:
        'O WhatsApp só mostra os números de um grupo de comunidade para administradores. Conectar a sessão do número que é admin costuma resolver.',
      hiddenNumbersSelected: (n: number) =>
        n === 1
          ? '1 grupo marcado deve vir com números ocultos: esta sessão não é admin.'
          : `${n.toLocaleString('pt-BR')} grupos marcados devem vir com números ocultos: esta sessão não é admin.`,
      outsideView: (n: number) =>
        n === 1 ? '1 grupo marcado está fora do filtro atual e também será salvo.' : `${n.toLocaleString('pt-BR')} grupos marcados estão fora do filtro atual e também serão salvos.`,
    },
    copyName: {
      action: 'Copiar nome do grupo',
      actionOf: (name: string) => `Copiar nome do grupo ${name}`,
      copied: 'Nome copiado',
      failed: 'Não foi possível copiar o nome. Tente de novo.',
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
      hiddenLikelyCause: (n: number) =>
        `Quase todos os números vieram ocultos em ${n === 1 ? '1 grupo' : `${n.toLocaleString('pt-BR')} grupos`}. Causa provável: a sessão que leu não é admin do grupo. O WhatsApp só mostra os números para administradores; leia de novo com a sessão do número que é admin.`,
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

  /** Diálogo de exportação (T24). */
  exportDialog: {
    title: 'Exportar contatos',
    scopeAll: (n: number) => (n === 1 ? 'Todos os grupos salvos (1)' : `Todos os grupos salvos (${n})`),
    scopeSelected: (n: number) => (n === 1 ? '1 grupo marcado' : `${n} grupos marcados`),
    format: 'Formato',
    formats: {
      CSV: 'Planilha (CSV)',
      VCARD: 'Agenda (vCard)',
    } as Record<string, string>,
    formatHints: {
      CSV: 'Abre no Excel e no Google Planilhas. Colunas: nome, telefone, LID e data da leitura.',
      VCARD: 'Importa direto na agenda do celular. Só entra quem tem número.',
    } as Record<string, string>,
    prefix: 'Prefixo do nome',
    prefixHelp: (max: number) => `Vem antes do nome de cada contato, para achá-los fácil na agenda. Até ${max} caracteres.`,
    prefixPlaceholder: 'Ex.: Cliente',
    excludeAdmins: 'Remover administradores',
    excludeAdminsHint: 'Deixa de fora quem é administrador do grupo.',
    onlyActive: 'Só quem ainda está no grupo',
    onlyActiveHint: 'Deixa de fora quem saiu depois da última leitura.',
    onlyWithPhone: 'Só contatos com número',
    onlyWithPhoneHint: 'Deixa de fora quem escondeu o número.',
    onePerGroup: 'Uma linha por grupo',
    onePerGroupHint: 'Quem está em vários grupos aparece uma vez em cada um, com a coluna Grupo. Desligado, cada contato aparece uma vez.',
    summaryTitle: 'Resumo',
    summaryIncluded: (n: number) => (n === 1 ? 'Até 1 contato no arquivo' : `Até ${n.toLocaleString('pt-BR')} contatos no arquivo`),
    summaryHint: 'Estimativa pelas contagens dos grupos. Contato em mais de um grupo e os filtros acima podem reduzir o total.',
    summaryVcardSkipped: (n: number) =>
      n === 1
        ? '1 membro com número oculto fica fora do vCard. Para incluí-lo, exporte em CSV.'
        : `${n.toLocaleString('pt-BR')} membros com número oculto ficam fora do vCard. Para incluí-los, exporte em CSV.`,
    cancel: 'Cancelar',
    download: 'Baixar arquivo',
    downloading: 'Gerando o arquivo',
    done: (name: string) => `Arquivo ${name} baixado.`,
    forbidden: 'Você não tem permissão para exportar. Peça ao administrador da conta.',
    empty: 'Nenhum contato nos grupos e filtros escolhidos. Ajuste as opções e tente de novo.',
    noPermission: 'Só o administrador ou quem ele liberar pode exportar.',
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
  /** `PLAN_LIMIT_REACHED` com limite 0: o plano não inclui o recurso. */
  limitNotIncluded: (what: string) => `Seu plano não inclui ${what}.`,
  limitReached: (what: string, limit: number) => `Você chegou ao limite de ${limit.toLocaleString('pt-BR')} ${what} do seu plano.`,
};
