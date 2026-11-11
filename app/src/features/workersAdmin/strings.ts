/** Textos da tela de ocupação dos workers (super admin). pt-BR, sem nome de marca. */
export const workersAdminStrings = {
  navLabel: 'Workers',
  pageTitle: 'Workers',
  pageSubtitle: 'Ocupação dos servidores que mantêm as sessões conectadas. Atualiza a cada 20 segundos.',
  /** Abas da tela (a aba ativa vem da URL). */
  tabs: { occupancy: 'Ocupação', usage: 'Consumo', aria: 'Visões de Workers' },
  retry: 'Tentar de novo',
  listTitle: 'Workers ativos',
  empty: 'Nenhum worker ativo',
  emptyHint: 'Nenhum servidor enviou batimento nos últimos 90 segundos.',
  refreshFailed: 'Não foi possível atualizar. Mostrando os últimos dados recebidos.',

  columns: {
    worker: 'Worker',
    role: 'Papel',
    sessions: 'Sessões / teto',
    pendingLogins: 'Aguardando login',
    memory: 'RAM',
    seen: 'Visto',
  },
  roles: { all: 'Completo', worker: 'Worker', http: 'HTTP' } as Record<string, string>,
  memoryMb: (mb: number) => `${mb.toLocaleString('pt-BR')} MB`,
  pendingLoginsHint: 'QR Code ou código mostrado e ainda não lido. Não ocupa vaga: só conta no teto depois do login.',
  sessionsOf: (sessions: number, max: number) => `${sessions} / ${max}`,
  occupancyAria: (worker: string, pct: number) => `Ocupação de ${worker}: ${pct}%`,
  justNow: 'agora',

  totals: {
    workers: 'Workers ativos',
    sessions: 'Sessões em uso',
    capacity: (sessions: number, max: number, pct: number) => `${sessions} de ${max} (${pct}%)`,
  },

  awaiting: {
    title: 'Aguardando capacidade',
    none: 'Nenhuma sessão esperando vaga.',
    some: (n: number) => (n === 1
      ? '1 sessão sem worker com vaga. Ela conecta sozinha quando abrir espaço.'
      : `${n} sessões sem worker com vaga. Elas conectam sozinhas quando abrir espaço.`),
  },

  /** Adoção por capacidade desligada: processos vistos pelos leases de sessão, sem teto. */
  lease: {
    notice: 'Adoção por capacidade desligada: as sessões são atendidas pelo processo principal da API.',
    noticeHint: 'Sem batimento de worker, cada processo aparece pelas sessões que ele mantém. Para ligar a adoção, veja WORKER_ADOPTION_ENABLED em docs/arquitetura-escala.md.',
    noticeHintAria: 'Saiba mais sobre a adoção por capacidade',
    processes: 'Processos ativos',
    sessions: 'Sessões conectadas',
    sessionsNoCap: (n: number) => `${n.toLocaleString('pt-BR')} · sem teto`,
    sessionsHint: 'Sessões com conexão aberta ou abrindo neste processo. Sem adoção, não há teto por processo.',
    listTitle: 'Processos da API',
    empty: 'Nenhuma sessão conectada agora',
    emptyHint: 'Nenhum processo mantém sessão no momento.',
    columns: { process: 'Processo', sessions: 'Sessões', leaseUntil: 'Lease válido até' },
    leaseUntilHint: 'O processo renova o lease enquanto mantém a sessão. Vencido, outra instância pode assumir.',
  },

  errors: {
    generic: 'Não foi possível carregar os workers.',
  },

  /** Aba Configuração (WSCALE-07): rótulo, ajuda e faixa por campo. */
  settings: {
    fields: {
      maxSessionsPerWorker: {
        label: 'Teto de sessões por worker',
        help: 'Máximo de sessões conectadas que cada worker assume. Reduzir não derruba sessão: o worker só para de adotar.',
        range: '1 a 1.000',
      },
      maxPendingLoginsPerWorker: {
        label: 'Logins simultâneos por worker',
        help: 'Máximo de sessões aguardando leitura do QR Code ou do código em cada worker.',
        range: '1 a 500',
      },
      alertOccupancyRatio: {
        label: 'Alerta de ocupação',
        help: 'Fração do teto a partir da qual a ocupação gera alerta. Também é o gatilho da subida automática.',
        range: '0,5 a 0,95',
      },
      awaitingAlertSeconds: {
        label: 'Alerta de sessão aguardando (segundos)',
        help: 'Tempo que uma sessão pode esperar vaga antes de gerar alerta.',
        range: '30 a 3.600 segundos',
      },
      scalerMode: {
        label: 'Modo de escala',
        help: 'Desligado: ninguém muda réplicas pelo painel. Manual: só pelos botões da aba Escala. Automático: sobe uma réplica quando a ocupação se mantém alta.',
        range: 'Desligado, manual ou automático',
      },
      minReplicas: {
        label: 'Mínimo de réplicas',
        help: 'Menor número de workers que a escala mantém.',
        range: '1 a 20',
      },
      maxReplicas: {
        label: 'Máximo de réplicas',
        help: 'Maior número de workers que a escala pode pedir.',
        range: 'Mínimo a 20',
      },
      scaleUpSustainSeconds: {
        label: 'Ocupação alta sustentada (segundos)',
        help: 'Tempo acima do alerta de ocupação antes da subida automática. Resolução de 5 minutos.',
        range: '300 a 3.600 segundos',
      },
      scaleCooldownSeconds: {
        label: 'Intervalo mínimo entre escaladas (segundos)',
        help: 'Espera obrigatória depois de uma escalada bem-sucedida.',
        range: '300 a 86.400 segundos',
      },
    },
    scalerModes: { off: 'Desligado', manual: 'Manual', auto: 'Automático' },
    origin: { default: 'Valor padrão', saved: 'Salvo' },
    errors: {
      required: 'Preencha este campo.',
      integer: 'Use um número inteiro.',
      number: 'Use um número.',
      range: (min: string, max: string) => `Use um valor entre ${min} e ${max}.`,
      maxBelowMin: 'O máximo não pode ser menor que o mínimo de réplicas.',
      scalerMode: 'Escolha um modo de escala.',
      invalid: 'A configuração foi recusada. Confira os campos marcados.',
      conflict: 'Outro administrador salvou antes. Os valores atuais foram recarregados.',
      loadFailed: 'Não foi possível carregar a configuração.',
      saveFailed: 'Não foi possível salvar a configuração.',
    },
  },
} as const;
