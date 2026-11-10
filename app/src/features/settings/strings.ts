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
      SHEIN: 'Entre de novo na sua conta da Shein (m.shein.com) neste navegador e clique em Sincronizar agora.',
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
      /** Rótulo do ID quando ele vem da sessão (sem campo editável). */
      sessionAffiliateId: 'ID de afiliado',
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
      SHEIN: [
        'Conexão pela extensão, sem senha no painel',
        'Links gerados com a sua conta de afiliado',
        'ID de afiliado lido da sua sessão',
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
      SHEIN: 'Gera links de afiliado com a sessão da sua conta Shein, sincronizada pela extensão.',
    },

    /** Card Shein: 6 estados + reaceite. Texto do aviso em `marketplaceRiskNotice`. */
    shein: {
      chipLocked: 'Fora do seu plano',
      chipReaccept: 'Aceite pendente',
      chipWaiting: 'Aguardando a extensão',
      affiliateIdLabel: 'ID de afiliado',
      affiliateIdMissing: 'ID ainda não lido da sessão',
      activeLabel: 'Ativa',
      lockedTitle: 'Disponível em outros planos',
      lockedHint: 'A integração com a Shein faz parte dos planos abaixo. Faça upgrade para conectar.',
      lockedAction: 'Ver planos',
      lockedTooltip: 'Abre a comparação de planos',
      checkingExtension: 'Verificando a extensão do navegador…',
      noExtensionTitle: 'Instale a extensão do navegador',
      noExtensionHint: 'A conexão com a Shein acontece pela extensão. Instale, recarregue esta página e volte aqui.',
      outdatedTitle: 'Atualize a extensão',
      outdatedHint: 'A versão instalada ainda não conecta a Shein. Atualize pela Chrome Web Store e recarregue a página.',
      installAction: 'Instalar extensão',
      updateAction: 'Atualizar extensão',
      storeTooltip: 'Abre a Chrome Web Store em uma nova aba',
      noLinkTitle: 'Vincule a extensão a este painel',
      noLinkHint: 'A extensão está instalada, mas não está vinculada a você neste painel. Vincule para conectar a Shein.',
      linkAction: 'Vincular extensão',
      linkTooltip: 'Abre o assistente de vínculo da extensão',
      recheckAction: 'Verificar de novo',
      recheckTooltip: 'Consulta a extensão agora',
      readyHint: 'Entre na sua conta da Shein (m.shein.com) neste navegador antes de conectar.',
      connectAction: 'Conectar Shein',
      connectTooltip: 'Lê o aviso de risco e autoriza a extensão a usar a sua sessão da Shein',
      connecting: 'Conectando…',
      waitingTitle: 'Falta um clique na extensão',
      waitingHint:
        'Clique no ícone da extensão na barra do navegador e permita o acesso à Shein. '
        + 'Esta tela atualiza sozinha.',
      waitingCancel: 'Cancelar',
      waitingExpired: 'O pedido de acesso expirou ou foi negado. Clique em Conectar Shein para tentar de novo.',
      connectedSynced: (iso: string) => `Sessão sincronizada em ${formatDateTime(iso)}`,
      syncNow: 'Sincronizar agora',
      syncing: 'Sincronizando…',
      syncTooltip: 'Envia de novo a sua sessão da Shein pela extensão',
      syncDone: 'Sessão da Shein sincronizada.',
      disconnect: 'Desconectar',
      disconnectTooltip: 'Remove a sessão e o ID da Shein e revoga a autorização da extensão',
      disconnectTitle: 'Desconectar a Shein?',
      disconnectDescription:
        'A sessão e o ID de afiliado da Shein são apagados e a extensão para de sincronizar. '
        + 'Os aceites do aviso de risco continuam registrados.',
      disconnectFailed: 'Não foi possível desconectar a Shein. Tente de novo.',
      reacceptTitle: 'O aviso de risco mudou',
      reacceptHint: 'Leia e aceite a nova versão. Até lá, a sincronização e a geração de links da Shein ficam paradas.',
      reacceptAction: 'Ler e aceitar o aviso',
      rejectedHint: 'A Shein recusou a sua sessão. Entre de novo na sua conta da Shein neste navegador e sincronize.',
      noLinkError: 'O vínculo desta extensão não vale mais para a sua conta (ela foi reinstalada ou vinculada a outro usuário). Vincule de novo para continuar.',
      consentErrors: {
        PLAN_FEATURE_UNAVAILABLE: 'A Shein não está liberada no seu plano.',
        MARKETPLACE_RISK_NOT_ACCEPTED: 'Aceite o aviso de risco da Shein para continuar.',
      } as Record<string, string>,
    },

    /** Aviso de risco do marketplace (Shein). Mudou o texto → mude `version` aqui e na API, e o hash do teste. */
    riskNotice: {
      /** Espelho de `MARKETPLACE_RISK_NOTICE_VERSION.SHEIN` (api/.../marketplaceRiskNotice.ts). */
      version: '2026-11-10',
      /** Idioma em que o texto é exibido (gravado com o aceite). */
      locale: 'pt-BR',
      bannerTitle: 'Uso por sua conta e risco',
      bannerSummary:
        'Os termos da SHEIN proíbem ferramentas automatizadas. A SHEIN pode encerrar a sua conta '
        + 'de afiliado e reter comissões.',
      readFull: 'Ler aviso completo',
      readFullTooltip: 'Abre o texto completo do aviso de risco',
      acceptedAt: (iso: string, byMe: boolean) => `Aceito em ${formatDateTime(iso)}${byMe ? ' por você' : ''}`,
      dialogTitle: 'Aviso de risco: integração com a SHEIN',
      /** Texto completo. Travado por hash em `strings.test.ts` junto da `version`. */
      paragraphs: [
        'Os termos do Programa de Afiliados da SHEIN proíbem o uso de bots e de ferramentas automatizadas. '
          + 'Esta integração usa a sessão da sua conta para gerar links e ler dados de produtos de forma automatizada.',
        'A SHEIN pode encerrar a sua conta de afiliado e reter as suas comissões por causa desse uso.',
        'O uso é por sua conta e risco, como titular da conta de afiliado.',
        'A plataforma não se responsabiliza por bloqueio ou encerramento da conta, nem por perda de comissões.',
      ] as readonly string[],
      checkbox: 'Li e assumo o risco',
      confirm: 'Aceitar e conectar',
      confirmOnly: 'Aceitar aviso',
      confirming: 'Registrando aceite…',
      cancel: 'Cancelar',
      close: 'Fechar',
      adminOnly: 'Só um administrador desta conta pode aceitar o aviso.',
      /** Versão da API ≠ versão deste painel (ou 409): aceitar reenviaria o texto velho. */
      staleTitle: 'O aviso foi atualizado',
      staleText: 'O texto do aviso de risco foi atualizado. Recarregue a página para ler a versão atual antes de aceitar.',
      reloadPage: 'Recarregar página',
      reloadPageTooltip: 'Recarrega o painel com o texto atual do aviso',
      acceptFailed: 'Não foi possível registrar o aceite. Tente de novo.',
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
