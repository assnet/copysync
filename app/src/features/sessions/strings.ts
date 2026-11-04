/**
 * Textos de sessões (lista, cartão, assistente de nova sessão e conexão) — mesmas regras de
 * `features/settings/strings.ts`:
 * - chaves semânticas, nunca o texto como chave
 * - frase com variável é função tipada; componente nunca concatena pedaços
 * - sem nome de marca do produto; o termo é sempre "sessão", nunca "instância"
 */
import type { SessionStatus } from '@/types/api.types';

export const sessionStrings = {
  page: {
    title: 'Sessões',
    subtitle: 'Conecte e acompanhe as contas de WhatsApp e Telegram da sua equipe.',
    newSession: 'Nova sessão',
    emptyTitle: 'Nenhuma sessão criada ainda',
    emptyDescription: 'Crie uma sessão para conectar uma conta de WhatsApp ou Telegram ao painel.',
    emptyAction: 'Criar primeira sessão',
    loadError: 'Não foi possível carregar as sessões.',
    created: 'Sessão criada.',
    deleted: 'Sessão excluída.',
    limitsError: 'Não foi possível consultar os limites do plano.',
  },

  channel: {
    whatsapp: 'WhatsApp',
    telegram: 'Telegram',
    whatsappDescription: 'Conecte um número pelo QR Code ou por código de pareamento.',
    telegramDescription: 'Conecte sua conta com o código que chega no app ou pelo QR Code.',
    /** Chip "WhatsApp 1/1"; sem limite mostra só o usado. */
    counter: (used: number, limit: number | null) => (limit === null ? `${used}` : `${used}/${limit}`),
    counterTooltip: (name: string, used: number, limit: number | null) =>
      limit === null
        ? `${used} ${used === 1 ? 'sessão' : 'sessões'} de ${name}, sem limite no seu plano`
        : `${used} de ${limit} ${limit === 1 ? 'sessão' : 'sessões'} de ${name} no seu plano`,
    sectionAria: (name: string) => `Sessões de ${name}`,
  },

  picker: {
    title: 'Qual canal você quer conectar?',
    subtitle: 'Cada canal tem seu próprio limite de sessões no plano.',
    close: 'Fechar',
    atLimit: (name: string) => `Seu plano já usa todas as sessões de ${name}. Veja como ter mais.`,
    notIncluded: (name: string) => `Seu plano atual não inclui sessões de ${name}. Veja como ter.`,
    unavailable: 'Indisponível no momento',
    unavailableTooltip: 'A conexão com o Telegram está temporariamente desligada. Tente mais tarde.',
    comingSoon: 'Em breve',
  },

  status: {
    PENDING: 'Pendente',
    CONNECTING: 'Conectando…',
    AWAITING_QR: 'Aguardando QR',
    AWAITING_PAIRING: 'Aguardando código',
    AWAITING_CODE: 'Aguardando código',
    AWAITING_PASSWORD: 'Aguardando senha',
    CONNECTED: 'Conectado',
    DISCONNECTED: 'Desconectado',
    LOGGED_OUT: 'Desvinculado',
    FAILED: 'Falha',
  } satisfies Record<SessionStatus, string>,

  card: {
    connect: 'Conectar',
    reconnect: 'Reconectar nesta mesma sessão — mantém histórico e mídia',
    disconnect: 'Desconectar',
    logout: 'Desvincular do WhatsApp — histórico e mídia ficam nesta sessão',
    logoutTelegram: 'Encerrar a sessão no Telegram — histórico fica nesta sessão',
    showConnection: 'Ver código de conexão',
    delete: 'Excluir sessão',
    updatedAt: (date: string) => `Atualizado ${date}`,
    genericError: 'Ocorreu um erro. Tente de novo.',
    deleteError: 'Não foi possível excluir a sessão.',
    mismatchChip: 'Outro número',
    mismatchTooltip: (declared: string) =>
      `O WhatsApp conectado não é o número informado (${declared}).`,
    mismatchTooltipTelegram: (declared: string) =>
      `A conta conectada não é do telefone informado (${declared}).`,
    deleteTitle: 'Excluir sessão',
    deleteMessage: (name: string) =>
      `Tem certeza que deseja excluir a sessão “${name}”? Esta ação não pode ser desfeita.`,
    cancel: 'Cancelar',
    confirmDelete: 'Excluir',
  },

  wizard: {
    title: 'Nova sessão',
    close: 'Fechar',
    steps: ['Número', 'Nome', 'Conectar', 'Pronto'] as const,
    back: 'Voltar',
    next: 'Continuar',
    cancel: 'Cancelar',
    finish: 'Concluir',
    createError: 'Não foi possível criar a sessão. Tente de novo.',
    limitReached: 'Seu plano não comporta mais sessões deste canal.',

    phone: {
      title: 'Qual é o seu número do WhatsApp?',
      label: 'Número do WhatsApp',
      placeholder: '11987654321',
      howToTitle: 'Como preencher',
      howToBody: 'Digite só números, com DDD. Ex.: 11987654321',
      howToFormat: 'Formato: DDD + número',
      preview: (formatted: string) => `Vamos usar: ${formatted}`,
      invalid: 'Confira o número: são 10 ou 11 dígitos, com o DDD na frente.',
      rejected: 'Este número não foi aceito. Confira o DDD e os dígitos.',
    },

    name: {
      title: 'Dê um nome para esta sessão',
      label: 'Nome da sessão',
      placeholder: 'Ofertas da loja',
      helper: 'Serve só para você reconhecer esta conexão. Ex.: Ofertas da loja',
      tooShort: 'Use pelo menos 2 caracteres.',
      counter: (len: number, max: number) => `${len}/${max}`,
      submit: 'Criar e conectar',
    },
  },

  telegram: {
    title: 'Nova sessão do Telegram',
    steps: ['Telefone', 'Nome', 'Conectar', 'Pronto'] as const,

    phone: {
      title: 'Qual é o telefone da sua conta do Telegram?',
      label: 'Telefone com DDI',
      placeholder: '+55 11 98765-4321',
      howToTitle: 'Como preencher',
      howToBody: 'O mesmo número cadastrado no seu Telegram, com o código do país. Ex.: +55 11 98765-4321',
      howToFormat: 'Sem DDI, assumimos +55 (Brasil).',
      preview: (formatted: string) => `Vamos usar: ${formatted}`,
      invalid: 'Confira o telefone: código do país + DDD + número.',
      rejected: 'O Telegram não aceitou este telefone. Confira o DDI e os dígitos.',
    },

    name: {
      title: 'Dê um nome para esta sessão',
      placeholder: 'Canal de ofertas',
      helper: 'Serve só para você reconhecer esta conexão. Ex.: Canal de ofertas',
      submit: 'Criar sessão',
    },

    connect: {
      title: 'Conecte seu Telegram',
      codeIntro: 'Vamos mandar um código de login para o seu app do Telegram. Você digita aqui e pronto.',
      sendCode: 'Enviar código',
      sending: 'Enviando…',
      sentTo: (phone: string) => `Código enviado para o Telegram de ${phone}.`,
      codeLabel: 'Código que chegou no seu Telegram',
      codeHelper: (len: number) => `${len} dígitos. Chega como mensagem do Telegram, não por SMS.`,
      signIn: 'Entrar',
      checking: 'Conferindo…',
      resend: 'Reenviar código',
      resendIn: (seconds: number) => `Reenviar em ${seconds} s`,
      resendAria: 'Espera para reenviar o código',
      passwordTitle: 'Sua conta tem verificação em duas etapas',
      passwordLabel: 'Senha do Telegram',
      passwordHelper: 'É a senha de verificação em duas etapas do Telegram, não o código.',
      passwordSubmit: 'Confirmar senha',
      useQr: 'Prefiro escanear o QR Code',
      useCode: 'Prefiro receber um código',
      qrSteps: [
        'Abra o Telegram no celular',
        'Toque em Configurações',
        'Toque em Dispositivos',
        'Toque em Conectar dispositivo',
        'Aponte a câmera para o código',
      ] as const,
      qrAlt: 'Código QR para conectar o Telegram',
      floodWait: (minutes: number) =>
        `O Telegram pediu para aguardar ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} antes de tentar de novo.`,
      floodWaitAria: 'Espera pedida pelo Telegram',
      floodWaitDone: 'Pode tentar de novo',
      errors: {
        codeInvalid: 'Código incorreto. Confira no app do Telegram.',
        codeExpired: 'Este código expirou. Peça um novo.',
        passwordInvalid: 'Senha incorreta. Tente de novo.',
        phoneInvalid: 'O Telegram não aceitou este telefone.',
        engineDisabled: 'A conexão com o Telegram está indisponível no momento.',
        sendFailed: 'Não foi possível enviar o código. Tente de novo.',
        generic: 'Não foi possível concluir. Tente de novo.',
      },
    },

    done: {
      body: 'Sua conta do Telegram está conectada e pronta para usar.',
      connectedAs: 'Conta conectada',
      mismatch: (phone: string) =>
        `A conta conectada é de outro telefone (${phone}). Se não for o que você queria, desconecte e conecte a conta certa.`,
    },
  },

  connect: {
    title: 'Conecte seu WhatsApp',
    dialogTitle: (name: string) => `Conectar “${name}”`,
    qrSteps: [
      'Abra o WhatsApp no celular',
      'Toque em Menu ⋮ ou Configurações',
      'Toque em Aparelhos conectados',
      'Toque em Conectar um aparelho',
      'Aponte a câmera para o código',
    ] as const,
    qrAlt: 'Código QR para conectar o WhatsApp',
    preparing: 'Preparando o código…',
    expiresIn: (time: string) => `Este código expira em ${time}`,
    refreshing: 'Gerando um novo código…',
    expired: 'O código expirou.',
    waiting: 'Aguardando conexão…',
    regenerate: 'Gerar novo código',
    usePairing: 'Prefiro conectar com código',
    useQr: 'Prefiro escanear o QR Code',
    pairingTitle: 'Digite este código no celular',
    pairingSteps: [
      'Abra o WhatsApp no celular',
      'Toque em Aparelhos conectados',
      'Toque em Conectar um aparelho',
      'Toque em Conectar com número de telefone',
      'Digite o código abaixo',
    ] as const,
    pairingLoading: 'Gerando seu código…',
    pairingError: 'Não foi possível gerar o código. Tente de novo.',
    copy: 'Copiar código',
    copied: 'Copiado',
    failed: 'A conexão não foi concluída. Gere um novo código para tentar de novo.',
    loggedOut:
      'A conexão foi desfeita no celular. Gere um novo código — o histórico desta sessão é preservado.',
    fetchError: 'Não foi possível consultar a conexão agora.',
    actionError: 'Não foi possível gerar um novo código. Tente de novo.',
  },

  done: {
    title: 'Tudo pronto!',
    body: 'Seu WhatsApp está conectado e pronto para usar.',
    connectedAs: 'Número conectado',
    mismatch: (phone: string) =>
      `O WhatsApp conectado é de outro número (${phone}). Se não for o que você queria, desconecte e conecte o número certo.`,
  },
};
