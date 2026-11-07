const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date);
}

export const extensionStrings = {
  nav: {
    title: 'Extensão',
  },

  settings: {
    title: 'Extensão do navegador',
    subtitle: 'Gerencie a conexão da extensão Chrome com sua conta',
    statusLabel: 'Status',
    statusConnected: 'Conectada',
    statusDetected: 'Detectada, aguardando vínculo',
    statusNotDetected: 'Não detectada',
    statusUnavailable: 'Indisponível neste navegador',
    versionLabel: 'Versão',
    lastSeenLabel: 'Última atividade',
    lastSeen: (iso: string) => formatDateTime(iso),
    disconnectExtension: 'Desconectar extensão',
    disconnectConfirm: 'Tem certeza? A extensão será desvinculada desta conta.',
    installHint: 'Instale a extensão pela Chrome Web Store para sincronizar a sessão do marketplace.',
    installAction: 'Instalar extensão',
  },

  ml: {
    title: 'Mercado Livre',
    statusLabel: 'Sessão do ML',
    statusLoggedIn: 'Logado',
    statusLoggedOut: 'Não logado',
    statusSynced: 'Sincronizada',
    statusExpired: 'Expirada — sincronize novamente',
    statusNeverSynced: 'Ainda não sincronizada',
    lastSyncLabel: 'Última sincronização',
    lastSync: (iso: string) => formatDateTime(iso),
    syncNow: 'Sincronizar agora',
    syncing: 'Sincronizando…',
    disconnectMl: 'Desconectar Mercado Livre',
    disconnectMlConfirm: 'A sessão do ML será removida. Você precisará sincronizar novamente.',
    tagLabel: 'Etiqueta de afiliado',
    tagMissing: 'Nenhuma etiqueta vinculada',
    resyncHint: 'A sessão expirou. Abra o Mercado Livre no navegador e sincronize.',
  },

  wizard: {
    title: 'Conectar extensão',
    stepInstall: 'Instalar',
    stepDetect: 'Detectar',
    stepConnect: 'Vincular',
    stepSync: 'Sincronizar',
    stepDone: 'Pronto',

    detectTitle: 'Verificando extensão…',
    detectNotFound: 'Extensão não encontrada',
    detectNotFoundHint: 'Instale a extensão do Chrome e recarregue esta página.',
    detectFound: 'Extensão detectada',
    detectFoundHint: 'Versão encontrada: ',
    detectRetry: 'Voltar para a instalação',

    connectTitle: 'Vincular extensão à sua conta',
    connectConsent: 'Autorizo o envio da sessão do Mercado Livre para geração automática de links.',
    connectAction: 'Vincular',
    connectingAction: 'Vinculando…',

    syncTitle: 'Sincronizar sessão do Mercado Livre',
    syncHint: 'Certifique-se de estar logado no Mercado Livre neste navegador.',
    syncAction: 'Sincronizar agora',
    syncingAction: 'Sincronizando…',
    syncSkip: 'Pular por enquanto',

    doneTitle: 'Extensão configurada!',
    doneHint: 'A sessão do ML será renovada automaticamente enquanto o navegador estiver aberto.',
    doneAction: 'Concluir',
  },

  /** `ExtensionInstallPanel`: instalar pela loja e esperar a detecção. */
  install: {
    title: 'Instale a extensão do navegador',
    hint: 'Ela conecta sua conta do Mercado Livre ao painel. Leva menos de um minuto.',
    storeAction: 'Instalar da Chrome Web Store',
    storeTooltip: 'Abre a Chrome Web Store em uma nova aba',
    storeAgain: 'Abrir a loja de novo',
    recheckAction: 'Já instalei, verificar de novo',
    recheckTooltip: 'Procura a extensão neste navegador agora',
    recheckReloadTooltip: 'Recarrega a página para o navegador liberar a extensão',
    waitingTitle: 'Aguardando a instalação…',
    waitingHint: 'Na loja, clique em "Usar no Chrome" e volte para esta aba. Avançamos sozinhos.',
    timedOutTitle: 'Ainda não detectamos a extensão',
    timedOutHint: 'Conclua a instalação na loja e clique em verificar de novo.',
    detectedTitle: 'Extensão detectada',
    footerPrefix: 'Já instalou e nada mudou? Ative a extensão em',
    footerExtensionsUrl: 'chrome://extensions',
    footerSuffix: 'e recarregue esta página.',
    incompatibleTitle: 'Navegador não compatível',
    incompatibleHint: 'A extensão funciona no Chrome, Edge ou Brave no computador. Abra o painel em um deles para instalar.',
  },

  /** Aviso de primeiro acesso no Dashboard. */
  banner: {
    title: 'Falta instalar a extensão do navegador',
    hint: 'Com ela, o painel gera links do Mercado Livre com a sua etiqueta de afiliado.',
    dismiss: 'Dispensar',
    dismissTooltip: 'Não mostrar mais este aviso',
  },

  /** Página pública aberta pela extensão ao ser desinstalada. */
  removed: {
    pageTitle: 'Extensão removida',
    title: 'A extensão foi removida',
    subtitle: 'Conte o motivo em poucos segundos. Sua resposta ajuda a melhorar a extensão.',
    subtitleNoSurvey: 'A extensão foi desinstalada deste navegador. Você pode reinstalar quando quiser.',
    reasonsLegend: 'Por que você removeu?',
    reasonsHint: 'Escolha um ou mais motivos.',
    reasons: {
      not_working: 'Não funcionou',
      hard_to_use: 'Difícil de usar',
      slow: 'Deixou o navegador lento',
      fear_of_block: 'Medo de bloqueio na conta',
      no_longer_needed: 'Não preciso mais',
      price: 'Preço do plano',
      other_tool: 'Vou usar outra ferramenta',
      other: 'Outro motivo',
    } as Record<string, string>,
    commentLabel: 'Quer contar mais? (opcional)',
    commentPrivacy: 'Não inclua dados pessoais, como nome, telefone ou e-mail.',
    commentCounter: (n: number, max: number) => `${n}/${max}`,
    submit: 'Enviar resposta',
    submitting: 'Enviando…',
    submitNeedsReason: 'Escolha pelo menos um motivo para enviar.',
    submitFailed: 'Não foi possível enviar agora. Tente de novo.',
    thanksTitle: 'Obrigado pela resposta',
    thanksHint: 'Vamos usar o seu retorno para melhorar a extensão.',
    reinstall: 'Reinstalar extensão',
    reinstallTooltip: 'Abre a Chrome Web Store em uma nova aba',
    footer: (year: number, brand: string) => `© ${year} ${brand}`,
  },

  errors: {
    extensionNotResponding: 'A extensão não respondeu. Verifique se está ativada.',
    connectionFailed: 'Falha ao vincular a extensão. Tente novamente.',
    syncFailed: 'A sincronização falhou no servidor. Tente de novo; se continuar, atualize a extensão.',
    mlNotLogged: 'A extensão não encontrou login do Mercado Livre neste navegador. Entre na sua conta e tente de novo.',
    mlAccountMismatch: 'A conta do Mercado Livre neste navegador é diferente da conta já vinculada.',
    mlSessionRejected: 'Sessão salva, mas o Mercado Livre recusou o acesso pelo servidor. Saia e entre de novo na sua conta do Mercado Livre neste navegador e sincronize outra vez.',
    apiUnreachable: 'A extensão não conseguiu falar com o servidor. Verifique a conexão e tente de novo em instantes.',
    rateLimited: 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.',
    consentRequired: 'Autorize a sincronização do Mercado Livre para continuar.',
    disconnectMlFailed: 'Não foi possível desconectar o Mercado Livre. Tente novamente.',
    needsLogin: 'Faça login no painel para continuar.',
    forbidden: 'Sem permissão para esta operação.',
    planRequired: 'Recurso indisponível no seu plano atual.',
  },
};
