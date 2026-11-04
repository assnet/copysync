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
    subtitle: 'Conecte suas contas de WhatsApp e Telegram para monitorar grupos e repostar ofertas com o seu link.',
    newSession: 'Nova sessão',
    emptyTitle: 'Conecte sua primeira conta',
    emptyDescription: 'Cada sessão é uma conta de WhatsApp ou Telegram ligada ao painel.',
    emptyAction: 'Conectar minha primeira conta',
    loadError: 'Não foi possível carregar as sessões.',
    created: 'Sessão criada.',
    deleted: 'Sessão excluída.',
    limitsError: 'Não foi possível consultar os limites do plano.',
  },

  channel: {
    whatsapp: 'WhatsApp',
    telegram: 'Telegram',
    whatsappDescription: 'Use seu número e poste ofertas nos seus grupos. Conecte pelo QR Code ou por código.',
    telegramDescription: 'Use sua própria conta, sem bot. O código de acesso chega no app do Telegram.',
    /** Chip "WhatsApp 1/1"; sem limite mostra só o usado. */
    counter: (used: number, limit: number | null) => (limit === null ? `${used}` : `${used}/${limit}`),
    counterTooltip: (name: string, used: number, limit: number | null) =>
      limit === null
        ? `${used} ${used === 1 ? 'sessão' : 'sessões'} de ${name}, sem limite no seu plano`
        : `${used} de ${limit} ${limit === 1 ? 'sessão' : 'sessões'} de ${name} no seu plano`,
    sectionAria: (name: string) => `Sessões de ${name}`,
    /** Barra de uso do plano (leitor de tela). */
    usageAria: (name: string, used: number, limit: number) =>
      `${name}: ${used} de ${limit} ${limit === 1 ? 'sessão usada' : 'sessões usadas'} no seu plano`,
  },

  picker: {
    title: 'Onde você quer postar suas ofertas?',
    subtitle: 'Escolha o canal. Cada um tem o próprio limite de sessões no seu plano.',
    close: 'Fechar',
    atLimit: (name: string) => `Você já usa todas as sessões de ${name} do seu plano. Veja como liberar mais.`,
    notIncluded: (name: string) => `Sessões de ${name} não fazem parte do seu plano. Veja os planos que incluem.`,
    seePlans: 'Ver planos',
    unavailable: 'Indisponível no momento',
    unavailableTooltip: 'A conexão com o Telegram está pausada por alguns instantes. Tente de novo mais tarde.',
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
    stepOf: (current: number, total: number) => `Passo ${current} de ${total}`,
    stepperAria: 'Etapas do assistente',
    back: 'Voltar',
    next: 'Continuar',
    cancel: 'Cancelar',
    finish: 'Concluir',
    createError: 'Não conseguimos criar a sessão agora. Tente de novo em instantes.',
    limitReached: 'Seu plano já usa todas as sessões deste canal.',

    phone: {
      title: 'Qual número vai postar suas ofertas?',
      subtitle: 'Informe o WhatsApp que você vai conectar. Assim confirmamos que a conta certa foi ligada.',
      label: 'Número do WhatsApp',
      placeholder: '11987654321',
      howToTitle: 'Como preencher',
      howToBody: 'Só números, com DDD. Ex.: 11987654321',
      howToFormat: 'Formato: DDD + número',
      preview: (formatted: string) => `Número: ${formatted}`,
      invalid: 'Confira o número: 10 ou 11 dígitos, com o DDD na frente.',
      rejected: 'Este número não foi aceito. Confira o DDD e os dígitos.',
    },

    name: {
      title: 'Como você quer chamar esta sessão?',
      subtitle: 'Um nome curto ajuda a achar esta conta no monitoramento e nos disparos.',
      label: 'Nome da sessão',
      placeholder: 'Ofertas da loja',
      helper: 'Só você vê este nome. Ex.: Ofertas da loja',
      tooShort: 'Use pelo menos 2 caracteres.',
      counter: (len: number, max: number) => `${len}/${max}`,
      /** Rótulo da prévia do cartão no passo Nome. */
      previewLabel: 'Como vai aparecer',
      submit: 'Criar e conectar',
    },
  },

  telegram: {
    title: 'Nova sessão do Telegram',
    steps: ['Telefone', 'Nome', 'Conectar', 'Pronto'] as const,

    phone: {
      title: 'Qual é o telefone da sua conta do Telegram?',
      subtitle: 'Use o mesmo número com que você entra no Telegram. É nele que o código vai chegar.',
      label: 'Telefone com DDI',
      placeholder: '+55 11 98765-4321',
      howToTitle: 'Como preencher',
      howToBody: 'Com o código do país. Ex.: +55 11 98765-4321',
      howToFormat: 'Sem o código do país, consideramos +55 (Brasil).',
      preview: (formatted: string) => `Telefone: ${formatted}`,
      invalid: 'Confira o telefone: código do país, DDD e número.',
      rejected: 'O Telegram não aceitou este telefone. Confira o código do país e os dígitos.',
    },

    name: {
      title: 'Como você quer chamar esta sessão?',
      subtitle: 'Um nome curto ajuda a reconhecer esta conta no painel.',
      placeholder: 'Canal de ofertas',
      helper: 'Só você vê este nome. Ex.: Canal de ofertas',
      submit: 'Criar sessão',
    },

    connect: {
      title: 'Entre na sua conta do Telegram',
      codeIntro:
        'O Telegram vai mandar um código de acesso para o seu app, no celular ou no computador. Normalmente não chega por SMS.',
      sendCode: 'Enviar código para o meu Telegram',
      sending: 'Enviando…',
      sentTo: (phone: string) => `Pronto, enviamos o código. Abra o Telegram de ${phone} e veja a conversa "Telegram".`,
      codeLabel: 'Código recebido no Telegram',
      codeHelper: (len: number) => `${len} dígitos, na conversa oficial "Telegram" do app.`,
      signIn: 'Entrar',
      checking: 'Conferindo…',
      resend: 'Não chegou? Reenviar código',
      resendIn: (seconds: number) => `Reenviar em ${seconds} s`,
      resendAria: 'Espera para reenviar o código',
      passwordTitle: 'Sua conta tem verificação em duas etapas',
      passwordIntro:
        'Digite a senha que você criou no Telegram para proteger a conta. Ela não é o código que acabou de chegar.',
      passwordLabel: 'Senha da verificação em duas etapas',
      passwordHelper: 'Usamos a senha só para entrar e não guardamos.',
      passwordSubmit: 'Confirmar e entrar',
      showPassword: 'Mostrar senha',
      hidePassword: 'Ocultar senha',
      securityNote:
        'Seu código e sua senha não ficam salvos. Você pode encerrar esta sessão quando quiser, pelo painel ou em Telegram › Dispositivos.',
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
        `O Telegram pediu uma pausa de ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}. Depois disso, tente de novo.`,
      floodWaitAria: 'Espera pedida pelo Telegram',
      floodWaitDone: 'Pode tentar de novo',
      errors: {
        codeInvalid: 'Esse código não confere. Veja de novo a mensagem no app do Telegram.',
        codeExpired: 'Este código expirou. Peça um novo.',
        passwordInvalid: 'Senha incorreta. É a senha de duas etapas que você criou no Telegram.',
        phoneInvalid: 'O Telegram não aceitou este telefone. Volte e confira o número.',
        engineDisabled: 'A conexão com o Telegram está pausada por alguns instantes. Tente mais tarde.',
        sendFailed: 'Não conseguimos enviar o código. Tente de novo.',
        generic: 'Algo não deu certo. Tente de novo.',
      },
    },

    done: {
      title: 'Telegram conectado',
      body: 'Sua conta já recebe e envia mensagens pelo painel. O monitoramento de grupos do Telegram chega em breve.',
      connectedAs: 'Conta conectada',
      mismatch: (phone: string) =>
        `Conectamos a conta de outro telefone (${phone}). Se não era essa, desconecte e conecte a conta certa.`,
    },
  },

  connect: {
    title: 'Falta pouco: conecte seu WhatsApp',
    subtitle: 'Faça como em qualquer aparelho novo. Seu celular continua funcionando normalmente.',
    dialogTitle: (name: string) => `Conectar “${name}”`,
    qrSteps: [
      'Abra o WhatsApp no celular',
      'Toque em Menu ⋮ ou Configurações',
      'Toque em Aparelhos conectados',
      'Toque em Conectar um aparelho',
      'Aponte a câmera para o QR Code',
    ] as const,
    qrAlt: 'Código QR para conectar o WhatsApp',
    preparing: 'Preparando o código…',
    expiresIn: (time: string) => `Este código expira em ${time}`,
    refreshing: 'Gerando um novo código…',
    expired: 'Este código expirou. Gere outro em um clique.',
    waiting: 'Esperando você usar o código no celular…',
    regenerate: 'Gerar novo código',
    usePairing: 'Não consigo escanear: usar código de pareamento',
    useQr: 'Prefiro escanear o QR Code',
    pairingTitle: 'Digite este código no seu celular',
    pairingSteps: [
      'Abra o WhatsApp no celular',
      'Toque em Aparelhos conectados',
      'Toque em Conectar um aparelho',
      'Toque em Conectar com número de telefone',
      'Digite o código abaixo',
    ] as const,
    pairingAria: (code: string) => `Código de pareamento: ${code.split('').join(' ')}`,
    pairingLoading: 'Gerando seu código…',
    pairingError: 'Não conseguimos gerar o código. Tente de novo.',
    copy: 'Copiar código',
    copied: 'Copiado',
    failed: 'A conexão não foi concluída. Gere um novo código e tente de novo.',
    loggedOut:
      'A conexão foi desfeita no celular. Gere um novo código. O histórico desta sessão continua salvo.',
    /** O polling segue depois da falha (useSessionConnection), então "tentamos de novo" é verdade. */
    fetchError: 'Não conseguimos verificar a conexão agora. Vamos tentar de novo sozinhos.',
    actionError: 'Não conseguimos gerar um novo código. Tente de novo.',
  },

  done: {
    title: 'WhatsApp conectado',
    body: 'Agora escolha os grupos que você quer acompanhar. As ofertas deles podem sair com o seu link.',
    connectedAs: 'Número conectado',
    nextMonitoring: 'Ir para o Monitoramento',
    nextLater: 'Fazer isso depois',
    mismatch: (phone: string) =>
      `Conectamos outro número (${phone}). Se não era esse, desconecte e conecte o número certo.`,
  },
};
