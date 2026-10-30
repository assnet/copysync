/**
 * Textos do monitoramento de grupos, centralizados até o painel ter uma lib de i18n — mesmas regras
 * de `features/offers/strings.ts`:
 * - chaves semânticas, nunca o texto como chave
 * - frase com variável é função tipada; componente nunca concatena pedaços
 * - sem nome de marca do produto; termo de produto é "sessão", nunca "instância"
 */
import type { AffiliateProvider, CapturedOfferReason, CapturedOfferStatus, MonitorTextMode } from '@/types/api.types';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "45 min", "8 h", "8 h 30 min". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

export const monitoringStrings = {
  page: {
    title: 'Monitoramento',
    subtitle: 'Acompanhe grupos de concorrentes e reposte as ofertas com o seu link',
    sessionLabel: 'Sessão',
    sessionSelectAria: 'Escolher a sessão monitorada',
    connectNew: 'Conectar nova sessão',
    connectNewTooltip: 'Abre o assistente de sessões e volta para cá ao terminar',
    sessionsError: 'Não foi possível carregar as sessões.',
    configError: 'Não foi possível carregar a configuração do monitoramento.',
    retry: 'Tentar de novo',
    emptyTitle: 'Conecte uma sessão para começar',
    emptyDescription: 'O monitoramento escuta grupos de concorrentes e reposta as ofertas nos seus grupos, já com o seu link de afiliado.',
    emptySteps: [
      { title: 'Conecte um WhatsApp', body: 'A sessão escuta os grupos e envia as ofertas.' },
      { title: 'Escolha quem escutar', body: 'Grupos de concorrentes, com palavras-chave se quiser filtrar.' },
      { title: 'Escolha onde enviar', body: 'Os seus grupos recebem a oferta com o seu link.' },
    ],
    connectFirst: 'Conectar sessão',
    untitledSession: 'Sessão sem nome',
    flowArrowLabel: 'As ofertas vão dos grupos monitorados para os grupos de disparo',
  },

  hero: {
    title: 'Monitoramento',
    subtitle: 'Reposte as ofertas de grupos concorrentes com o seu link de afiliado',
    stepsLabel: 'O que falta para o monitoramento funcionar',
    steps: {
      session: (connected: boolean) => (connected ? 'Sessão conectada' : 'Conectar a sessão'),
      monitored: (n: number) => (n === 0 ? 'Escolher grupos monitorados' : `${n} ${plural(n, 'grupo monitorado', 'grupos monitorados')}`),
      broadcast: (n: number) => (n === 0 ? 'Escolher grupos de disparo' : `${n} ${plural(n, 'grupo de disparo', 'grupos de disparo')}`),
      credentials: (problems: number) => (problems === 0 ? 'Credenciais em dia' : `${problems} ${plural(problems, 'loja', 'lojas')} sem credencial válida`),
    },
    stepDone: 'concluída',
    stepPending: 'pendente',
    stepProblem: 'precisa de atenção',
    status: {
      active: 'Ativo · capturando',
      off: 'Desligado',
      incomplete: 'Falta configurar',
    },
    statusPrefix: 'Status do monitoramento: ',
    enableAction: 'Ligar',
    enableTooltip: 'Ir para a chave "Monitoramento ativo" para ligar a captura',
  },

  usage: {
    aria: (used: number, max: number | null) => (max === null ? `${used} grupos em uso, sem limite no plano` : `${used} de ${max} grupos do plano em uso, somando todas as sessões`),
  },

  session: {
    title: 'Sessão',
    subtitle: 'WhatsApp que escuta e envia',
    noPhone: 'Número ainda não conectado',
    connect: 'Conectar',
    manage: 'Ver sessão',
    connectTooltip: 'A sessão precisa estar conectada para capturar e enviar ofertas',
    manageTooltip: 'Abrir a tela de sessões',
    lastConnected: (when: string) => `Última conexão ${when}`,
    disconnectedHint: 'Sem conexão, nada é capturado nem enviado. Conecte a sessão para retomar.',
  },

  groups: {
    untitled: 'Grupo sem nome',
    usage: (used: number, max: number | null) => (max === null ? `${used} · sem limite` : `${used}/${max} no plano`),
    usageTooltip: (used: number, max: number | null) =>
      max === null
        ? `${used} em uso somando todas as sessões da conta. Seu plano não tem limite.`
        : `${used} de ${max} do seu plano, somando todas as sessões da conta (não só esta).`,
    monitoredTitle: 'Grupos monitorados',
    monitoredSubtitle: 'Grupos de onde as ofertas são capturadas',
    monitoredEmpty: 'Escolha grupos de concorrentes para capturar as ofertas deles.',
    choose: 'Escolher grupos',
    edit: 'Editar grupos',
    configure: 'Configurar',
    configureTooltip: 'Escolher os grupos monitorados e as palavras-chave de cada um',
    keywordsAll: 'Todas as ofertas',
    keywordsCount: (n: number) => `${n} ${plural(n, 'palavra-chave', 'palavras-chave')}`,
    keywordsTooltip: (words: string) => `Só captura mensagens com: ${words}`,
    keywordsLabel: (title: string) => `Palavras-chave de ${title}`,
    broadcastTitle: 'Grupos de disparo',
    broadcastSubtitle: 'Onde as ofertas capturadas são enviadas, nesta ordem',
    broadcastEmpty: 'Adicione os seus grupos para receber as ofertas capturadas.',
    add: 'Adicionar',
    addTooltip: 'Escolher os grupos que recebem as ofertas',
    otherSession: (name: string) => `Envia por ${name}`,
    otherSessionTooltip: 'Grupo de outro WhatsApp da sua conta: a oferta sai por essa sessão (sessão cruzada).',
    moveUp: 'Enviar antes',
    moveDown: 'Enviar depois',
    remove: 'Remover da lista',
    moveUpAria: (name: string) => `Enviar antes: ${name}`,
    moveDownAria: (name: string) => `Enviar depois: ${name}`,
    removeAria: (name: string) => `Remover da lista: ${name}`,
    actionsLabel: (name: string) => `Ações de ${name}`,
    removed: 'Grupo removido da lista',
    undo: 'Desfazer',
    orderSaved: 'Ordem salva',
    listSaved: 'Lista salva',
    position: (n: number) => `${n}º`,
  },

  picker: {
    monitoredTitle: 'Grupos monitorados',
    broadcastTitle: 'Grupos de disparo',
    monitoredSubtitle: 'Origem: grupos de concorrentes de onde as ofertas são capturadas.',
    broadcastSubtitle: 'Destino: os seus grupos, que recebem as ofertas nesta ordem.',
    search: 'Buscar grupo',
    searchPlaceholder: 'Nome do grupo…',
    tabsLabel: 'Grupos disponíveis e selecionados',
    tabAvailable: 'Adicionar',
    tabSelected: (n: number) => `Selecionados (${n})`,
    selectedTitle: 'Selecionados',
    selectedEmpty: 'Nenhum grupo escolhido ainda. Adicione da lista de grupos.',
    add: 'Adicionar',
    addAria: (name: string) => `Adicionar ${name}`,
    removeAria: (name: string) => `Tirar ${name} da seleção`,
    keywordsSummary: (n: number) => (n === 0 ? 'Palavras-chave: todas' : `${n} ${plural(n, 'palavra-chave', 'palavras-chave')}`),
    keywordsToggleAria: (name: string) => `Palavras-chave de ${name}`,
    usageAria: (n: number, max: number) => `${n} de ${max} grupos usados`,
    selected: (n: number, max: number | null) => (max === null ? `${n} ${plural(n, 'selecionado', 'selecionados')}` : `${n} de ${max} selecionados`),
    available: 'Grupos da sessão',
    noResults: 'Nenhum grupo encontrado.',
    loadError: 'Não foi possível carregar os grupos da sessão.',
    partial: 'O WhatsApp não respondeu: a lista mostra só os grupos que já têm conversa.',
    retry: 'Tentar de novo',
    usedElsewhereMonitored: 'Já é grupo de disparo: um grupo não pode ser origem e destino ao mesmo tempo',
    usedElsewhereBroadcast: 'Já é grupo monitorado: um grupo não pode ser origem e destino ao mesmo tempo',
    limitReached: 'Limite do plano atingido',
    availableAll: 'Grupos das sessões conectadas',
    crossHelp: 'Grupos de qualquer WhatsApp conectado. Quem envia em cada grupo é a sessão dona dele.',
    crossLocked: 'Disparar nos grupos de outro WhatsApp é exclusivo do plano Business. Aqui aparecem só os grupos desta sessão.',
    crossLockedLink: 'Ver planos',
    sessionOf: (name: string) => `Sessão ${name}`,
    keywords: 'Palavras-chave (opcional)',
    keywordsPlaceholder: 'Digite e tecle Enter',
    keywordsHelp: 'Vazio captura toda mensagem com link suportado. Com palavras, só as que tiverem alguma delas.',
    keywordsCounter: (n: number, max: number) => `${n}/${max} palavras-chave`,
    keywordsFull: (max: number) => `Limite de ${max} palavras-chave por grupo.`,
    keywordTooLong: (max: number) => `Cada palavra-chave tem até ${max} caracteres.`,
    orderHelp: 'A ordem da lista é a ordem de envio. Reordene depois no card.',
    cancel: 'Cancelar',
    save: 'Salvar',
    close: 'Fechar',
  },

  form: {
    enabledTitle: 'Monitoramento ativo',
    enabledOn: 'Capturando ofertas dos grupos monitorados e enviando nos grupos de disparo.',
    enabledOff: 'Nada é capturado nem enviado por esta sessão até você ligar.',
    masterOn: 'Ligado',
    masterOff: 'Desligado',
    enabledMissingGroups: 'Escolha ao menos um grupo monitorado e um grupo de disparo para o monitoramento funcionar.',

    windowTitle: 'Horário de operação',
    windowSubtitle: 'Quando os envios acontecem (horário de Brasília). Fora dele, nada sai',
    windowHelp: 'Vale para todos os envios, não só o primeiro: no fim da janela o envio para e retoma no início seguinte (ex.: para às 20:00 e volta às 06:00). Oferta que vencer esperando é ignorada. Passo de 15 minutos.',
    windowHelpShort: 'Fora da janela os envios param e voltam quando ela abrir de novo.',
    windowHelpAria: 'Como funciona o horário de operação',
    captureOutsideTitle: 'Capturar fora do horário',
    captureOutsideOn: 'Fora do horário o monitoramento continua capturando; as ofertas ficam na fila e saem quando a janela abrir.',
    captureOutsideOff: 'Fora do horário nada é capturado nem entra na fila. Só o que chegar dentro da janela é enviado.',
    captureOutsideFullDay: 'Sem restrição de horário não faz diferença: tudo é capturado e enviado a qualquer hora.',
    windowAria: 'Horário de operação',
    windowStart: 'Início',
    windowEnd: 'Fim',
    windowFullDay: 'Sem restrição — envio 24 h',
    windowRange: (start: string, end: string, duration: string) => `${start} → ${end} · ${duration}`,
    windowRangeAria: (start: string, end: string, duration: string) => `Envios entre ${start} e ${end}, ${duration} por dia`,
    windowOvernight: 'Janela noturna (cruza a meia-noite)',
    windowOvernightHelp: 'Envia fora da faixa marcada: do cursor da direita, passando pela meia-noite, até o da esquerda.',
    windowEmpty: 'A janela noturna precisa deixar algum horário livre. Afaste os cursores das pontas.',

    dispatchTitle: 'Envio',
    dispatchSubtitle: 'Ritmo dos envios nos grupos de disparo',
    intervalLabel: 'Intervalo entre envios',
    intervalHelp: 'Cada envio espera um tempo sorteado nesta faixa. Intervalos maiores parecem mais naturais.',
    intervalAria: 'Intervalo entre envios',
    intervalMin: 'Mínimo',
    intervalMax: 'Máximo',
    minutes: (n: number) => `${n} min`,
    seconds: (n: number) => `${n} s`,
    typingTitle: 'Mostrar "digitando…"',
    typingHelp: 'Antes de cada envio o grupo vê a sessão digitando por alguns segundos.',
    typingLabel: 'Tempo digitando',
    mentionAllTitle: 'Marcar todos',
    mentionAllHelp: 'Notifica todos os participantes do grupo a cada oferta.',
    mentionAllLocked: 'Seu plano não inclui marcar todos.',

    afterTitle: 'Depois da captura',
    afterSubtitle: 'Quando começar e até quando a oferta vale',
    afterHelp: 'Oferta ou cupom vencido não é enviado: o que passar da validade antes de sair da fila é descartado.',
    delayLabel: 'Esperar para começar',
    delayHelp: 'Tempo entre a captura e o primeiro envio. Zero envia assim que possível.',
    delayNone: 'Sem espera',
    maxAgeLabel: 'Validade da oferta sem cupom',
    maxAgeHelp: 'Depois disso, contado da captura, a oferta não é mais enviada.',
    couponAgeLabel: 'Validade da oferta com cupom',
    couponAgeHelp: 'Cupons esgotam rápido. Não passa da validade sem cupom.',

    textTitle: 'Texto da oferta',
    textSubtitle: 'O que vai escrito em cada oferta repostada',
    textModeAria: 'Como montar o texto',
    textModes: {
      ORIGINAL: { label: 'Original', short: 'O texto do grupo, com o seu link', help: 'Repassa o texto do grupo monitorado, só trocando o link pelo seu.' },
      TEMPLATE: { label: 'Modelo', short: 'Título, preço e cupom do produto', help: 'Monta a oferta com os dados do produto: título, preço, preço anterior, cupom e o seu link.' },
      AI: { label: 'Reescrita com IA', short: 'Texto novo para o seu público', help: 'A IA escreve a oferta para o público escolhido a partir dos dados do produto. Se a IA falhar, sai o modelo.' },
    } satisfies Record<MonitorTextMode, { label: string; short: string; help: string }>,
    textProductNote: 'Os dados do produto vêm da loja (vitrine do Mercado Livre, API da Shopee, página da Amazon). Quando não dá para ler, sai o texto original.',
    audienceLabel: 'Público-alvo',
    enrichTitle: 'Montar a oferta quando chegar só o link',
    enrichHelp: 'Mensagem só com link, sem texto, vira oferta com título, preço e foto do produto mesmo no modo Original.',

    upcomingInline: 'Imagem nova para a oferta quando a original não puder ser usada',
    soon: 'Em breve',

    unsaved: 'Alterações não salvas',
    discard: 'Descartar',
    save: 'Salvar',
    saving: 'Salvando…',
    saved: 'Configuração salva.',
    info: 'Saiba mais',
  },

  credentialAlerts: {
    regionLabel: 'Avisos de credenciais',
    titleMissing: (marketplace: string) => `${marketplace} sem credencial de afiliado`,
    titleRejected: (marketplace: string) => `${marketplace} recusou a sua credencial`,
    missingDetail: 'As ofertas desta loja estão sendo ignoradas.',
    rejectedDetail: 'As ofertas desta loja estão pausadas.',
    since: (when: string) => `Desde ${when}`,
    hint: {
      MERCADO_LIVRE: 'Abra a extensão, entre de novo na sua conta do Mercado Livre e sincronize a sessão.',
      SHOPEE: 'Confira o App ID e salve um Secret novo nas credenciais de afiliado.',
      AMAZON: 'Confira o ID de rastreamento nas credenciais de afiliado.',
    } satisfies Record<AffiliateProvider, string>,
    action: 'Configurar',
    actionAria: (marketplace: string) => `Configurar credencial de ${marketplace}`,
  },

  errors: {
    generic: 'Não foi possível concluir agora. Tente de novo em instantes.',
    sessionNotConnected: 'A sessão não está conectada. Conecte o WhatsApp dela e tente de novo.',
    engineUnavailable: 'O WhatsApp da sessão não respondeu. Aguarde alguns segundos e tente de novo.',
    groupNotFound: 'Grupo não encontrado nesta sessão. Atualize a lista e escolha de novo.',
    sessionNotFound: 'Sessão não encontrada. Ela pode ter sido excluída.',
    capturedNotFound: 'Esta oferta não está mais disponível.',
    groupConflict: (group: string | null, role: 'monitored' | 'broadcast' | null) => {
      const who = group ? `O grupo "${group}"` : 'Um dos grupos escolhidos';
      const as = role === 'monitored' ? 'grupo monitorado' : role === 'broadcast' ? 'grupo de disparo' : 'usado na outra lista';
      return `${who} já é ${as} (nesta ou em outra sessão). O mesmo grupo não pode ser origem e destino.`;
    },
    invalidInput: (field: string | null) =>
      field ? `Valor fora do permitido em "${field}". Ajuste e salve de novo.` : 'Algum valor está fora do permitido. Ajuste e salve de novo.',
    planLimit: (max: number | null) =>
      max === null
        ? 'Limite do plano atingido.'
        : `Seu plano permite até ${max} grupos somando todas as sessões. Remova algum ou fale com o suporte para ampliar.`,
    planFeature: 'Seu plano não inclui este recurso.',
    crossSessionUnavailable: 'Disparar nos grupos de outro WhatsApp é exclusivo do plano Business. Escolha grupos desta sessão ou faça upgrade.',
    notRetryable: 'Esta oferta não pode ser tentada de novo (já foi processada ou o motivo não é recuperável).',
    fields: {
      enabled: 'Monitoramento ativo',
      windowStartMinute: 'Horário de operação',
      windowEndMinute: 'Horário de operação',
      intervalMinSeconds: 'Intervalo entre envios',
      intervalMaxSeconds: 'Intervalo entre envios',
      startDelaySeconds: 'Esperar para começar',
      maxOfferAgeMinutes: 'Validade da oferta sem cupom',
      couponMaxAgeMinutes: 'Validade da oferta com cupom',
      mentionAll: 'Marcar todos',
      simulateTyping: 'Mostrar "digitando…"',
      typingSeconds: 'Tempo digitando',
      captureOutsideWindow: 'Capturar fora do horário',
      groups: 'Grupos',
      groupJids: 'Grupos',
      keywords: 'Palavras-chave',
    } as Record<string, string>,
  },

  captured: {
    title: 'Ofertas capturadas',
    subtitle: 'O que chegou dos grupos monitorados e o destino de cada oferta',
    refresh: 'Atualizar',
    refreshing: 'Atualizando…',
    updatedAt: (time: string) => `Atualizado às ${time}`,
    listAria: 'Ofertas capturadas',
    filterAria: 'Filtrar ofertas capturadas',
    filters: {
      all: 'Todas',
      action: 'Precisam de ação',
      queued: 'Na fila',
      working: 'Em andamento',
      skipped: 'Ignoradas',
    },
    filterCount: (label: string, n: number) => `${label}: ${n} ${n === 1 ? 'oferta' : 'ofertas'}`,
    /** Contagem com mais páginas no servidor: vale só para as carregadas. */
    countPartial: (n: number) => `${n}+`,
    filterCountPartial: (label: string, n: number) => `${label}: ${n} ${n === 1 ? 'oferta' : 'ofertas'} nas carregadas`,
    filterEmpty: 'Nada com este filtro nas ofertas carregadas.',
    filterEmptyMore: 'Carregue mais para procurar nas mais antigas.',
    showAll: 'Ver todas',
    newItems: (n: number) => (n === 1 ? '1 oferta nova' : `${n} ofertas novas`),
    showMore: 'Ver mais',
    showLess: 'Ver menos',
    progressAria: (sent: number, total: number) => `Enviada para ${sent} de ${total} ${total === 1 ? 'grupo' : 'grupos'} de disparo`,
    noImage: 'Oferta sem imagem',
    empty: 'Nenhuma oferta capturada ainda',
    emptyDescription: 'Quando um grupo monitorado postar uma oferta com link suportado, ela aparece aqui.',
    configureGroups: 'Escolher grupos monitorados',
    /** "agora", "há 3 min" (até 1 h). */
    ago: (seconds: number) => {
      const s = Math.max(0, Math.floor(seconds));
      if (s < 60) return 'agora';
      return `há ${Math.floor(s / 60)} min`;
    },
    timeOf: (d: Date) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(d),
    /** Data e hora completas (tooltip). */
    dateTime: (d: Date) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' }).format(d),
    today: (time: string) => `hoje ${time}`,
    yesterday: (time: string) => `ontem ${time}`,
    dayMonth: (d: Date, time: string) => `${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(d).replace('.', '')} ${time}`,
    loadError: 'Não foi possível carregar as ofertas capturadas.',
    retry: 'Tentar de novo',
    loadMore: 'Carregar mais',
    retryItem: 'Tentar de novo',
    retryItemTooltip: 'Processa a oferta outra vez. Corrija a causa antes (credencial, grupos de disparo, monitoramento ligado). A validade conta da hora da captura original: oferta antiga volta como vencida.',
    retryDone: 'Oferta enviada para processar de novo.',
    unknownGroup: 'Grupo desconhecido',
    imageUnavailable: 'Imagem indisponível',
    imageUnavailableTooltip: 'A foto da mensagem não pôde ser usada: a oferta sai só com texto.',
    coupon: (code: string) => `Cupom ${code}`,
    capturedAt: (time: string) => `Capturada ${time}`,
    startsAt: (time: string) => `envio às ${time}`,
    expiresAt: (time: string) => `vale até ${time}`,
    progress: (sent: number, total: number) => `${sent} de ${total} ${total === 1 ? 'grupo' : 'grupos'}`,
    progressTooltip: 'Grupos de disparo que já receberam esta oferta. Pausar, retomar e parar agem em todos os grupos dela.',
    offerPaused: 'Pausada',
    offerStatus: {
      DRAFT: 'Rascunho',
      SENDING: 'Enviando',
      PAUSED: 'Pausada',
      SENT: 'Enviada',
      FAILED: 'Falhou',
      CANCELLED: 'Parada',
    },
    textSource: {
      ORIGINAL: 'Texto original',
      TEMPLATE: 'Texto do modelo',
      AI: 'Texto da IA',
    } satisfies Record<MonitorTextMode, string>,
    textSourceTooltip: {
      ORIGINAL: 'Texto do grupo monitorado com o link trocado pelo seu.',
      TEMPLATE: 'Montado com os dados do produto (título, preço, link).',
      AI: 'Escrito pela IA a partir dos dados do produto.',
    } satisfies Record<MonitorTextMode, string>,
    aiFallback: 'IA indisponível',
    aiFallbackTooltip: (code: string) => `A IA não respondeu (${code}); a oferta saiu com o texto do modelo.`,
    untilStart: 'Começa a enviar em',
    untilStartAria: 'Tempo até o primeiro envio',
    started: 'Na fila',
    remaining: (seconds: number) => {
      const s = Math.max(0, Math.ceil(seconds));
      if (s < 60) return `${s} s`;
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const rest = s % 60;
      if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
      return rest > 0 ? `${m} min ${rest} s` : `${m} min`;
    },
    /** Selo de SKIPPED/FAILED que dá para recuperar (mesma regra do filtro "Precisam de ação"). */
    statusAction: 'Precisa de ação',
    statusActionHelp: 'Não foi enviada, mas dá para recuperar: corrija o motivo abaixo e toque em Tentar de novo.',
    statusHelp: {
      PENDING: 'Capturada e aguardando processamento.',
      PROCESSING: 'Trocando o link pelo seu e preparando o texto.',
      QUEUED: 'Pronta: entrou na fila de envio dos grupos de disparo.',
      SKIPPED: 'Não foi enviada. O motivo aparece logo abaixo.',
      FAILED: 'Deu erro ao processar. Veja o motivo e, se possível, tente de novo.',
    } satisfies Record<CapturedOfferStatus, string>,
    status: {
      PENDING: 'Aguardando',
      PROCESSING: 'Processando',
      QUEUED: 'Na fila de envio',
      SKIPPED: 'Ignorada',
      FAILED: 'Falhou',
    } satisfies Record<CapturedOfferStatus, string>,
    reason: {
      NO_LINK: 'Mensagem sem link',
      UNSUPPORTED_MARKETPLACE: 'Loja não suportada',
      CREDENTIAL_MISSING: 'Falta a sua credencial de afiliado desta loja',
      CREDENTIAL_REJECTED: 'A loja recusou a sua credencial: reconfigure para voltar a enviar',
      LINK_RESOLVE_FAILED: 'Não foi possível gerar o seu link',
      EXPIRED: 'Venceu antes de enviar',
      MONITOR_DISABLED: 'Monitoramento desligado',
      NO_BROADCAST_GROUPS: 'Nenhum grupo de disparo',
      KEYWORD_MISMATCH: 'Sem as palavras-chave do grupo',
      INTERNAL_ERROR: 'Erro interno',
    } satisfies Record<CapturedOfferReason, string>,
    marketplace: {
      SHOPEE: 'Shopee',
      MERCADO_LIVRE: 'Mercado Livre',
      AMAZON: 'Amazon',
    } satisfies Record<AffiliateProvider, string>,
  },
} as const;
