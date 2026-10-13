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
    /** Botão que abre o seletor de emoji (tooltip e `aria-label`). */
    emoji: 'Emoji',
    /** Tooltip do botão ainda desabilitado enquanto o recurso não está ligado. */
    attachSoon: 'Anexar (em breve)',
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

  /** Popover de autocompletar ao digitar @ num grupo (MessageComposer). */
  mention: {
    ariaLabel: 'Marcar participante',
    noResults: 'Nenhum participante encontrado',
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
    /** Tooltip do microfone com a conversa encerrada. */
    conversationClosed: 'Conversa encerrada. Reabra para gravar áudio',

    errors: {
      permissionDenied: 'Acesso ao microfone bloqueado. Libere nas configurações do navegador.',
      noMicrophone: 'Nenhum microfone encontrado. Conecte um e tente de novo.',
      microphoneBusy: 'O microfone está em uso por outro aplicativo. Feche-o e tente de novo.',
      insecureContext: 'Gravar áudio exige conexão segura (HTTPS).',
      unsupported: 'Este navegador não permite gravar áudio.',
      generic: 'Não foi possível gravar. Tente de novo.',
    },
  },

  /** Bolha de áudio recebido/enviado: player com forma de onda. */
  audioPlayer: {
    voiceNote: 'Mensagem de voz',
    audio: 'Áudio',
    /** Placeholder quando o arquivo não carregou. */
    unavailable: 'Áudio indisponível',
    play: 'Reproduzir áudio',
    pause: 'Pausar áudio',
    /** `aria-label` da onda (`role="slider"`). */
    seek: 'Posição do áudio',
    /** `aria-valuetext` da onda: posição atual e total. */
    position: (currentSeconds: number, totalSeconds: number): string =>
      `${spokenDuration(currentSeconds)} de ${spokenDuration(totalSeconds)}`,
    /** Botão da duração: alterna a velocidade. `rateLabel` já formatado, ex.: "1,5×". */
    speed: (rateLabel: string): string => `Velocidade de reprodução: ${rateLabel}. Clique para alterar`,
    /** Foto de quem enviou (`alt` do avatar). */
    senderAvatar: 'Foto de quem enviou',
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

  /** Cartão de documento na bolha: nome, tipo/tamanho, abrir e baixar. */
  documentCard: {
    open: 'Abrir',
    download: 'Baixar',
    /** Nome exibido quando a mensagem não trouxe nome nem URL legível. */
    fallbackName: 'Documento',
    /** Extensão desconhecida no ícone e no subtítulo. */
    unknownType: 'ARQUIVO',
    /** `ZIP • 2 MB`; sem tamanho, só a extensão. */
    subtitle: (extension: string, sizeLabel: string | null): string =>
      sizeLabel ? `${extension} • ${sizeLabel}` : extension,
    /** Rótulo acessível do cartão inteiro. */
    label: (fileName: string, sizeLabel: string | null): string =>
      sizeLabel ? `Documento ${fileName}, ${sizeLabel}` : `Documento ${fileName}`,
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

  /** Listas do painel: chip ▾ da barra de filtros e diálogo de nova lista. */
  lists: {
    /** `aria-label` do chip ▾ e título do menu. */
    menuLabel: 'Listas',
    /** Rótulo do chip enquanto nenhuma lista está filtrando. */
    chip: 'Listas',
    newList: 'Nova lista',
    /** Item do menu quando nenhuma conversa tem lista ainda. */
    empty: 'Nenhuma lista ainda',
    /** Item de lista no menu: nome e quantidade de conversas. */
    menuItem: (name: string, count: number): string => `${name}, ${countOf(count, 'conversa', 'conversas')}`,
    /** Chip ativo com o filtro de lista: nome e contagem. */
    activeChip: (name: string, count: number): string => (count > 0 ? `${name} ${count}` : name),
    /** `aria-label` do ⋮ que abre editar/excluir de uma lista. */
    itemActions: (name: string): string => `Ações da lista ${name}`,
    editList: 'Editar lista',
    deleteList: 'Excluir lista',
    /** Confirmação de exclusão: o nome some de todas as conversas do tenant, sem apagar conversa. */
    deleteTitle: 'Excluir lista?',
    deleteConfirm: (name: string, count: number): string =>
      count === 0
        ? `A lista ${name} está vazia e será excluída.`
        : `A lista ${name} será removida de ${countOf(count, 'conversa', 'conversas')}. As conversas continuam no painel.`,
    deleteAction: 'Excluir',

    dialog: {
      title: 'Nova lista',
      editTitle: 'Editar lista',
      /** A lista tem registro próprio: pode nascer vazia e receber conversas depois. */
      intro: 'Dê um nome e, se quiser, escolha as conversas que vão para a lista.',
      nameLabel: 'Nome da lista',
      namePlaceholder: 'Ex.: Auto peças',
      searchLabel: 'Buscar conversa',
      searchPlaceholder: 'Buscar por nome ou número',
      conversationsLabel: 'Conversas',
      noResults: 'Nenhuma conversa encontrada.',
      group: 'Grupo',
      /** Contador abaixo da lista. Plural resolvido aqui. */
      selectedCount: (count: number): string =>
        count === 0 ? 'Nenhuma conversa selecionada' : `${countOf(count, 'conversa selecionada', 'conversas selecionadas')}`,
      cancel: 'Cancelar',
      create: 'Criar',
      save: 'Salvar',
      /** Tooltip do Criar/Salvar desabilitado: só o nome é obrigatório. */
      createHint: 'Informe um nome para a lista',
      errors: {
        empty: 'Informe um nome para a lista.',
        tooLong: (max: number): string => `Use até ${countOf(max, 'caractere', 'caracteres')}.`,
        duplicate: 'Já existe uma lista com esse nome.',
      },
    },

    /** Snackbar das operações no catálogo (criar, renomear, excluir, carregar). Sem fallback: nada muda localmente. */
    errors: {
      loadFailed: 'Não foi possível carregar as listas. Tente de novo.',
      createFailed: (name: string): string => `Não foi possível criar a lista ${name}. Tente de novo.`,
      renameFailed: (name: string): string => `Não foi possível renomear a lista ${name}. Tente de novo.`,
      deleteFailed: (name: string): string => `Não foi possível excluir a lista ${name}. Tente de novo.`,
      /** 409 da API: outra lista já tem o nome pedido. */
      nameExists: (name: string): string => `Já existe uma lista chamada ${name}.`,
    },
    /** Snackbar quando parte das conversas não entrou na lista. */
    partialFailure: (name: string, failed: number): string =>
      `${countOf(failed, 'conversa não entrou', 'conversas não entraram')} na lista ${name}. Tente de novo.`,
    /** Snackbar quando parte das conversas não foi regravada ao editar ou excluir. */
    updatePartialFailure: (name: string, failed: number): string =>
      `${countOf(failed, 'conversa não foi atualizada', 'conversas não foram atualizadas')} na lista ${name}. Tente de novo.`,
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
