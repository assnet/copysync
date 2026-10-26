/**
 * Textos de IA (página da plataforma para super admin e página do cliente em Configurações).
 * Mesmas regras de `features/settings/strings.ts`:
 * - chaves semânticas; frase com variável é função tipada
 * - sem nome de marca do produto (usar "a ferramenta")
 * - nomes de provedores de IA são de terceiros e podem aparecer
 */

export const aiStrings = {
  admin: {
    navLabel: 'IA da plataforma',
    pageTitle: 'Inteligência artificial (plataforma)',
    pageSubtitle: 'Decida como os clientes usam IA e quais provedores a ferramenta usa por padrão.',
    modesTitle: 'Como os clientes usam IA',
    modesSubtitle: 'Pelo menos uma opção precisa ficar ligada.',
    platformSwitch: 'IA da ferramenta para os clientes',
    platformSwitchHelp: 'Os clientes usam os provedores abaixo, sem configurar nada.',
    tenantKeysSwitch: 'Clientes podem usar a própria chave',
    tenantKeysSwitchHelp: 'Quando a IA da ferramenta não estiver disponível, o cliente pode cadastrar uma chave dele.',
    lastModeLocked: 'Pelo menos uma opção precisa ficar ligada',
    modesSaved: 'Preferência salva.',
    providersTitle: 'Provedores',
    providersSubtitle: 'O ativo com menor prioridade é usado primeiro; se falhar, entra o próximo.',
    addProvider: 'Adicionar provedor',
    emptyProviders: 'Nenhum provedor cadastrado',
    emptyProvidersHint: 'Adicione um provedor para oferecer a IA da ferramenta aos clientes.',
    noActiveWarning: 'A IA da ferramenta está ligada, mas nenhum provedor está ativo. Os clientes não terão IA até você ativar um.',
    priorityValue: (n: number) => `Prioridade ${n}`,
    dailyLimitValue: (n: number | null) => (n === null ? 'Sem limite diário' : `${n} por cliente/dia`),
    keyMissing: 'Sem chave',
    enabledToggle: 'Ativo',
    enableAria: (label: string) => `Ativar ou desativar ${label}`,
    test: 'Testar',
    testing: 'Testando…',
    testOk: 'Funcionando',
    testFailed: 'Falhou',
    edit: 'Editar',
    remove: 'Excluir',
    editAria: (label: string) => `Editar ${label}`,
    removeAria: (label: string) => `Excluir ${label}`,
    removeTitle: 'Excluir provedor?',
    removeDescription: (label: string) =>
      `"${label}" deixa de ser usado na hora e a chave é apagada. Esta ação não pode ser desfeita.`,
    removeConfirm: 'Excluir',
    cancel: 'Cancelar',
    retry: 'Tentar de novo',
    dialog: {
      createTitle: 'Adicionar provedor',
      editTitle: 'Editar provedor',
      kind: 'Provedor',
      label: 'Nome de exibição',
      labelHelp: 'Só para você identificar. Ex.: "Principal".',
      model: 'Modelo',
      modelHelp: (suggested: string) => `Sugestão: ${suggested}`,
      apiKey: 'Chave de API',
      apiKeyKeepHelp: 'Deixe em branco para manter a chave atual.',
      apiKeyNewHelp: 'A chave é guardada cifrada e nunca é exibida de novo.',
      priority: 'Prioridade',
      priorityHelp: 'Número menor é usado primeiro.',
      dailyLimit: 'Limite diário por cliente',
      dailyLimitHelp: 'Deixe vazio para não limitar.',
      enabled: 'Ativo',
      save: 'Salvar',
      saving: 'Salvando…',
      required: 'Campo obrigatório',
      invalidNumber: 'Use um número inteiro a partir de 0',
      showKey: 'Mostrar chave',
      hideKey: 'Ocultar chave',
    },
  },

  tenant: {
    navLabel: 'Inteligência artificial',
    pageTitle: 'Inteligência artificial',
    pageSubtitle: 'A IA escreve os textos das suas ofertas para cada público.',
    includedTitle: 'A IA já está incluída no seu plano',
    includedBody: 'Você não precisa configurar nada. É só gerar suas ofertas e escolher o público.',
    unavailableTitle: 'A IA não está disponível no momento',
    unavailableBody: 'Suas ofertas continuam sendo geradas com o texto padrão. Assim que a IA voltar, ela aparece aqui.',
    ownKeyTitle: 'Use a sua própria chave de IA',
    ownKeyIntro:
      'Para a IA escrever suas ofertas, conecte uma conta sua na Anthropic ou na OpenAI. '
      + 'Você paga direto ao provedor, só pelo que usar — gerar textos curtos costuma custar centavos.',
    howToTitle: 'Como conseguir uma chave',
    howToSteps: [
      'Crie uma conta no site do provedor e adicione créditos.',
      'Abra a área de chaves de API e clique em criar nova chave.',
      'Copie a chave e cole no campo abaixo. Ela é guardada cifrada e não aparece de novo.',
    ],
    anthropicLink: 'Abrir console da Anthropic',
    openAiLink: 'Abrir plataforma da OpenAI',
    provider: 'Provedor',
    model: 'Modelo',
    modelHelp: (suggested: string) => `Se não souber, use ${suggested}.`,
    apiKey: 'Chave de API',
    apiKeyKeepHelp: 'Chave salva. Deixe em branco para manter.',
    apiKeyNewHelp: 'Cole aqui a chave copiada do site do provedor.',
    savedKeyKeep: (masked: string) => `Chave salva (${masked}). Deixe em branco para manter.`,
    showKey: 'Mostrar chave',
    hideKey: 'Ocultar chave',
    required: 'Campo obrigatório',
    save: 'Salvar',
    saving: 'Salvando…',
    saved: 'Chave salva. Testando a conexão…',
    test: 'Testar',
    testing: 'Testando…',
    testNeedsSave: 'Salve a chave antes de testar',
    testOk: 'Tudo certo: a IA respondeu.',
    remove: 'Remover chave',
    removeTitle: 'Remover sua chave?',
    removeDescription: 'A IA deixa de escrever suas ofertas até você cadastrar uma chave de novo.',
    removeConfirm: 'Remover',
    removed: 'Chave removida.',
    cancel: 'Cancelar',
    retry: 'Tentar de novo',
  },

  providers: {
    ANTHROPIC: 'Anthropic (Claude)',
    OPENAI: 'OpenAI (ChatGPT)',
  },

  errors: {
    AI_PROVIDER_REJECTED: 'O provedor recusou a chave. Confira se ela foi copiada inteira e se a conta tem créditos.',
    AI_PROVIDER_UNAVAILABLE: 'O provedor de IA não respondeu agora. Tente de novo em alguns minutos.',
    AI_PROVIDER_RATE_LIMITED: 'O provedor está limitando as chamadas. Aguarde um pouco e tente de novo.',
    AI_NOT_CONFIGURED: 'A IA ainda não está configurada.',
    AI_DAILY_LIMIT_REACHED: 'O limite diário de uso da IA foi atingido. Amanhã ele renova.',
    AI_MODES_BOTH_DISABLED: 'Pelo menos uma opção precisa ficar ligada.',
    SECRET_CIPHER_UNAVAILABLE: 'Não foi possível guardar a chave com segurança agora. Tente mais tarde.',
    FORBIDDEN: 'Você não tem permissão para esta ação.',
    VALIDATION_ERROR: 'Confira os campos e tente de novo.',
    generic: 'Não foi possível concluir a ação. Tente de novo.',
  } as Record<string, string>,
} as const;

/** Mensagem amigável a partir de um código de erro de IA (teste ou API). */
export function aiErrorCodeMessage(code: string | undefined | null): string {
  return (code && aiStrings.errors[code]) || aiStrings.errors.generic;
}

/** Mensagem amigável para erro vindo do `apiClient` (que anexa `code`). */
export function aiErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return aiErrorCodeMessage(typeof code === 'string' ? code : null);
}
