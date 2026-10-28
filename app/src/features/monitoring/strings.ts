/**
 * Textos do monitoramento de grupos, centralizados até o painel ter uma lib de i18n — mesmas regras
 * de `features/offers/strings.ts`:
 * - chaves semânticas, nunca o texto como chave
 * - frase com variável é função tipada; componente nunca concatena pedaços
 * - sem nome de marca do produto; termo de produto é "sessão", nunca "instância"
 */
import type { AffiliateProvider, CapturedOfferReason, CapturedOfferStatus } from '@/types/api.types';

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
    emptyTitle: 'Nenhuma sessão conectada',
    emptyDescription: 'Conecte um WhatsApp para escolher os grupos que serão monitorados e os grupos que recebem as ofertas.',
    untitledSession: 'Sessão sem nome',
  },

  session: {
    title: 'Sessão',
    subtitle: 'WhatsApp que escuta e envia',
    noPhone: 'Número ainda não conectado',
    connect: 'Conectar',
    manage: 'Ver sessão',
    connectTooltip: 'A sessão precisa estar conectada para capturar e enviar ofertas',
    manageTooltip: 'Abrir a tela de sessões',
  },

  groups: {
    untitled: 'Grupo sem nome',
    usage: (used: number, max: number | null) => (max === null ? `${used} · sem limite` : `${used}/${max}`),
    usageTooltip: (used: number, max: number | null) =>
      max === null
        ? `${used} em uso somando todas as sessões. Seu plano não tem limite.`
        : `${used} de ${max} do seu plano, somando todas as sessões.`,
    monitoredTitle: 'Grupos monitorados',
    monitoredSubtitle: 'Grupos de onde as ofertas são capturadas',
    monitoredEmpty: 'Nenhum grupo monitorado. Escolha grupos de concorrentes para capturar as ofertas deles.',
    configure: 'Configurar',
    configureTooltip: 'Escolher os grupos monitorados e as palavras-chave de cada um',
    keywordsAll: 'Todas as ofertas',
    keywordsCount: (n: number) => `${n} ${plural(n, 'palavra-chave', 'palavras-chave')}`,
    keywordsTooltip: (words: string) => `Só captura mensagens com: ${words}`,
    broadcastTitle: 'Grupos de disparo',
    broadcastSubtitle: 'Onde as ofertas capturadas são enviadas, nesta ordem',
    broadcastEmpty: 'Nenhum grupo de disparo. Adicione os seus grupos para receber as ofertas.',
    add: 'Adicionar',
    addTooltip: 'Escolher os grupos que recebem as ofertas',
    moveUp: 'Enviar antes',
    moveDown: 'Enviar depois',
    remove: 'Remover da lista',
    position: (n: number) => `${n}º`,
  },

  picker: {
    monitoredTitle: 'Grupos monitorados',
    broadcastTitle: 'Grupos de disparo',
    search: 'Buscar grupo',
    selected: (n: number, max: number | null) => (max === null ? `${n} ${plural(n, 'selecionado', 'selecionados')}` : `${n} de ${max} selecionados`),
    available: 'Grupos da sessão',
    noResults: 'Nenhum grupo encontrado.',
    loadError: 'Não foi possível carregar os grupos da sessão.',
    partial: 'O WhatsApp não respondeu: a lista mostra só os grupos que já têm conversa.',
    retry: 'Tentar de novo',
    usedElsewhereMonitored: 'Já é grupo de disparo: um grupo não pode ser origem e destino ao mesmo tempo',
    usedElsewhereBroadcast: 'Já é grupo monitorado: um grupo não pode ser origem e destino ao mesmo tempo',
    limitReached: 'Limite do plano atingido',
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
    enabledOff: 'Desligado: nada é capturado nem enviado por esta sessão.',
    enabledMissingGroups: 'Escolha ao menos um grupo monitorado e um grupo de disparo para o monitoramento funcionar.',

    windowTitle: 'Horário de operação',
    windowSubtitle: 'Quando os envios podem começar (horário de Brasília). Fora dele, as ofertas aguardam a janela abrir',
    windowHelp: 'Os envios começam dentro deste horário. Com muitos grupos de disparo, os últimos podem sair um pouco depois do fim. Passo de 15 minutos.',
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

    upcomingTitle: 'Próximos recursos',
    aiRewriteTitle: 'Reescrita com IA',
    aiRewriteHelp: 'Reescreve o texto da oferta com o seu tom antes de enviar.',
    imageTitle: 'Imagem das ofertas',
    imageHelp: 'Gera uma imagem nova para a oferta quando a original não puder ser usada.',
    soon: 'Em breve',

    unsaved: 'Alterações não salvas',
    discard: 'Descartar',
    save: 'Salvar',
    saving: 'Salvando…',
    saved: 'Configuração salva.',
    info: 'Saiba mais',
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
      groups: 'Grupos',
      groupJids: 'Grupos',
      keywords: 'Palavras-chave',
    } as Record<string, string>,
  },

  captured: {
    title: 'Ofertas capturadas',
    subtitle: 'O que chegou dos grupos monitorados e o destino de cada oferta',
    refresh: 'Atualizar',
    empty: 'Nenhuma oferta capturada ainda',
    emptyDescription: 'Quando um grupo monitorado postar uma oferta com link suportado, ela aparece aqui.',
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
    capturedAt: (time: string) => `Capturada às ${time}`,
    startsAt: (time: string) => `Envio previsto às ${time}`,
    expiresAt: (time: string) => `Vale até ${time}`,
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
