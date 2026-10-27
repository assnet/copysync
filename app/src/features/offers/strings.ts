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
    newOffer: 'Nova oferta',
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
      title: 'Escolha a sessão',
      subtitle: 'O número do WhatsApp que vai enviar as ofertas.',
      loadError: 'Não foi possível carregar as sessões.',
      emptyTitle: 'Nenhuma sessão conectada',
      emptyDescription: 'Conecte um número de WhatsApp para disparar ofertas nos seus grupos.',
      emptyAction: 'Conectar uma sessão',
      connected: 'Conectada',
      noPhone: 'Número não informado',
    },
    groups: {
      title: 'Selecione os grupos',
      subtitle: 'Todos os grupos de que o WhatsApp da sessão participa.',
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
      required: 'Selecione ao menos um grupo.',
    },
    confirm: {
      title: 'Confira e salve',
      subtitle: 'Revise antes de salvar. Dá para mudar depois em "Editar".',
      session: 'Sessão',
      total: 'Total de grupos',
      groups: 'Grupos',
      interval: 'Intervalo entre grupos',
      intervalHelper: 'Uma pausa aleatória entre um grupo e outro deixa o envio mais natural.',
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
    sending: 'Disparando…',
    confirmTitle: (count: number) => `Disparar em ${groupsLabel(count)}?`,
    confirmDescription: (count: number, min: number, max: number, mentionAll: boolean, missingLink: boolean, dirty: boolean) =>
      [
        missingLink ? 'Atenção: o texto não contém o seu link de afiliado.' : null,
        count > 1
          ? `A oferta sai para um grupo de cada vez, com ${Math.round(min / 60)} a ${Math.round(max / 60)} minutos entre cada envio.`
          : 'A oferta é enviada agora.',
        mentionAll ? 'Todos os membros serão marcados.' : null,
        dirty ? 'Alterações não salvas são salvas antes do envio.' : null,
      ].filter(Boolean).join(' '),
    confirm: 'Disparar agora',
    cancel: 'Voltar',
  },

  progress: {
    title: 'Envio',
    summary: (done: number, total: number) => `${done} de ${total} ${plural(total, 'grupo concluído', 'grupos concluídos')}`,
    finishedSent: 'Envio concluído.',
    finishedFailed: 'Nenhum grupo recebeu a oferta.',
    nextSend: (group: string) => `Próximo envio · ${group}`,
    nextSendAria: 'Tempo até o próximo envio',
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
      generic: 'O envio falhou',
      skipped: 'O grupo ou a sessão não existe mais',
    } as Record<string, string>,
    unknownDestination: 'Grupo removido',
  },

  errors: {
    OFFER_URL_UNSUPPORTED: 'Link não suportado. Use um link da Shopee, Amazon ou Mercado Livre.',
    OFFER_LINK_NOT_OWNED: 'Este link é de outro afiliado. Gere o link na sua conta e cole aqui.',
    OFFER_LINK_NOT_AFFILIATE: 'Esse não é um link de afiliado. Gere o link pela sua conta de afiliado da loja.',
    OFFER_PRODUCT_NOT_FOUND: 'A loja não encontrou este produto. Confira o link.',
    OFFER_NOT_FOUND: 'Esta oferta não existe mais. Gere uma nova.',
    OFFER_ALREADY_SENT: 'Esta oferta já foi enviada.',
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
  groupLimit: (limit: number) => `Seu plano permite até ${groupsLabel(limit)}. Desmarque alguns e salve de novo.`,
  goToCredentials: 'Conectar conta de afiliado',
  editCredentials: 'Revisar credencial',
  openConfig: 'Configurar grupos',
  goToSessions: 'Ver sessões',
  dismiss: 'Fechar',
} as const;
