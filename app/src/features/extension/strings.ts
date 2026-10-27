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
    stepDetect: 'Detectar',
    stepConnect: 'Vincular',
    stepSync: 'Sincronizar',
    stepDone: 'Pronto',

    detectTitle: 'Verificando extensão…',
    detectNotFound: 'Extensão não encontrada',
    detectNotFoundHint: 'Instale a extensão do Chrome e recarregue esta página.',
    detectFound: 'Extensão detectada',
    detectFoundHint: 'Versão encontrada: ',

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

  errors: {
    extensionNotResponding: 'A extensão não respondeu. Verifique se está ativada.',
    connectionFailed: 'Falha ao vincular a extensão. Tente novamente.',
    syncFailed: 'Falha ao sincronizar. Verifique se está logado no Mercado Livre.',
    disconnectMlFailed: 'Não foi possível desconectar o Mercado Livre. Tente novamente.',
    needsLogin: 'Faça login no painel para continuar.',
    forbidden: 'Sem permissão para esta operação.',
    planRequired: 'Recurso indisponível no seu plano atual.',
  },
};
