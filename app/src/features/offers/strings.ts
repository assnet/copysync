/**
 * Textos do gerador de ofertas, centralizados até o painel ter uma lib de i18n — mesmas regras de
 * `features/settings/strings.ts`:
 * - chaves semânticas, nunca o texto como chave
 * - frase com variável é função tipada; componente nunca concatena pedaços
 * - sem nome de marca do produto (usar "a ferramenta")
 */
import type { OfferDispatchStatus } from '@/types/api.types';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const offerStrings = {
  page: {
    title: 'Gerador de ofertas',
    subtitle: 'Cole o link do produto, revise a oferta e envie para os seus grupos',
    emptyTitle: 'Sua próxima oferta começa com um link',
    emptyDescription:
      'Cole o link de um produto da Shopee, Amazon ou Mercado Livre. A ferramenta monta a oferta com o seu link de afiliado.',
    newOffer: 'Nova oferta',
  },

  link: {
    label: 'Link do produto',
    placeholder: 'https://shopee.com.br/...',
    helper: 'Shopee, Amazon e Mercado Livre. Links encurtados também valem.',
    submit: 'Gerar oferta',
    generating: 'Gerando…',
    required: 'Cole o link do produto.',
    invalid: 'Isso não parece um link. Ele deve começar com https://',
    clear: 'Limpar link',
  },

  usage: {
    chip: (used: number, limit: number) => `${used} de ${limit} hoje`,
    tooltip: (remaining: number) =>
      remaining > 0
        ? `${remaining} ${plural(remaining, 'oferta restante', 'ofertas restantes')} hoje. O limite renova à meia-noite (horário de Brasília).`
        : 'Limite diário atingido. Ele renova à meia-noite (horário de Brasília).',
    ariaLabel: (used: number, limit: number) => `${used} de ${limit} ofertas geradas hoje`,
  },

  preview: {
    title: 'Prévia',
    noImage: 'Sem foto',
    noTitle: 'Título do produto',
    noPrice: 'Preço não informado',
    from: (price: string) => `de ${price}`,
    to: (price: string) => `por ${price}`,
    discount: (percent: number) => `-${percent}%`,
    discountAria: (percent: number) => `${percent}% de desconto`,
    affiliateLink: 'Seu link de afiliado',
    copyLink: 'Copiar link',
    linkCopied: 'Link copiado',
    openLink: 'Abrir link em nova aba',
    imageAlt: (title: string) => `Foto do produto: ${title}`,
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
    textAuto: 'O texto se atualiza sozinho quando você muda o título ou o preço.',
    textManual: 'Você editou o texto. Mudanças no título e no preço não alteram mais a mensagem.',
    missingLink: 'O texto não contém o seu link de afiliado. Sem ele, a venda não gera comissão.',
    attributionUnverified:
      'Atribuição pelo parâmetro do link não confirmada pelo Mercado Livre. Confira as vendas no painel de afiliado.',
    manualData: 'Este marketplace não libera os dados do produto. Preencha título, preço e foto.',
    imageMissing: 'A foto do produto não pôde ser baixada. Envie outra imagem.',
    replaceImage: 'Trocar foto',
    addImage: 'Enviar foto',
    uploadingImage: (percent: number) => `Enviando foto… ${percent}%`,
    imageOnly: 'Escolha uma imagem (JPG, PNG ou WebP).',
    save: 'Salvar alterações',
    saving: 'Salvando…',
    saved: 'Alterações salvas.',
    locked: 'Esta oferta já foi enviada e não pode mais ser editada.',
  },

  destinations: {
    button: (count: number) => (count > 0 ? `Destinos (${count})` : 'Escolher destinos'),
    buttonTooltip: 'Grupos e conversas que recebem as ofertas',
    dialogTitle: 'Destinos das ofertas',
    dialogSubtitle: 'Toda oferta enviada vai para as conversas marcadas aqui.',
    searchLabel: 'Buscar conversa',
    onlyGroups: 'Só grupos',
    selectAll: 'Selecionar todos',
    selectedCount: (n: number) => `${n} ${plural(n, 'selecionado', 'selecionados')}`,
    loadError: 'Não foi possível carregar as conversas.',
    empty: 'Nenhuma conversa encontrada.',
    group: 'Grupo',
    contact: 'Contato',
    untitled: 'Conversa sem nome',
    cancel: 'Cancelar',
    save: 'Salvar destinos',
    saving: 'Salvando…',
    saved: 'Destinos salvos.',
    retry: 'Tentar novamente',
  },

  send: {
    button: (count: number) => (count > 0 ? `Enviar para ${count} ${plural(count, 'destino', 'destinos')}` : 'Enviar oferta'),
    noDestinations: 'Escolha ao menos um destino antes de enviar.',
    confirmTitle: (count: number) => `Enviar para ${count} ${plural(count, 'destino', 'destinos')}?`,
    confirmDescription: (count: number, missingLink: boolean) =>
      [
        missingLink ? 'Atenção: o texto não contém o seu link de afiliado.' : null,
        count > 1
          ? 'A oferta sai para um destino de cada vez, com 8 a 15 segundos entre cada envio.'
          : 'A oferta é enviada agora.',
        'Alterações não salvas são salvas antes do envio.',
      ].filter(Boolean).join(' '),
    confirm: 'Enviar agora',
    cancel: 'Voltar',
    sending: 'Enviando…',
  },

  progress: {
    title: 'Envio',
    summary: (done: number, total: number) => `${done} de ${total} ${plural(total, 'destino concluído', 'destinos concluídos')}`,
    finishedSent: 'Envio concluído.',
    finishedFailed: 'Nenhum destino recebeu a oferta.',
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
      NOT_FOUND: 'A conversa não existe mais',
      OFFER_NOT_FOUND: 'A oferta não existe mais',
      MESSAGE_SEND_FAILED: 'O envio falhou',
      OFFER_DESTINATION_UNAVAILABLE: 'A conversa ou a sessão não existe mais',
      SEND_TIMEOUT: 'O WhatsApp demorou demais para responder',
      MEDIA_NOT_FOUND: 'A foto da oferta não foi encontrada',
      generic: 'O envio falhou',
      skipped: 'A conversa ou a sessão não existe mais',
    } as Record<string, string>,
    unknownDestination: 'Destino removido',
  },

  errors: {
    OFFER_URL_UNSUPPORTED: 'Link não suportado. Use um link da Shopee, Amazon ou Mercado Livre.',
    OFFER_PRODUCT_NOT_FOUND: 'O marketplace não encontrou este produto. Confira o link.',
    OFFER_NOT_FOUND: 'Esta oferta não existe mais. Gere uma nova.',
    OFFER_ALREADY_SENT: 'Esta oferta já foi enviada.',
    OFFER_NO_DESTINATIONS: 'Escolha ao menos um destino antes de enviar.',
    OFFER_INVALID_INPUT: 'Algum campo não foi aceito. Confira os valores.',
    AFFILIATE_CREDENTIAL_NOT_FOUND: 'Você ainda não conectou sua conta de afiliado deste marketplace.',
    AFFILIATE_CREDENTIAL_REJECTED: 'O marketplace recusou sua credencial de afiliado. Confira os dados salvos.',
    AFFILIATE_API_ACCESS_DENIED:
      'Sua conta de afiliado ainda não tem acesso à Open API. Libere o acesso no painel de afiliado da Shopee e tente de novo.',
    AFFILIATE_API_RATE_LIMITED: 'O marketplace limitou as consultas por agora. Aguarde um minuto e tente de novo.',
    AFFILIATE_API_UNAVAILABLE: 'O marketplace não respondeu. Tente de novo em instantes; nada foi contado no seu limite.',
    UNSUPPORTED_MEDIA_TYPE: 'Esse arquivo não é uma imagem aceita.',
    MEDIA_TOO_LARGE: 'A imagem é grande demais.',
    VALIDATION_ERROR: 'Confira o link e tente de novo.',
    generic: 'Não foi possível concluir a ação. Tente de novo.',
  } as Record<string, string>,
  planLimit: (limit: number) =>
    `Você atingiu o limite de ${limit} ${plural(limit, 'oferta', 'ofertas')} por dia do seu plano. Ele renova à meia-noite (horário de Brasília).`,
  planLimitNoValue: 'Você atingiu o limite diário de ofertas do seu plano.',
  goToCredentials: 'Conectar conta de afiliado',
  editCredentials: 'Revisar credencial',
  dismiss: 'Fechar',
} as const;
