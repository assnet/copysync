/**
 * Textos do gerador de ofertas, centralizados até o painel ter uma lib de i18n — mesmas regras de
 * `features/settings/strings.ts`:
 * - chaves semânticas, nunca o texto como chave
 * - frase com variável é função tipada; componente nunca concatena pedaços
 * - sem nome de marca do produto (usar "a ferramenta")
 */
import type { OfferAudience, OfferDispatchStatus } from '@/types/api.types';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const groupsLabel = (n: number) => `${n} ${plural(n, 'grupo', 'grupos')}`;

export const offerStrings = {
  page: {
    title: 'Gerador de ofertas',
    subtitle: 'Cole seu link de afiliado, escolha o público e dispare nos seus grupos',
    loadError: 'Não foi possível carregar a configuração do gerador.',
    retry: 'Tentar novamente',
    newOfferShort: 'Novo',
    newOfferTooltip: 'Gerar outra oferta. Esta continua salva como rascunho.',
    newOfferLocked: 'Aguarde o envio desta oferta terminar (ou pare o envio) para gerar outra.',
  },

  schedule: {
    title: 'Agendar início',
    description: 'Escolha quando o primeiro grupo recebe a oferta. Os demais seguem o intervalo da configuração.',
    label: 'Data e hora do início',
    helper: (days: number) => `Até ${days} dias à frente, no horário do seu dispositivo.`,
    required: 'Escolha a data e a hora do início.',
    past: 'Esse horário já passou. Escolha um horário futuro.',
    tooFar: (days: number) => `Escolha um horário em até ${days} dias.`,
    invalid: 'Horário de agendamento inválido. Escolha um horário futuro, em até 30 dias.',
    startsAt: (when: string) => `Início agendado: ${when}`,
    expired: 'O horário agendado já passou: o envio começa assim que você disparar.',
  },

  wizard: {
    title: 'Configure seus disparos',
    subtitle: 'Faça isso uma vez. Toda oferta sai pela sessão e pelos grupos escolhidos aqui.',
    steps: ['Sessão', 'Grupos', 'Confirmar'] as const,
    back: 'Voltar',
    next: 'Continuar',
    cancel: 'Cancelar',
    save: 'Salvar configuração',
    saving: 'Salvando…',
    saved: 'Configuração salva. Agora é só gerar sua oferta.',
    session: {
      title: 'Escolha as sessões',
      subtitle: 'Os números de WhatsApp que vão enviar. A ordem em que você marca é a ordem de envio.',
      counter: (n: number, limit: number | null) =>
        limit != null ? `${n} / ${limit}` : `${n} ${plural(n, 'selecionada', 'selecionadas')}`,
      counterAria: (n: number, limit: number | null) =>
        limit != null ? `${n} de ${limit} sessões selecionadas` : `${n} ${plural(n, 'sessão selecionada', 'sessões selecionadas')}`,
      limitTooltip: (limit: number) => `Seu plano permite disparar por até ${limit} ${plural(limit, 'sessão', 'sessões')}. Desmarque uma para escolher outra.`,
      orderBadge: (n: number) => `${n}ª`,
      crossLocked: 'Disparar por mais de um WhatsApp é exclusivo do plano Business. Deixe uma sessão marcada ou faça upgrade.',
      crossLockedLink: 'Ver planos',
      loadError: 'Não foi possível carregar as sessões.',
      emptyTitle: 'Nenhuma sessão conectada',
      emptyDescription: 'Conecte um número de WhatsApp para disparar ofertas nos seus grupos.',
      emptyAction: 'Conectar uma sessão',
      connected: 'Conectada',
      noPhone: 'Número não informado',
    },
    groups: {
      title: 'Selecione os grupos',
      subtitle: 'Todos os grupos de que o WhatsApp de cada sessão participa.',
      filterAll: 'Todas',
      filterAria: 'Filtrar por sessão',
      excludeLabel: 'Excluir',
      excludePlaceholder: 'ex.: workshop, teste',
      excludeHelper: 'Esconde grupos cujo nome contenha estas palavras (separe por vírgula).',
      emptyFiltered: 'Nenhum grupo com estes filtros.',
      viaSession: (name: string) => `via ${name}`,
      partial: 'O WhatsApp da sessão não respondeu: mostrando só os grupos que já têm conversa. Reconecte a sessão para ver todos.',
      ensureError: 'Não foi possível selecionar este grupo. Tente novamente.',
      searchLabel: 'Buscar grupo',
      loadError: 'Não foi possível carregar os grupos.',
      empty: 'Nenhum grupo encontrado nesta sessão.',
      emptySearch: 'Nenhum grupo com esse nome.',
      untitled: 'Grupo sem nome',
      counter: (n: number, limit: number | null) =>
        limit != null ? `${n} / ${limit}` : `${n} ${plural(n, 'selecionado', 'selecionados')}`,
      counterAria: (n: number, limit: number | null) =>
        limit != null ? `${n} de ${limit} grupos selecionados` : `${groupsLabel(n)} selecionados`,
      limitTooltip: (limit: number) =>
        `Seu plano permite até ${groupsLabel(limit)}. Desmarque um para escolher outro.`,
      clear: 'Limpar seleção',
      showAll: (hidden: number) => `Ver todos (+${hidden})`,
      showLess: 'Esconder',
      required: 'Selecione ao menos um grupo.',
    },
    confirm: {
      title: 'Confira e salve',
      subtitle: 'Revise antes de salvar. Dá para mudar depois em "Editar".',
      session: 'Sessão',
      sessions: 'Sessões (ordem de envio)',
      total: 'Total de grupos',
      groups: 'Grupos',
      groupsOf: (session: string, n: number) => `${session}: ${groupsLabel(n)}`,
      interval: 'Intervalo entre envios',
      intervalHelper: 'Uma pausa aleatória entre um envio e outro deixa o disparo mais natural. Vale entre grupos e ao trocar de sessão.',
      order: {
        title: 'Ordem de envio',
        subtitle: 'Com mais de uma sessão, escolha como as ofertas se distribuem.',
        aria: 'Ordem de envio entre sessões',
        sequential: {
          label: 'Uma sessão por vez',
          description: 'Envia para todos os grupos da primeira sessão, depois passa para a próxima.',
        },
        interleaved: {
          label: 'Intercalado',
          description: 'Alterna: um grupo de cada sessão por vez, até acabar.',
        },
        legend: 'Cada bolinha é um envio; a cor é a sessão.',
      },
      min: 'Mínimo',
      max: 'Máximo',
      minutes: (seconds: number) => `${Math.round(seconds / 60)} min`,
      intervalError: (min: number, max: number) => `Use valores entre ${min / 60} e ${max / 60} minutos, com o mínimo menor ou igual ao máximo.`,
      riskAria: 'Nível de risco do intervalo',
      risk: {
        high: 'Alto risco',
        elevated: 'Risco elevado',
        moderate: 'Risco moderado',
        safe: 'Seguro',
      } satisfies Record<import('./utils/offerConfig').IntervalRiskLevel, string>,
      more: (n: number) => `+${n}`,
    },
  },

  summary: {
    label: 'Disparo configurado',
    session: (name: string) => `Sessão: ${name}`,
    sessionMissing: 'Sessão removida',
    sessionsRemoved: (n: number) => `${n} ${plural(n, 'sessão removida', 'sessões removidas')}`,
    andMore: (n: number) => `e mais ${n}`,
    orderSequential: 'uma sessão por vez',
    orderInterleaved: 'intercalado',
    sessionOffline: 'Sessão desconectada',
    sessionOfflineTooltip: 'Reconecte a sessão para conseguir disparar.',
    groups: (n: number) => groupsLabel(n),
    edit: 'Editar',
    editTooltip: 'Mudar sessão, grupos e intervalo',
  },

  form: {
    title: 'Gerar nova oferta',
    linkLabel: 'Cole o SEU link de afiliado',
    linkPlaceholder: 'https://...',
    linkHelper: 'Gere o link na Shopee, Amazon ou Mercado Livre e cole aqui — a ferramenta detecta a loja sozinha.',
    linkRequired: 'Cole o seu link de afiliado.',
    linkInvalid: 'Isso não parece um link. Ele deve começar com https://',
    linkUnknownStore: 'Loja não reconhecida. Use um link da Shopee, Amazon ou Mercado Livre.',
    clear: 'Limpar link',
    detected: (store: string) => `${store} detectado`,
    shopeeNotice: 'Na Shopee a ferramenta não confere o dono do link. Garanta que ele foi gerado na sua conta.',
    couponSwitch: 'Tem cupom',
    couponLabel: 'Código do cupom',
    couponPlaceholder: 'Ex.: PROMO10',
    couponRequired: 'Digite o código do cupom ou desligue a opção.',
    audienceLabel: 'Público-alvo',
    audienceHelper: 'O texto muda conforme quem vai ler. "Padrão" usa o modelo fixo; os demais são escritos pela IA.',
    submit: 'Gerar oferta',
    generating: 'Criando sua oferta…',
    sendingLock: 'Aguarde o envio atual terminar para gerar outra oferta.',
    backToOffer: 'Voltar para a oferta',
  },

  audiences: {
    STANDARD: { label: 'Padrão', subtitle: 'Título + preço + link' },
    MOMS: { label: 'Mães', subtitle: 'Praticidade e carinho' },
    PET: { label: 'Donos de pet', subtitle: 'Amor pelo bichinho' },
    BEAUTY_FASHION: { label: 'Beleza/Moda', subtitle: 'Autoestima e tendência' },
    MEN: { label: 'Homens', subtitle: 'Custo-benefício' },
    FITNESS: { label: 'Fitness', subtitle: 'Resultado e disciplina' },
    HOME_KITCHEN: { label: 'Casa/Cozinha', subtitle: 'Economia e organização' },
  } satisfies Record<OfferAudience, { label: string; subtitle: string }>,

  usage: {
    chip: (used: number, limit: number) => `${used} de ${limit} hoje`,
    tooltip: (remaining: number) =>
      remaining > 0
        ? `${remaining} ${plural(remaining, 'oferta restante', 'ofertas restantes')} hoje. O limite renova à meia-noite (horário de Brasília).`
        : 'Limite diário atingido. Ele renova à meia-noite (horário de Brasília).',
    ariaLabel: (used: number, limit: number) => `${used} de ${limit} ofertas geradas hoje`,
  },

  preview: {
    title: 'Prévia da mensagem',
    emptyTitle: 'Sua oferta aparece aqui',
    emptyDescription: 'Cole o link, escolha o público e toque em "Gerar oferta" para ver a mensagem como ela chega no grupo.',
    groupFallback: 'Seu grupo',
    groupMembers: (n: number) => (n > 1 ? `e mais ${groupsLabel(n - 1)}` : 'grupo'),
    noImage: 'Sem foto',
    imageAlt: (title: string) => `Foto do produto: ${title}`,
    noTitle: 'Produto',
    audience: (label: string) => `Público: ${label}`,
    copyText: 'Copiar texto',
    textCopied: 'Texto copiado',
    openLink: 'Abrir link em nova aba',
    aiFallback: 'A IA não respondeu agora; usamos o modelo padrão.',
  },

  actions: {
    edit: 'Editar',
    editTooltip: 'Ajustar o texto antes de disparar',
    regenerate: 'Gerar novamente',
    regenerating: 'Gerando…',
    regenerateTooltip: 'Escrever um novo texto para o público escolhido',
    regenerateAudience: 'Público do novo texto',
    mentionAll: 'Marcar todos os membros',
    mentionAllHelper: 'Cada membro do grupo recebe uma notificação da oferta.',
    mentionAllUnavailable: 'Marcar todos os membros não está disponível no seu plano. Faça upgrade para liberar.',
    simulateTyping: 'Simular digitação',
    simulateTypingHelper: 'O grupo vê "digitando…" antes de cada oferta chegar.',
    typingDuration: 'Tempo digitando',
    typingSeconds: (s: number) => `${s} s`,
    typingDecrease: 'Diminuir 1 segundo',
    typingIncrease: 'Aumentar 1 segundo',
    destinations: 'Será enviada para',
    moreGroups: (n: number) => `+${n}`,
  },

  editor: {
    title: 'Editar oferta',
    titleLabel: 'Título',
    priceLabel: 'Preço',
    originalPriceLabel: 'Preço original (de)',
    originalPriceHelper: 'Opcional. Mostra o desconto na oferta.',
    textLabel: 'Texto da mensagem',
    charCount: (count: number, max: number) => `${count.toLocaleString('pt-BR')}/${max.toLocaleString('pt-BR')}`,
    textTooLong: (max: number) => `O texto passa de ${max.toLocaleString('pt-BR')} caracteres.`,
    missingLink: 'O texto não contém o seu link de afiliado. Sem ele, a venda não gera comissão.',
    attributionUnverified:
      'Não deu para confirmar que este link é seu. Cadastre sua credencial de afiliado para a ferramenta conferir.',
    manualData: 'A loja não liberou os dados do produto. Preencha título, preço e foto.',
    imageMissing: 'A foto do produto não pôde ser baixada. Envie outra imagem.',
    replaceImage: 'Trocar foto',
    addImage: 'Enviar foto',
    uploadingImage: (percent: number) => `Enviando foto… ${percent}%`,
    imageOnly: 'Escolha uma imagem (JPG, PNG ou WebP).',
    cancel: 'Cancelar',
    save: 'Salvar alterações',
    saving: 'Salvando…',
    saved: 'Alterações salvas.',
    locked: 'Esta oferta já foi enviada e não pode mais ser editada.',
  },

  send: {
    button: (count: number) => `Disparar nos ${groupsLabel(count)}`,
    buttonSingle: 'Disparar no grupo',
    buttonScheduled: (count: number) => `Agendar para ${groupsLabel(count)}`,
    title: 'Envio',
    idle: 'Revise a prévia e dispare quando estiver pronto.',
    confirmScheduledTitle: (count: number) => `Agendar envio para ${groupsLabel(count)}?`,
    confirmScheduled: 'Agendar envio',
    sending: 'Disparando…',
    confirmTitle: (count: number) => `Disparar em ${groupsLabel(count)}?`,
    /** `scheduledWhen`: início agendado já formatado; null = começa agora. */
    confirmDescription: (count: number, min: number, max: number, mentionAll: boolean, missingLink: boolean, dirty: boolean, scheduledWhen: string | null = null) =>
      [
        missingLink ? 'Atenção: o texto não contém o seu link de afiliado.' : null,
        scheduledWhen ? `O primeiro grupo recebe a oferta em ${scheduledWhen}.` : null,
        count > 1
          ? `A oferta sai para um grupo de cada vez, com ${Math.round(min / 60)} a ${Math.round(max / 60)} minutos entre cada envio.`
          : scheduledWhen ? null : 'A oferta é enviada agora.',
        mentionAll ? 'Todos os membros serão marcados.' : null,
        dirty ? 'Alterações não salvas são salvas antes do envio.' : null,
      ].filter(Boolean).join(' '),
    confirm: 'Disparar agora',
    /** Data e hora curtas no idioma do painel. */
    formatWhen: (iso: string) =>
      new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    cancel: 'Voltar',
  },

  progress: {
    title: 'Envio',
    summary: (done: number, total: number) => `${done} de ${total} ${plural(total, 'grupo concluído', 'grupos concluídos')}`,
    finishedSent: 'Envio concluído.',
    finishedFailed: 'Nenhum grupo recebeu a oferta.',
    nextSend: (group: string, session: string | null) => session ? `Próximo envio · ${group} · via ${session}` : `Próximo envio · ${group}`,
    viaSession: (name: string) => `via ${name}`,
    waitingSession: 'Aguardando a sessão reconectar',
    nextSendAria: 'Tempo até o próximo envio',
    scheduledTitle: 'Envio agendado',
    scheduled: (when: string) => `Começa em ${when}. Você pode pausar ou parar antes do início.`,
    startsIn: 'Começa em',
    startsInAria: 'Tempo até o início do envio',
    startsInDone: 'Começando…',
    remainingLong: (seconds: number) => {
      const d = Math.floor(seconds / 86400);
      const h = Math.floor((seconds % 86400) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (d > 0) return `${d} d ${h} h`;
      if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
      return seconds >= 60 ? `${m}:${String(seconds % 60).padStart(2, '0')}` : `${seconds} s`;
    },
    nextSendDone: 'Enviando…',
    nextSendAt: (time: string) => `Envio previsto às ${time}`,
    remaining: (seconds: number) =>
      seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds} s`,
    status: {
      QUEUED: 'Na fila',
      SENDING: 'Enviando',
      SENT: 'Enviado',
      FAILED: 'Falhou',
      SKIPPED: 'Ignorado',
      CANCELLED: 'Cancelado',
    } satisfies Record<OfferDispatchStatus, string>,
    failureReasons: {
      SESSION_NOT_CONNECTED: 'Sessão desconectada',
      SESSION_NOT_FOUND: 'Sessão removida',
      NOT_FOUND: 'O grupo não existe mais',
      OFFER_NOT_FOUND: 'A oferta não existe mais',
      MESSAGE_SEND_FAILED: 'O envio falhou',
      OFFER_DESTINATION_UNAVAILABLE: 'O grupo ou a sessão não existe mais',
      SEND_TIMEOUT: 'O WhatsApp demorou demais para responder',
      MEDIA_NOT_FOUND: 'A foto da oferta não foi encontrada',
      OFFER_EXPIRED: 'A oferta venceu antes de chegar a vez deste grupo',
      generic: 'O envio falhou',
      skipped: 'O grupo ou a sessão não existe mais',
    } as Record<string, string>,
    unknownDestination: 'Grupo removido',
    paused: 'Envio pausado. Os grupos que faltam esperam você retomar.',
    pausedBar: 'Pausado',
    finishedCancelled: (sent: number, cancelled: number) =>
      `Envio interrompido: ${sent} ${plural(sent, 'grupo recebeu', 'grupos receberam')} a oferta, ${cancelled} ${plural(cancelled, 'ficou', 'ficaram')} de fora.`,
    controls: {
      pause: 'Pausar',
      resume: 'Retomar',
      stop: 'Parar',
      pauseTooltip: 'Segura a fila; o envio em curso termina',
      resumeTooltip: 'Reagenda os grupos que faltam a partir de agora, com o mesmo intervalo',
      stopTooltip: 'Cancela os grupos que ainda não receberam. Não dá para desfazer',
      stopConfirmTitle: 'Parar o envio?',
      stopConfirmDescription: (remaining: number) =>
        `${remaining} ${plural(remaining, 'grupo ainda não recebeu', 'grupos ainda não receberam')} a oferta e ${plural(remaining, 'ficará', 'ficarão')} de fora. O que já saiu fica. Para enviar de novo, gere outra oferta.`,
      stopConfirm: 'Parar envio',
      stopCancel: 'Continuar enviando',
    },
  },

  errors: {
    OFFER_URL_UNSUPPORTED: 'Link não suportado. Use um link da Shopee, Amazon ou Mercado Livre.',
    OFFER_LINK_NOT_OWNED: 'Este link é de outro afiliado. Gere o link na sua conta e cole aqui.',
    OFFER_LINK_NOT_AFFILIATE: 'Esse não é um link de afiliado. Gere o link pela sua conta de afiliado da loja.',
    OFFER_PRODUCT_NOT_FOUND: 'A loja não encontrou este produto. Confira o link.',
    OFFER_NOT_FOUND: 'Esta oferta não existe mais. Gere uma nova.',
    OFFER_ALREADY_SENT: 'Esta oferta já foi enviada.',
    OFFER_INVALID_STATE: 'O envio mudou de estado enquanto você agia. A tela foi atualizada.',
    OFFER_CHANGED: 'A oferta mudou enquanto você trabalhava. Confira e tente de novo.',
    OFFER_NO_DESTINATIONS: 'Nenhum grupo configurado. Escolha os grupos antes de disparar.',
    OFFER_CONFIG_MISSING: 'Configure a sessão e os grupos antes de disparar.',
    OFFER_INVALID_INPUT: 'Algum campo não foi aceito. Confira os valores.',
    SESSION_NOT_CONNECTED: 'A sessão de envio está desconectada. Reconecte para disparar.',
    PLAN_FEATURE_UNAVAILABLE: 'Marcar todos os membros não está disponível no seu plano. Desligue a opção ou faça upgrade.',
    AFFILIATE_CREDENTIAL_NOT_FOUND: 'Você ainda não conectou sua conta de afiliado desta loja.',
    AFFILIATE_CREDENTIAL_REJECTED: 'A loja recusou sua credencial de afiliado. Confira os dados salvos.',
    AFFILIATE_API_ACCESS_DENIED:
      'Sua conta de afiliado ainda não tem acesso à Open API. Libere o acesso no painel de afiliado da Shopee e tente de novo.',
    AFFILIATE_API_RATE_LIMITED: 'A loja limitou as consultas por agora. Aguarde um minuto e tente de novo.',
    AFFILIATE_API_UNAVAILABLE: 'A loja não respondeu. Tente de novo em instantes; nada foi contado no seu limite.',
    UNSUPPORTED_MEDIA_TYPE: 'Esse arquivo não é uma imagem aceita.',
    MEDIA_TOO_LARGE: 'A imagem é grande demais.',
    VALIDATION_ERROR: 'Confira o link e tente de novo.',
    generic: 'Não foi possível concluir a ação. Tente de novo.',
  } as Record<string, string>,
  planLimit: (limit: number) =>
    `Você atingiu o limite de ${limit} ${plural(limit, 'oferta', 'ofertas')} por dia do seu plano. Ele renova à meia-noite (horário de Brasília).`,
  planLimitNoValue: 'Você atingiu o limite diário de ofertas do seu plano.',
  crossSessionUnavailable: 'Disparar por mais de um WhatsApp é exclusivo do plano Business. Deixe uma sessão na configuração ou faça upgrade.',
  groupLimit: (limit: number) => `Seu plano permite até ${groupsLabel(limit)}. Desmarque alguns e salve de novo.`,
  goToCredentials: 'Conectar conta de afiliado',
  editCredentials: 'Revisar credencial',
  openConfig: 'Configurar grupos',
  goToSessions: 'Ver sessões',
  dismiss: 'Fechar',
} as const;
