/**
 * Textos do chat, centralizados até o painel ter uma lib de i18n (context.md D3).
 *
 * Regras para continuar migrável para `t()` sem tocar em componente:
 * - chaves semânticas, nunca o texto como chave
 * - frase com variável é função tipada; plural resolvido aqui, não no JSX
 * - componente nunca concatena pedaços destas strings
 * - sem nome de marca do produto nem da engine de mensageria
 */

/** Junta nomes em lista natural: "Ana", "Ana e Bia", "Ana, Bia e Caio". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/** Plural simples: `1 arquivo`, `3 arquivos`. */
function countOf(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Duração para leitor de tela: "5 segundos", "1 minuto e 5 segundos". */
function spokenDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(countOf(minutes, 'minuto', 'minutos'));
  if (seconds > 0 || minutes === 0) parts.push(countOf(seconds, 'segundo', 'segundos'));
  return parts.join(' e ');
}

export const chatStrings = {
  /** Campo de texto e botões do rodapé da conversa. */
  composer: {
    placeholder: 'Digite uma mensagem... (Enter para enviar)',
    send: 'Enviar (Enter)',
    /** Tooltips dos botões ainda desabilitados enquanto o recurso não está ligado. */
    emojiSoon: 'Emoji (em breve)',
    attachSoon: 'Anexar (em breve)',
    voiceSoon: 'Áudio (em breve)',
    /** Clipe e microfone habilitados. */
    attach: 'Anexar',
    recordVoice: 'Gravar mensagem de voz',
    cancelReply: 'Cancelar resposta',
    /** Banner de resposta: citação de mensagem apagada. */
    replyDeleted: 'Mensagem apagada',
    /** Banner de resposta: rótulo do tipo quando a citação não é texto. */
    replyTypes: {
      image: 'Imagem',
      audio: 'Áudio',
      document: 'Documento',
      video: 'Vídeo',
      sticker: 'Sticker',
      location: 'Localização',
      vcard: 'Contato',
    },
  },

  /** Menu do clipe, prévia do lote e área de soltar. */
  attachments: {
    menuLabel: 'Opções de anexo',
    document: 'Documento',
    photosAndVideos: 'Fotos e vídeos',
    unavailable: 'Anexos indisponíveis no momento',
    /** Tooltip do clipe com a conversa encerrada. */
    conversationClosed: 'Conversa encerrada. Reabra para enviar anexos',

    previewTitle: 'Revisar anexos',
    closePreview: 'Fechar prévia',
    captionLabel: 'Legenda',
    captionPlaceholder: 'Adicione uma legenda',
    addMore: 'Adicionar arquivos',
    removeItem: 'Remover arquivo',
    /** `aria-label` do botão remover, com o nome para diferenciar itens. */
    removeItemNamed: (fileName: string): string => `Remover ${fileName}`,
    /** `aria-label` da miniatura: posição no lote. */
    itemPosition: (position: number, total: number): string => `Arquivo ${position} de ${total}`,
    /** Linha de detalhes do item: tipo e tamanho já formatados. */
    fileDetails: (typeLabel: string, sizeLabel: string): string => `${typeLabel} · ${sizeLabel}`,

    /** Botão enviar do lote. Plural resolvido aqui. */
    sendCount: (count: number): string => `Enviar ${countOf(count, 'arquivo', 'arquivos')}`,
    /** Tooltip do enviar desabilitado por item bloqueado. */
    removeBlockedToSend: 'Remova os arquivos com aviso para enviar',

    sentAsDocument: 'Será enviado como documento',
    /** `limitLabel` já formatado, ex.: "180 MB". */
    fileTooLarge: (limitLabel: string): string => `Arquivo acima do limite de ${limitLabel}`,
    emptyFile: 'Arquivo vazio',
    batchTooLarge: (max: number): string => `Envie até ${countOf(max, 'arquivo', 'arquivos')} por vez`,

    dropHere: 'Solte para enviar',
  },

  /** Barra de gravação da mensagem de voz. */
  voice: {
    record: 'Gravar mensagem de voz',
    recording: 'Gravando',
    pause: 'Pausar gravação',
    resume: 'Continuar gravando',
    play: 'Ouvir gravação',
    stopPlaying: 'Parar de ouvir',
    discard: 'Descartar gravação',
    send: 'Enviar mensagem de voz',
    /** `aria-label` do cronômetro (`role="status"`). */
    timerLabel: (totalSeconds: number): string => `Tempo de gravação: ${spokenDuration(totalSeconds)}`,
    /** Aviso ao atingir o máximo; a barra fica pausada, sem enviar. */
    maxReached: (limitMinutes: number): string =>
      `Limite de ${countOf(limitMinutes, 'minuto', 'minutos')} atingido. Ouça ou envie.`,
    previewUnsupported: 'Este navegador não permite ouvir antes de enviar',
    tooShort: 'Gravação muito curta',
    /** Rótulo da barra ao voltar para a conversa com gravação guardada. */
    draft: 'Rascunho de voz',
    draftSaved: 'Gravação guardada como rascunho',
    /** Microfone desabilitado: servidor sem suporte a nota de voz. */
    unavailable: 'Mensagem de voz indisponível',

    errors: {
      permissionDenied: 'Acesso ao microfone bloqueado. Libere nas configurações do navegador.',
      noMicrophone: 'Nenhum microfone encontrado. Conecte um e tente de novo.',
      microphoneBusy: 'O microfone está em uso por outro aplicativo. Feche-o e tente de novo.',
      insecureContext: 'Gravar áudio exige conexão segura (HTTPS).',
      unsupported: 'Este navegador não permite gravar áudio.',
      generic: 'Não foi possível gravar. Tente de novo.',
    },
  },

  /** Bolha de mídia em envio: progresso, cancelamento e reenvio. */
  upload: {
    sending: 'Enviando',
    progress: (percent: number): string => `Enviando ${percent}%`,
    failed: 'Não enviada',
    cancel: 'Cancelar envio',
    retry: 'Tentar de novo',
    discard: 'Descartar',
    /** Confirmação do `beforeunload` com upload ativo. */
    leavePageWarning: 'Há arquivos sendo enviados. Se sair agora, o envio para.',

    errors: {
      network: 'Falha de conexão. Tente de novo para continuar de onde parou.',
      sessionDisconnected: 'Sessão desconectada. Reconecte para enviar.',
      rejected: 'Arquivo recusado. Confira o tipo e o tamanho.',
      storageFull: 'Sem espaço para receber o arquivo agora. Tente mais tarde.',
      confirmInProgress: 'Finalizando o envio. Aguarde.',
      generic: 'Não foi possível enviar. Tente de novo.',
    },
  },

  reactions: {
    react: 'Reagir',
    /** `aria-label` do botão de reagir no cluster de ações da bolha. */
    reactToMessage: 'Reagir à mensagem',
    remove: 'Remover reação',
    quickBar: 'Reações rápidas',
    openFullPicker: 'Mais emojis',
    participant: 'Participante',
    /** Autor da reação quando é a própria conta. */
    you: 'Você',

    /** Tooltip do chip: quem reagiu. Lista vazia vira texto neutro. */
    reactorsTooltip: (names: string[]): string =>
      names.length === 0 ? 'Reação' : `${joinNames(names)} reagiu${names.length > 1 ? 'ram' : ''}`,

    /** `aria-label` do chip. Plural resolvido aqui. */
    chipLabel: (emoji: string, count: number): string =>
      `${emoji} ${count} ${count === 1 ? 'reação' : 'reações'}`,

    errors: {
      sendFailed: 'Não foi possível reagir. Tente de novo.',
      sessionDisconnected: 'Sessão desconectada. Reconecte para reagir.',
      rateLimited: 'Muitas reações seguidas. Aguarde um instante.',
    },
  },

  /** Textos internos do seletor completo de emojis. */
  emojiPicker: {
    searchPlaceholder: 'Buscar emoji',
    searchClear: 'Limpar busca',
    categories: {
      suggested: 'Mais usados',
      smileysPeople: 'Carinhas e pessoas',
      animalsNature: 'Animais e natureza',
      foodDrink: 'Comidas e bebidas',
      travelPlaces: 'Viagens e lugares',
      activities: 'Atividades',
      objects: 'Objetos',
      symbols: 'Símbolos',
      flags: 'Bandeiras',
    },
  },
} as const;
