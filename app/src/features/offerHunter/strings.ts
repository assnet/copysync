/**
 * Textos do Caçador de Ofertas, centralizados até o painel ter uma lib de i18n (mesmo padrão de
 * `features/offerStory/strings.ts`): chaves semânticas, frase com variável é função tipada,
 * sem nome de marca (white label). O marketplace (SHEIN) é citado por ser a fonte das ofertas.
 */
import type {
  HuntCategorySourceStatus, HuntCommissionOperator, HuntRejectionKey, HuntGateKey, HuntPreset, HuntScoreFactorKey, HuntSort,
  OfferHuntDeliveryMode, OfferHuntFindStatus, OfferHuntPauseReason, OfferHuntRunStatus, OfferHuntRunTrigger,
  OfferHuntStatus,
} from './types';
import { formatDecimal, formatInteger, formatRating } from './format';

/** Espelho de `OFFER_HUNTER_RISK_NOTICE_VERSION.SHEIN` (api/.../marketplaceRiskNotice.ts). Mudou o texto → sobe nos dois. */
export const OFFER_HUNTER_RISK_NOTICE_VERSION = '2026-11-12';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const offerHunterStrings = {
  page: {
    title: 'Caçador de Ofertas',
    subtitle: 'Busca as melhores ofertas da SHEIN no seu horário, escolhe as que mais valem a pena e manda para o seu grupo.',
    menuLabel: 'Caçador de Ofertas',
    previewBadge: 'Prévia',
    loading: 'Carregando o caçador…',
    loadError: 'Não conseguimos carregar o caçador.',
    retry: 'Tentar de novo',
    back: 'Voltar às caçadas',
    detailTitle: 'Detalhes da caçada',
  },

  usage: {
    title: 'Uso de hoje',
    /** "3 de 10 ofertas garimpadas hoje". */
    finds: (used: number, limit: number) => `${used} de ${limit} ${plural(limit, 'oferta garimpada', 'ofertas garimpadas')} hoje`,
    remaining: (n: number) => (n === 0 ? 'Limite de hoje atingido' : `${n} ${plural(n, 'restante', 'restantes')}`),
    runs: (used: number, max: number) => `${used} de ${max} ${plural(max, 'busca', 'buscas')} hoje`,
    resetHint: 'O contador zera à meia-noite.',
    tooltip: 'Ofertas escolhidas pelo caçador hoje, somando todas as caçadas. O limite vem do seu plano.',
    ariaLabel: (used: number, limit: number) => `${used} de ${limit} ofertas garimpadas hoje`,
    loadError: 'Não conseguimos carregar o uso de hoje.',
  },

  destination: {
    title: 'Grupo de destino',
    subtitle: 'Todas as caçadas enviam para este grupo.',
    empty: 'Nenhum grupo escolhido',
    emptyHint: 'Escolha o grupo que vai receber as ofertas antes de ligar uma caçada.',
    invalid: 'O grupo escolhido não está mais disponível. Escolha outro.',
    session: 'Sessão',
    group: 'Grupo',
    choose: 'Escolher grupo',
    change: 'Trocar grupo',
    save: 'Salvar destino',
    saving: 'Salvando…',
    saved: 'Grupo de destino salvo.',
    unnamedGroup: 'Grupo sem nome',
    unnamedSession: 'Sessão sem nome',
    /** Texto neutro quando o nome está borrado pela privacidade. */
    hiddenName: 'Nome oculto',
  },

  list: {
    title: 'Suas caçadas',
    count: (n: number, max: number) => `${n} de ${max} ${plural(max, 'caçada', 'caçadas')}`,
    create: 'Nova caçada',
    createTooltip: 'Monta uma caçada em 3 passos',
    limitTooltip: (max: number) => `Você já tem ${max} ${plural(max, 'caçada', 'caçadas')}, o máximo. Exclua uma para criar outra.`,
    emptyTitle: 'Nenhuma caçada ainda',
    emptyHint: 'Crie uma caçada para receber ofertas escolhidas a dedo, sem precisar procurar.',
    nextRun: 'Próxima busca',
    nextRunIn: (relative: string) => `Próxima busca ${relative}`,
    nextRunNone: 'Sem próxima busca',
    lastRun: 'Última busca',
    lastRunNever: 'Ainda não buscou',
    every: (label: string) => `A cada ${label}`,
    pauseSwitch: 'Caçada ligada',
    pauseTooltip: 'Desligue para pausar as buscas desta caçada',
    resumeTooltip: 'Ligue para retomar as buscas desta caçada',
    open: 'Ver detalhes',
    edit: 'Editar',
    remove: 'Excluir',
    removeTitle: 'Excluir caçada?',
    removeText: (name: string) => `"${name}" deixa de buscar ofertas. O histórico de execuções e achados continua disponível.`,
    removeConfirm: 'Excluir',
    removeCancel: 'Cancelar',
    removed: 'Caçada excluída.',
    failures: (n: number) => `${n} ${plural(n, 'falha seguida', 'falhas seguidas')}`,
  },

  status: {
    ACTIVE: 'Ativa',
    PAUSED: 'Pausada',
  } satisfies Record<OfferHuntStatus, string>,

  /** Motivo da pausa. `USER` é manual; os demais o sistema aplicou sozinho (alerta na tela). */
  pauseReasons: {
    USER: 'Pausada por você.',
    SOURCE_UNAVAILABLE: 'Pausada porque a SHEIN não respondeu várias vezes seguidas. Retome quando quiser tentar de novo.',
    CREDENTIAL_REJECTED: 'Pausada porque a sua conta de afiliado da SHEIN saiu da sessão. Entre de novo pela extensão e retome.',
    RISK_NOT_ACCEPTED: 'Pausada porque o aviso de risco do caçador não está aceito. Um administrador precisa aceitá-lo.',
    PLAN_UNAVAILABLE: 'Pausada porque o caçador não está mais no seu plano.',
  } satisfies Record<OfferHuntPauseReason, string>,
  autoPausedTitle: 'Caçada pausada automaticamente',
  resume: 'Retomar',
  pause: 'Pausar',

  wizard: {
    createTitle: 'Nova caçada',
    editTitle: 'Editar caçada',
    steps: ['O que caçar', 'Refino', 'Quando e onde'],
    stepsLabel: 'Etapas da caçada',
    stepDone: 'concluído',
    next: 'Continuar',
    back: 'Voltar',
    save: 'Salvar caçada',
    saving: 'Salvando…',
    saved: 'Caçada salva.',
    cancel: 'Cancelar',
    discardTitle: 'Descartar rascunho?',
    discardText: 'As escolhas desta caçada ainda não foram salvas.',
    discardConfirm: 'Descartar',

    what: {
      title: 'O que caçar',
      subtitle: 'Comece por uma predefinição e ajuste se quiser.',
      name: 'Nome da caçada',
      namePlaceholder: 'Ex.: Moda feminina com comissão alta',
      nameHelp: (max: number) => `Até ${max} caracteres. Só você vê.`,
      preset: 'Predefinição',
      category: 'Categoria',
      categoryAll: 'Todas as categorias',
      categoryLoading: 'Carregando categorias…',
      sort: 'Ordem da busca',
      sortHint: 'É uma preferência: a pontuação decide quais ofertas são escolhidas.',
      keyword: 'Palavra-chave',
      keywordPlaceholder: 'Ex.: vestido',
      keywordHelp: 'Opcional. Só ofertas com esta palavra no título.',
    },

    refine: {
      title: 'Refino',
      subtitle: 'Filtre as ofertas e escolha quantas entram por busca.',
      price: 'Faixa de preço',
      priceAny: 'Qualquer preço',
      minDiscount: 'Desconto mínimo',
      minCommissionPct: 'Comissão mínima (%)',
      commission: 'Comissão de 1ª compra',
      commissionCondition: 'Condição da comissão de 1ª compra',
      commissionAny: 'Qualquer comissão',
      commissionOperators: {
        GT: { label: 'Maior que', symbol: '>' },
        GTE: { label: 'Igual ou maior que', symbol: '≥' },
        LT: { label: 'Menor que', symbol: '<' },
      } satisfies Record<HuntCommissionOperator, { label: string; symbol: string }>,
      commissionPercent: 'Percentual da comissão de 1ª compra',
      commissionShortcuts: 'Atalhos de percentual',
      commissionShortcutAria: (n: number) => `Usar ${n}%`,
      commissionAnyHint: 'Escolha uma condição para filtrar pelo percentual.',
      minCommissionValue: 'Comissão mínima (R$)',
      minRating: 'Nota mínima',
      minSales: 'Vendas mínimas',
      minReviews: 'Avaliações mínimas',
      onlyWithExtra: 'Só com comissão extra',
      onlyWithExtraHint: 'Ofertas com bônus de comissão em campanha.',
      endsWithin: 'Termina em até',
      endsWithinDays: (n: number) => `${n} ${plural(n, 'dia', 'dias')}`,
      noFilter: 'Sem filtro',
      ai: 'Escolha com IA',
      aiHint: 'A IA confere as melhores pela pontuação e escolhe as que mais combinam com o grupo. Sem IA, vale só a pontuação.',
      aiUnavailable: 'IA indisponível na sua conta. A escolha usa só a pontuação.',
      topN: 'Ofertas por busca',
      topNHelp: (max: number) => `De 1 a ${max} ofertas escolhidas a cada busca.`,
      repeatAfter: 'Repetir a mesma oferta depois de',
      repeatAfterDays: (n: number) => `${n} ${plural(n, 'dia', 'dias')}`,
    },

    when: {
      title: 'Quando e onde',
      subtitle: 'Defina a frequência, os dias e como as ofertas chegam ao grupo.',
      interval: 'Buscar a cada',
      days: 'Dias da semana',
      window: 'Horário',
      windowAllDay: 'O dia todo',
      deliveryMode: 'Entrega',
      destination: 'Grupo de destino',
      destinationMissing: 'Escolha o grupo de destino na tela do caçador antes de salvar.',
    },

    test: {
      action: 'Testar agora',
      tooltip: 'Faz uma busca agora e mostra o ranking com a pontuação de cada oferta',
      running: 'Buscando ofertas…',
      title: 'Resultado do teste',
      summary: (seen: number, matched: number, chosen: number) =>
        `${seen} ${plural(seen, 'oferta vista', 'ofertas vistas')}, ${matched} no filtro, ${chosen} ${plural(chosen, 'escolhida', 'escolhidas')}`,
      sent: (n: number) => `${n} ${plural(n, 'enviada', 'enviadas')} ao grupo`,
      remainingToday: (n: number) => `${n} ${plural(n, 'oferta restante', 'ofertas restantes')} hoje`,
      empty: 'Nenhuma oferta passou nos filtros. Afrouxe o refino e teste de novo.',
      chosen: 'Escolhida',
      notChosen: 'Fora do corte',
      aiUsed: 'Escolha feita com IA',
      aiFallback: 'A IA não respondeu; a escolha usou só a pontuação.',
      score: (score: number) => `${formatDecimal(score)} pontos`,
      factorsTitle: 'Como a pontuação foi montada',
      aiReason: 'Motivo da IA',
      savedOnly: 'O teste usa a versão salva da caçada. Salve as mudanças antes para testar com elas.',
      spendsQuota: 'É uma busca de verdade: as ofertas escolhidas contam no limite de hoje e, em "Enviar direto", vão ao grupo.',
      failed: 'O teste não terminou.',
    },

    /** Explicação curta dos campos (Tooltip do ícone de ajuda). */
    tips: {
      name: 'Um nome para você reconhecer a caçada na lista.',
      preset: 'Um ponto de partida: preenche os filtros (como a comissão de 1ª compra). Você pode ajustar depois.',
      category: 'Só ofertas desta categoria da SHEIN. Vazio = todas.',
      keyword: 'Palavra que precisa aparecer no título da oferta.',
      price: 'Ofertas fora da faixa ficam de fora. Nas pontas da barra, sem limite.',
      minDiscount: 'Desconto mínimo sobre o preço cheio.',
      minCommissionPct: 'Percentual mínimo de comissão por venda.',
      commission: 'Percentual de comissão de 1ª compra (cliente novo na SHEIN). A condição decide se vale maior, igual ou menor. "Qualquer comissão" não filtra.',
      minCommissionValue: 'Valor mínimo que você ganha na 1ª compra do cliente.',
      minRating: 'Nota média mínima, de 0 a 5.',
      minSales: 'A SHEIN informa vendas por faixa (ex.: 100+).',
      minReviews: 'Quantidade mínima de avaliações.',
      endsWithin: 'Só ofertas que terminam em até tantos dias.',
      topN: 'Quantas ofertas, no máximo, cada busca escolhe.',
      repeatAfter: 'A mesma oferta só volta a ser escolhida depois deste prazo.',
      interval: 'De quanto em quanto tempo o caçador busca, dentro do horário e dos dias marcados.',
      deliveryMode: 'Como as ofertas escolhidas chegam ao grupo de destino.',
      window: 'Dias e faixa do dia em que o caçador pode buscar. Fora dela, a busca espera.',
      helpAria: (field: string) => `Ajuda: ${field}`,
    },

    /** Validação por passo (antes de avançar/salvar). */
    validation: {
      nameRequired: 'Dê um nome à caçada.',
      tooLong: (max: number) => `Use até ${max} caracteres.`,
      range: (min: number, max: number) => `Use um valor de ${min} a ${max}.`,
      required: 'Preencha este campo.',
      window: 'Escolha um horário com pelo menos 15 minutos e um dia da semana.',
      stepHasErrors: 'Confira os campos destacados para continuar.',
    },
    percentUnit: '%',
    currencyUnit: 'R$',
    ratingUnit: 'de 5',
    daysUnit: 'dias',
    priceMaxOpen: (label: string) => `${label}+`,
    sortHintLabel: (sort: string) => `Ordem sugerida à SHEIN: ${sort}`,
    intervalHelp: (min: string) => `O menor intervalo é ${min}.`,
    presetsLabel: 'Predefinições',
    presetSelected: 'Selecionada',
    categorySaved: 'Categoria salva',
    close: 'Fechar',
  },

  /** Ranking de uma busca (Testar agora / Rodar agora). */
  ranking: {
    listLabel: 'Ranking das ofertas',
    position: (n: number) => `${n}º`,
    noTitle: 'Oferta sem título',
    noImage: 'Sem foto',
    scoreAria: (score: number) => `Pontuação ${formatDecimal(score)} de 100`,
    factorsAria: 'Ver como a pontuação foi montada',
  },

  /** Predefinições (`HUNT_PRESETS`). */
  presets: {
    TOP_COMMISSION: { label: 'Maior comissão', hint: 'Comissão de 1ª compra a partir de 15%.' },
    BEST_SELLERS: { label: 'Mais vendidos', hint: 'Pelo menos 100 vendas e nota 4 ou mais.' },
    BIGGEST_DISCOUNT: { label: 'Maior desconto', hint: 'Desconto a partir de 40%.' },
    NEW_ARRIVALS: { label: 'Novidades', hint: 'Os lançamentos mais recentes.' },
    CUSTOM: { label: 'Personalizada', hint: 'Você escolhe todos os filtros.' },
  } satisfies Record<HuntPreset, { label: string; hint: string }>,

  sorts: {
    RECOMMENDED: 'Recomendados',
    TOP_RATED: 'Mais bem avaliados',
    NEWEST: 'Mais recentes',
    PRICE_ASC: 'Menor preço',
    PRICE_DESC: 'Maior preço',
    BEST_SELLING: 'Mais vendidos',
  } satisfies Record<HuntSort, string>,

  deliveryModes: {
    REVIEW: { label: 'Revisar antes', hint: 'As ofertas esperam a sua aprovação para ir ao grupo.' },
    AUTO: { label: 'Enviar direto', hint: 'As ofertas escolhidas vão para o grupo sem revisão.' },
  } satisfies Record<OfferHuntDeliveryMode, { label: string; hint: string }>,

  /** Fatores da pontuação (0–100): rótulo + explicação curta para Tooltip. */
  factors: {
    commission: { label: 'Comissão', hint: 'Quanto você ganha por venda, em percentual e em valor.' },
    sales: { label: 'Vendas', hint: 'Quantas vezes o produto já foi vendido.' },
    rating: { label: 'Nota', hint: 'Média das avaliações dos compradores.' },
    reviews: { label: 'Avaliações', hint: 'Quantidade de avaliações: mais avaliações, nota mais confiável.' },
    rank: { label: 'Destaque', hint: 'Posição do produto nos destaques da SHEIN.' },
    discount: { label: 'Desconto', hint: 'Diferença entre o preço cheio e o preço atual.' },
    priceBand: { label: 'Faixa de preço', hint: 'Preços na faixa que mais converte ganham pontos.' },
    extraCommission: { label: 'Comissão extra', hint: 'Bônus de comissão em campanha.' },
    endingSoon: { label: 'Acaba logo', hint: 'Oferta perto do fim: urgência para quem compra.' },
  } satisfies Record<HuntScoreFactorKey, { label: string; hint: string }>,
  factorPoints: (points: number, max: number) => `${formatDecimal(points)} de ${max}`,

  finds: {
    title: 'Achados',
    emptyTitle: 'Nenhum achado ainda',
    emptyHint: 'As ofertas escolhidas pelas buscas aparecem aqui.',
    pendingTitle: (n: number) => `${n} ${plural(n, 'achado nesta lista espera', 'achados nesta lista esperam')} a sua revisão`,
    approve: 'Aprovar e enviar',
    approveTooltip: 'Envia esta oferta ao grupo de destino com o seu link de afiliado',
    approved: 'Oferta enviada para a fila do grupo.',
    dismiss: 'Dispensar',
    dismissTooltip: 'Descarta esta oferta sem enviar',
    dismissed: 'Achado dispensado.',
    loadMore: 'Carregar mais',
    price: 'Preço',
    originalPrice: 'De',
    discount: (pct: number) => `${Math.round(pct)}% off`,
    commission: 'Comissão',
    returningCommission: 'Comissão de recompra',
    extraCommission: 'Comissão extra',
    rating: 'Nota',
    sales: (bucket: number) => `${bucket}+ vendas`,
    reviews: (bucket: number) => `${bucket}+ avaliações`,
    score: 'Pontuação',
    aiReason: 'Motivo da IA',
    failure: 'Motivo da falha',
    /** Envio real (status do disparo da oferta). */
    dispatch: {
      queued: 'Na fila de envio',
      sent: 'Enviado',
      sentAt: (when: string) => `Enviado em ${when}`,
      failed: 'Falhou ao enviar',
      notSent: 'Não enviado',
    },
    destinationGroup: 'Grupo',
    destinationSession: 'Sessão',
    resend: 'Reenviar',
    resendTooltip: 'Envia de novo ao grupo de destino atual, com link e preço atualizados. Não conta no limite do dia.',
    resendPendingTooltip: 'Aguarde: o envio anterior desta oferta ainda está na fila.',
    resendTitle: 'Reenviar esta oferta?',
    resendText: (group: string | null) =>
      `A oferta vai de novo para o grupo de destino atual${group ? ` "${group}"` : ''}, com link e preço atualizados. Não conta no limite do dia.`,
    resent: 'Oferta reenviada: está na fila de envio.',
    resendCount: (n: number) => `Reenviada ${n} ${plural(n, 'vez', 'vezes')}`,
  },

  findStatus: {
    PENDING_REVIEW: 'Aguardando revisão',
    APPROVED: 'Aprovado',
    DISMISSED: 'Dispensado',
    SENT: 'Enviado',
    FAILED: 'Falhou',
  } satisfies Record<OfferHuntFindStatus, string>,

  runs: {
    title: 'Histórico de buscas',
    emptyTitle: 'Nenhuma busca ainda',
    emptyHint: 'Cada busca, agendada ou feita por você, aparece aqui.',
    loadMore: 'Carregar mais',
    startedAt: 'Início',
    finishedAt: 'Fim',
    counts: (seen: number, matched: number, chosen: number, sent: number) =>
      `${seen} vistas · ${matched} no filtro · ${chosen} ${plural(chosen, 'escolhida', 'escolhidas')} · ${sent} ${plural(sent, 'enviada', 'enviadas')}`,
    seen: 'Vistas',
    matched: 'No filtro',
    chosen: 'Escolhidas',
    sent: 'Enviadas',
    aiUsed: 'Com IA',
    aiFallback: 'IA indisponível, só pontuação',
    error: 'Motivo',
    showRanking: 'Ver ranking',
    hideRanking: 'Ocultar ranking',
    rankingMissing: 'Ranking não guardado nesta execução.',
  },

  runStatus: {
    RUNNING: 'Em andamento',
    SUCCEEDED: 'Concluída',
    FAILED: 'Falhou',
    SKIPPED: 'Não executada',
  } satisfies Record<OfferHuntRunStatus, string>,

  runTrigger: {
    MANUAL: 'Manual',
    SCHEDULED: 'Agendada',
  } satisfies Record<OfferHuntRunTrigger, string>,

  /** Detalhe de uma caçada (T15). */
  detail: {
    loadError: 'Não conseguimos carregar esta caçada.',
    runNow: 'Rodar agora',
    runNowTooltip: 'Faz uma busca agora com esta caçada. As ofertas escolhidas contam no limite de hoje.',
    running: 'Buscando…',
    edit: 'Editar',
    editTooltip: 'Muda filtros, horário e entrega desta caçada',
    activeSwitch: 'Caçada ligada',
    gatedTooltip: (reason: string) => `Indisponível: ${reason}`,
    resultTitle: 'Resultado da busca',
    closeResult: 'Fechar resultado',
    tabsLabel: 'Seções da caçada',
    tabFinds: 'Achados',
    tabRuns: 'Execuções',
    updatedActive: 'Caçada ligada.',
    updatedPaused: 'Caçada pausada.',
    approveTitle: 'Enviar esta oferta?',
    approveText: 'A oferta entra na fila do grupo de destino com o seu link de afiliado.',
    dismissTitle: 'Dispensar esta oferta?',
    dismissText: 'O achado sai da revisão e não é enviado.',
    resend: 'Reenviar',
    resendTooltip: 'Tenta enviar esta oferta ao grupo de novo',
    resendTitle: 'Reenviar esta oferta?',
    confirmCancel: 'Voltar',
    showDetails: 'Ver detalhes',
    hideDetails: 'Ocultar detalhes',
    newCommission: 'Comissão (1ª compra)',
    noValue: '—',
    loadMoreError: 'Não conseguimos carregar mais itens.',
    listError: 'Não conseguimos carregar a lista.',
    runsListLabel: 'Execuções da caçada',
    findsListLabel: 'Achados da caçada',
    duration: 'Duração',
    stillRunning: 'Em andamento',
    unknownError: (code: string) => `Código ${code}`,
  },

  /** Por que "0 no filtro": recusas por filtro gravadas em cada execução (`rejectedBy`). */
  rejections: {
    keys: {
      minPriceCents: 'preço mínimo',
      maxPriceCents: 'preço máximo',
      minDiscountPct: 'desconto',
      minCommissionPct: 'comissão de 1ª compra',
      minCommissionCents: 'comissão de 1ª compra em R$',
      minRating: 'nota',
      minSales: 'vendas',
      minReviews: 'avaliações',
      onlyWithExtra: 'sem comissão extra',
      endsWithinDays: 'prazo da campanha',
      repeated: 'repetição',
    } satisfies Record<HuntRejectionKey, string>,
    item: (n: number, label: string) => `${n} por ${label}`,
    line: (matched: number, parts: string[]) => `${matched} no filtro: ${parts.join(', ')}`,
    hint: 'Afrouxe o filtro que mais barrou em Editar → Refino.',
    tooltip: 'Uma oferta pode ser barrada por mais de um filtro, então a soma pode passar do total visto.',
  },

  /** Estados travados (`options.gates`), na ordem em que a tela deve cobrar. */
  gates: {
    plan: {
      title: 'Disponível no plano MAX',
      /** Mesma etapa já concluída (lista do painel). */
      doneTitle: 'Plano MAX ativo',
      text: 'O caçador busca e envia ofertas sozinho. Faça upgrade para usar.',
      action: 'Ver planos',
    },
    hunterEntitlement: {
      title: 'Caçador não liberado',
      /** Mesma etapa já concluída (lista do painel). */
      doneTitle: 'Caçador liberado na conta',
      text: 'O caçador ainda não está liberado na sua conta.',
      action: 'Ver planos',
    },
    credential: {
      title: 'Conecte a sua conta de afiliado da SHEIN',
      /** Mesma etapa já concluída (lista do painel). */
      doneTitle: 'Conta de afiliado da SHEIN conectada',
      text: 'Entre na SHEIN pela extensão do navegador para o caçador gerar links com a sua conta.',
      action: 'Abrir credenciais',
    },
    riskAccepted: {
      title: 'Aceite o aviso de risco do caçador',
      /** Mesma etapa já concluída (lista do painel). */
      doneTitle: 'Aviso de risco aceito',
      text: 'Antes de ligar o caçador, um administrador da conta precisa ler e aceitar o aviso.',
      action: 'Ler aviso',
    },
    aiAvailable: {
      title: 'IA indisponível',
      /** Mesma etapa já concluída (lista do painel). */
      doneTitle: 'IA disponível',
      text: 'Sem IA, o caçador escolhe as ofertas só pela pontuação.',
      action: 'Configurar IA',
    },
    destination: {
      title: 'Escolha o grupo de destino',
      /** Mesma etapa já concluída (lista do painel). */
      doneTitle: 'Grupo de destino escolhido',
      text: 'O caçador precisa de um grupo para enviar as ofertas.',
      action: 'Escolher grupo',
    },
  } satisfies Record<HuntGateKey, { title: string; doneTitle: string; text: string; action: string }>,

  /** `options.sourceStatus`: estado das categorias vindas da SHEIN. */
  sourceStatus: {
    OK: '',
    LOCKED: 'As categorias aparecem depois de liberar o caçador.',
    NO_CREDENTIAL: 'Conecte a sua conta da SHEIN para carregar as categorias.',
    CREDENTIAL_REJECTED: 'A sua conta da SHEIN saiu da sessão. Entre de novo pela extensão.',
    UNAVAILABLE: 'A SHEIN não respondeu agora. Você pode salvar sem categoria e tentar de novo depois.',
  } satisfies Record<HuntCategorySourceStatus, string>,

  /** Erros por código da API (`err.code` do `apiClient`). */
  errors: {
    generic: 'Algo deu errado. Tente de novo.',
    OFFER_HUNT_DAILY_LIMIT: 'Você atingiu o limite de ofertas garimpadas hoje. O contador zera à meia-noite.',
    OFFER_HUNT_RUN_THROTTLED: 'Muitas buscas hoje. Tente de novo amanhã.',
    OFFER_HUNT_LIMIT_REACHED: 'Você já tem o máximo de caçadas. Exclua uma para criar outra.',
    OFFER_HUNT_DESTINATION_REQUIRED: 'Escolha o grupo de destino antes de continuar.',
    OFFER_HUNT_SOURCE_UNAVAILABLE: 'A SHEIN não respondeu agora. Tente de novo em alguns minutos.',
    OFFER_HUNT_NOT_FOUND: 'Essa caçada não existe mais.',
    OFFER_HUNT_FIND_INVALID_STATE: 'Esse achado já foi revisado.',
    OFFER_HUNT_CURSOR_INVALID: 'A lista mudou. Recarregamos do início.',
    OFFER_HUNT_PAUSED: 'A caçada está pausada.',
    OFFER_HUNT_RESEND_PENDING: 'O envio anterior desta oferta ainda está na fila. Tente de novo depois que ele sair.',
    OFFER_HUNT_RESEND_NOT_DELIVERED: 'Esta oferta ainda não foi enviada. Use "Aprovar e enviar".',
    OFFER_HUNTER_UNAVAILABLE: 'O caçador não está disponível para a sua conta.',
    PLAN_FEATURE_UNAVAILABLE: 'O caçador não está liberado no seu plano.',
    MARKETPLACE_RISK_NOT_ACCEPTED: 'Aceite o aviso de risco do caçador para continuar.',
    MARKETPLACE_RISK_NOTICE_OUTDATED: 'O aviso de risco foi atualizado. Recarregue a página para ler a versão atual.',
    AFFILIATE_CREDENTIAL_REJECTED: 'A sua conta da SHEIN saiu da sessão. Entre de novo pela extensão.',
    AFFILIATE_CREDENTIAL_REQUIRED: 'Conecte a sua conta de afiliado da SHEIN.',
    SESSION_NOT_CONNECTED: 'A sessão do grupo de destino está desconectada.',
    OFFER_INVALID_INPUT: 'Confira os campos destacados.',
    VALIDATION_ERROR: 'Confira os campos destacados.',
    RATE_LIMITED: 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.',
    FORBIDDEN: 'Você não tem permissão para fazer isso.',
  } as Record<string, string>,

  /** Aviso de risco próprio do caçador (escopo `OFFER_HUNTER`). Texto travado por hash em `strings.test.ts`. */
  riskNotice: {
    version: OFFER_HUNTER_RISK_NOTICE_VERSION,
    /** Idioma em que o texto é exibido (gravado com o aceite). */
    locale: 'pt-BR',
    scope: 'OFFER_HUNTER' as const,
    bannerTitle: 'Automação por sua conta e risco',
    bannerSummary:
      'O caçador busca, gera links e envia ofertas da SHEIN de forma automática. Os termos da SHEIN proíbem isso '
      + 'e ela pode encerrar a sua conta e reter comissões.',
    readFull: 'Ler aviso completo',
    readFullTooltip: 'Abre o texto completo do aviso de risco do caçador',
    dialogTitle: 'Aviso de risco: Caçador de Ofertas na SHEIN',
    /** Texto completo. Travado por hash junto da `version`. */
    paragraphs: [
      'O Caçador de Ofertas faz, de forma automática e recorrente, buscas no catálogo do Programa de Afiliados da SHEIN, '
        + 'nos dias e horários que você definir.',
      'Para cada oferta escolhida, o link de afiliado é gerado automaticamente pela sessão da sua conta de afiliado da SHEIN, '
        + 'e a oferta pode ser enviada automaticamente ao grupo de destino, sem revisão, quando o modo de entrega for "Enviar direto".',
      'Os termos da SHEIN proíbem esse tipo de uso. A cláusula 3.3.2 dos Termos do Programa de Afiliados proíbe o uso de '
        + '"sistema, bot ou outro dispositivo ou artifício". O Anexo 3, item 6, proíbe o uso de "robôs ou outras ferramentas '
        + 'de consulta automatizadas" e o acesso por "meio automatizado ou scraping".',
      'Por causa desse uso, a SHEIN pode encerrar a sua conta de afiliado e reter as suas comissões, inclusive as já geradas.',
      'O uso do caçador é por sua conta e risco, como titular da conta de afiliado.',
      'A plataforma não se responsabiliza por bloqueio, suspensão ou encerramento da conta, nem por perda de comissões.',
    ] as readonly string[],
    checkbox: 'Li o aviso e assumo o risco do uso automatizado',
    confirm: 'Aceitar e continuar',
    confirming: 'Registrando aceite…',
    cancel: 'Cancelar',
    close: 'Fechar',
    accepted: 'Aviso de risco aceito.',
    acceptedAt: (date: string, byMe: boolean) => `Aceito em ${date}${byMe ? ' por você' : ''}`,
    adminOnly: 'Só um administrador desta conta pode aceitar o aviso.',
    staleTitle: 'O aviso foi atualizado',
    staleText: 'O texto do aviso foi atualizado. Recarregue a página para ler a versão atual antes de aceitar.',
    reloadPage: 'Recarregar página',
    reloadPageTooltip: 'Recarrega o painel com o texto atual do aviso',
    acceptFailed: 'Não foi possível registrar o aceite. Tente de novo.',
  },

  /** Tela inicial (T13): textos que não cabem em `list`/`destination`/`usage`. */
  home: {
    loadError: 'Não conseguimos carregar as suas caçadas.',
    listLabel: 'Lista de caçadas',
    emptyCta: 'Criar a primeira caçada',
    emptySteps: [
      'Você escolhe o que caçar: categoria, comissão de 1ª compra, preço e desconto.',
      'No horário definido, o caçador busca e dá uma pontuação a cada oferta.',
      'As melhores vão para o grupo de destino, com o seu link de afiliado.',
    ] as readonly string[],
    emptyStepsLabel: 'Como funciona',
    createBlocked: (reason: string) => `Indisponível: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`,
    actionsLabel: (name: string) => `Ações da caçada ${name}`,
    moreActions: 'Mais ações',
    modeLabel: 'Entrega',
    aiOn: 'Com IA',
    aiOff: 'Sem IA',
    aiOnTooltip: 'A IA ajuda a escolher as ofertas desta caçada',
    aiOffTooltip: 'Esta caçada escolhe só pela pontuação',
    noFilters: 'Sem filtros extras',
    categoryUnknown: 'Categoria escolhida',
    priceRange: (min: string | null, max: string | null) =>
      (min && max ? `${min} a ${max}` : min ? `A partir de ${min}` : `Até ${max ?? ''}`),
    keyword: (k: string) => `"${k}"`,
    filtersLabel: 'Filtros da caçada',
    /** Chips do resumo (cartão e cabeçalho do detalhe): curtos, explicação no Tooltip. */
    chips: {
      discount: (n: number) => `Desconto ≥ ${n}%`,
      commission: (symbol: string, n: number) => `Comissão 1ª compra ${symbol} ${formatDecimal(n)}%`,
      commissionTip: (label: string, n: number) => `Comissão de 1ª compra ${label.toLowerCase()} ${formatDecimal(n)}%.`,
      commissionValue: (brl: string) => `Comissão 1ª compra ≥ ${brl}`,
      rating: (n: number) => `Nota ≥ ${formatRating(n)}`,
      sales: (n: number) => `Vendas ≥ ${formatInteger(n)}`,
      reviews: (n: number) => `Avaliações ≥ ${formatInteger(n)}`,
      onlyWithExtra: 'Só com extra',
      endsWithin: (n: number) => `Termina em até ${n} ${plural(n, 'dia', 'dias')}`,
    },
    nextRunOverdue: 'Próxima busca em instantes',
    /** `diffMs` = horário − agora no servidor (negativo = passado): "em 25 minutos", "há 2 horas". */
    relative: (diffMs: number) => {
      const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
      const s = Math.round(diffMs / 1000);
      if (Math.abs(s) < 60) return diffMs >= 0 ? 'em instantes' : 'agora mesmo';
      const m = Math.round(s / 60);
      if (Math.abs(m) < 60) return rtf.format(m, 'minute');
      const h = Math.round(m / 60);
      if (Math.abs(h) < 24) return rtf.format(h, 'hour');
      return rtf.format(Math.round(h / 24), 'day');
    },
    lastRunAt: (relative: string) => `Última busca ${relative}`,
    filterLabel: 'Mostrar caçadas',
    filters: { ALL: 'Todas', ACTIVE: 'Ativas', PAUSED: 'Pausadas' },
    filterEmpty: 'Nenhuma caçada neste filtro.',
    toggleFailed: 'Não foi possível mudar a caçada. Tente de novo.',
    updatedActive: 'Caçada ligada.',
    updatedPaused: 'Caçada pausada.',
    gatedSwitch: 'Resolva o que falta acima para ligar a caçada',
    destinationPicker: {
      title: 'Escolher grupo de destino',
      subtitle: 'As ofertas de todas as caçadas vão para este grupo, enviadas pela sessão escolhida.',
      session: 'Sessão',
      sessionsLoading: 'Carregando sessões…',
      sessionsFailed: 'Não conseguimos carregar as sessões.',
      noSessions: 'Nenhuma sessão conectada. Conecte uma sessão para escolher o grupo.',
      disconnected: 'Desconectada',
      search: 'Buscar grupo',
      searchPlaceholder: 'Nome do grupo',
      groupsLoading: 'Carregando grupos…',
      groupsFailed: 'Não conseguimos carregar os grupos desta sessão.',
      groupsEmpty: 'Nenhum grupo encontrado nesta sessão.',
      partial: 'O WhatsApp não respondeu: mostramos só os grupos que o chat já conhece.',
      noConversation: 'Grupo ainda sem conversa no chat',
      adminsOnly: 'Só admins podem enviar',
      readOnly: 'Canal só de leitura',
      selected: 'Selecionado',
      retry: 'Tentar de novo',
      cancel: 'Cancelar',
      close: 'Fechar',
    },
  },

  /** Painel de portões (T16): o que falta para ligar o caçador. */
  gatesPanel: {
    title: 'O que falta para ligar o caçador',
    progress: (done: number, total: number) => `${done} de ${total} ${plural(total, 'etapa concluída', 'etapas concluídas')}`,
    pending: 'Pendente',
    done: 'Pronto',
    askAdmin: 'Peça a um administrador da conta para aceitar o aviso.',
    superAdminAccepts: 'Você está aceitando como super admin, em nome desta conta. O aceite fica registrado com o seu usuário e vale para toda a conta.',
    staleReloaded: 'O aviso foi atualizado. Recarregamos as opções: recarregue a página para ler o texto novo.',
    aiInfo: 'Aviso informativo: não impede ligar as caçadas.',
  },

  /** Dias da semana (bit 0 = domingo), para `weekdaysMask`. */
  weekdays: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as readonly string[],
  weekdaysFull: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as readonly string[],
  /** "30 min", "1 h", "1 h 30 min". */
  interval: (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} min`;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  },
} as const;

export type OfferHunterStrings = typeof offerHunterStrings;

/** Mensagem para o erro rejeitado pelo `apiClient` (código desconhecido → genérico). */
export function offerHunterErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return (typeof code === 'string' && offerHunterStrings.errors[code]) || offerHunterStrings.errors.generic;
}
