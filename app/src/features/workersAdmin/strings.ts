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
} as const;
