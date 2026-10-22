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
    navAccount: 'Minha conta',
    navAffiliateCredentials: 'Credenciais de afiliado',
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
    pageNotice:
      'A ferramenta usa estas chaves para converter links de produtos em links de afiliado da sua conta. '
      + 'Os valores secretos são guardados cifrados e não voltam a ser exibidos depois de salvos.',
    loadError: 'Não foi possível carregar as credenciais.',
    retry: 'Tentar novamente',

    statusConfigured: 'Configurado',
    statusNotConfigured: 'Não configurado',
    statusInactive: 'Inativo',
    idPending: 'ID pendente',
    secretSaved: 'Salvo',
    notInformed: 'Não informado',

    configure: 'Configurar',
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
