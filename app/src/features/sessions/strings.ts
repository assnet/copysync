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
    subtitle: 'Conecte e acompanhe os números de WhatsApp da sua equipe.',
    newSession: 'Nova sessão',
    emptyTitle: 'Nenhuma sessão criada ainda',
    emptyDescription: 'Crie uma sessão para conectar um número de WhatsApp ao painel.',
    emptyAction: 'Criar primeira sessão',
    loadError: 'Não foi possível carregar as sessões.',
    created: 'Sessão criada.',
    deleted: 'Sessão excluída.',
  },

  status: {
    PENDING: 'Pendente',
    CONNECTING: 'Conectando…',
    AWAITING_QR: 'Aguardando QR',
    AWAITING_PAIRING: 'Aguardando código',
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
    showConnection: 'Ver código de conexão',
    delete: 'Excluir sessão',
    updatedAt: (date: string) => `Atualizado ${date}`,
    genericError: 'Ocorreu um erro. Tente de novo.',
    deleteError: 'Não foi possível excluir a sessão.',
    mismatchChip: 'Outro número',
    mismatchTooltip: (declared: string) =>
      `O WhatsApp conectado não é o número informado (${declared}).`,
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
