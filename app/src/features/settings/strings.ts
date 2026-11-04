/**
 * Textos de Configurações (conta, senha e credenciais de afiliado), centralizados até o
 * painel ter uma lib de i18n — mesmas regras de `features/chat/strings.ts`:
 * - chaves semânticas, nunca o texto como chave
 * - frase com variável é função tipada; componente nunca concatena pedaços
 * - sem nome de marca do produto (usar "a ferramenta")
 */

const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Data/hora curta da sessão; ISO inválido cai no próprio texto para não exibir "Invalid Date". */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date);
}

export const settingsStrings = {
  layout: {
    title: 'Configurações',
    navSessions: 'Sessões',
    navAccount: 'Minha conta',
    navAi: 'Inteligência artificial',
  },

  account: {
    title: 'Minha conta',
    subtitle: 'Visualize seus dados e gerencie a segurança da conta',
    personalData: 'Dados pessoais',
    nameLabel: 'Nome',
    emailLabel: 'E-mail',
    security: 'Segurança',
    securitySubtitle: 'Gerencie a senha de acesso ao painel',
    changePassword: 'Alterar senha',
  },

  password: {
    breadcrumbAccount: 'Minha conta',
    title: 'Alterar senha',
    subtitle: 'Defina uma nova senha para sua conta',
    cardTitle: 'Nova senha',
    newPasswordLabel: 'Nova senha',
    confirmPasswordLabel: 'Confirmar nova senha',
    mismatch: 'As senhas não coincidem',
    success: 'Senha alterada com sucesso.',
    genericError: 'Erro ao alterar senha',
    requirementsTitle: 'Requisitos da senha:',
    submit: 'Alterar senha',
    showPassword: 'Mostrar senha',
    hidePassword: 'Ocultar senha',
  },

  affiliate: {
    pageTitle: 'Credenciais de afiliado',
    pageSubtitle: 'Conecte suas contas de afiliado para gerar links com a sua comissão',
    /** Nome do carrossel de marketplaces no mobile (leitor de tela). */
    carouselLabel: 'Marketplaces',
    pageNotice:
      'A ferramenta usa estas chaves para converter links de produtos em links de afiliado da sua conta. '
      + 'Os valores secretos são guardados cifrados e não voltam a ser exibidos depois de salvos.',
    loadError: 'Não foi possível carregar as credenciais.',
    retry: 'Tentar novamente',

    statusConfigured: 'Configurado',
    statusNotConfigured: 'Não configurado',
    statusInactive: 'Inativo',
    statusRejected: 'Recusada',
    rejectedSince: (iso: string) => `A loja recusou esta credencial em ${formatDateTime(iso)}. O monitoramento pausou as ofertas desta loja.`,
    rejectedHint: {
      MERCADO_LIVRE: 'Entre de novo na sua conta do Mercado Livre pela extensão e sincronize a sessão.',
      SHOPEE: 'Salve um Secret novo (ou corrija o App ID) para liberar a loja de novo.',
      AMAZON: 'Confira o ID de rastreamento e salve de novo.',
    } as Record<string, string>,
    backToMonitoring: 'Voltar ao monitoramento',
    idPending: 'ID pendente',
    secretSaved: 'Salvo',
    notInformed: 'Não informado',

    configure: 'Configurar',
    connect: (marketplace: string) => `Conectar ${marketplace}`,
    edit: 'Editar',
    remove: 'Remover',
    removeTooltip: 'Remover credencial',
    activeLabel: 'Ativa',
    activateTooltip: 'Ativar credencial',
    deactivateTooltip: 'Desativar credencial sem apagar os dados',

    sessionSynced: (iso: string) => `Sessão sincronizada em ${formatDateTime(iso)}`,
    sessionMissing:
      'Instale ou abra a extensão do navegador e entre com a sua conta do Mercado Livre para sincronizar a sessão.',

    removeTitle: (marketplace: string) => `Remover credencial de ${marketplace}?`,
    removeDescription: 'Os links deixam de usar esta conta até você configurar a credencial de novo.',
    removeBrowserSessionDescription:
      'Desconecte a extensão do navegador antes de remover. Se ela continuar conectada, '
      + 'a próxima sincronização recria esta credencial.',
    removeConfirm: 'Remover',
    cancel: 'Cancelar',

    dialogCreateTitle: (marketplace: string) => `Configurar ${marketplace}`,
    dialogEditTitle: (marketplace: string) => `Editar ${marketplace}`,
    save: 'Salvar',
    secretKeepPlaceholder: 'Vazio mantém o atual',
    showSecret: 'Mostrar valor',
    hideSecret: 'Ocultar valor',
    fieldRequired: (label: string) => `Informe ${label.toLowerCase()}.`,
    fieldInvalid: (label: string) => `${label} em formato inválido.`,
    closeDialog: 'Fechar',
    fieldValid: 'Formato válido',
    dialogSubtitle: {
      SHOPEE: 'Informe o App ID e o Secret da Open API para gerar links curtos com a sua comissão.',
      AMAZON: 'Informe o seu ID de rastreamento para os links da Amazon saírem com a sua comissão.',
    } as Record<string, string>,
    guideTitle: (marketplace: string) => `Onde encontrar na ${marketplace}`,
    guideSteps: {
      SHOPEE: [
        'Entre no painel de afiliados da Shopee.',
        'Abra o menu Open API e crie (ou escolha) o seu app.',
        'Copie o App ID e o Secret do app.',
        'Cole nos campos abaixo e salve.',
      ],
      AMAZON: [
        'Entre no Amazon Associados com a sua conta.',
        'O ID padrão aparece no topo da página, ao lado do seu e-mail.',
        'Para usar outro, abra Gerenciar IDs de rastreamento.',
        'Copie o ID (formato minhaloja-20) e cole abaixo.',
      ],
    } as Record<string, readonly string[]>,
    guideOpen: (program: string) => `Abrir ${program}`,
    guideOpenTooltip: 'Abre em uma nova aba',
    guideHelp: {
      SHOPEE: 'Sem acesso à Open API? Peça a liberação ao suporte da Shopee.',
    } as Record<string, string>,
    guideHelpLink: 'Pedir liberação',
    linkPreviewLabel: 'Seus links ficam assim',
    dialogNote: {
      SHOPEE: 'O Secret só é usado no servidor, para assinar cada chamada à API da Shopee.',
      AMAZON: 'Não precisa de chave secreta: o ID só é adicionado aos links que você publica.',
    } as Record<string, string>,

    fields: {
      shopeeAppId: 'App ID',
      shopeeAppIdHelp: 'Número do app no painel de afiliados da Shopee (Open API).',
      shopeeSecret: 'Secret',
      shopeeSecretHelp: 'Chave secreta do mesmo app. Fica cifrada após salvar.',
      mercadoLivreTag: 'Etiqueta de afiliado',
      mercadoLivreTagHelp: 'Valor que aparece em matt_word nos seus links de afiliado.',
      amazonTag: 'ID de rastreamento',
      amazonTagHelp: 'Termina com hífen e dois dígitos, por exemplo minhaloja-20.',
    },

    summaryNone: 'Nenhum marketplace conectado ainda',
    summarySome: (connected: number, total: number) => `${connected} de ${total} marketplaces conectados`,
    summaryAll: 'Todos os marketplaces conectados',
    summaryNoneHint: 'Conecte o primeiro e a ferramenta passa a trocar os links pelos seus.',
    summarySomeHint: 'Conecte os demais para ganhar comissão em mais lojas.',
    summaryAllHint: 'Seus links já saem com a sua comissão em todas as lojas.',
    summaryProgressLabel: 'Marketplaces conectados',
    marketplaceConnected: (marketplace: string) => `${marketplace} conectado`,
    marketplacePending: (marketplace: string) => `${marketplace} não conectado`,
    howItWorks: 'Como funciona',
    steps: [
      { title: 'Conecte sua conta', text: 'Informe os dados do seu programa de afiliados.' },
      { title: 'A ferramenta troca os links', text: 'Links de produtos viram links com a sua etiqueta.' },
      { title: 'Você recebe a comissão', text: 'As vendas caem direto na sua conta de afiliado.' },
    ],
    stepLabel: (n: number) => `Passo ${n}`,

    providerHighlights: {
      SHOPEE: [
        'Assinatura segura em cada chamada à API',
        'Secret guardado cifrado',
        'Comissão rastreada na sua conta',
      ],
      MERCADO_LIVRE: [
        'Login feito uma vez, pela extensão',
        'Etiqueta em todos os links compartilhados',
        'Sem chave de API para cadastrar',
      ],
      AMAZON: [
        'Formato do ID conferido antes de salvar',
        'Sem chave secreta para cadastrar',
        'Links prontos para compartilhar nos grupos',
      ],
    },

    providerDescriptions: {
      SHOPEE: 'Gera links curtos de afiliado pela Open API da Shopee.',
      MERCADO_LIVRE: 'Usa a sua etiqueta e a sessão sincronizada pela extensão do navegador.',
      AMAZON: 'Adiciona o seu ID de rastreamento do programa de associados aos links.',
    },

    errors: {
      AFFILIATE_CREDENTIAL_INVALID: 'Algum campo não foi aceito. Confira os valores e tente de novo.',
      AFFILIATE_CREDENTIAL_NOT_FOUND: 'Esta credencial não existe mais. Atualize a página.',
      SECRET_CIPHER_UNAVAILABLE:
        'O armazenamento seguro de chaves está indisponível no momento. Tente mais tarde ou fale com o suporte.',
      generic: 'Não foi possível concluir a ação. Tente de novo.',
    } as Record<string, string>,
  },
} as const;

/** Mensagem amigável para erro vindo do `apiClient` (que anexa `code`). */
export function affiliateErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  const { errors } = settingsStrings.affiliate;
  return (typeof code === 'string' && errors[code]) || errors.generic;
}
