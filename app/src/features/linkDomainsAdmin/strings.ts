/** Textos da tela de domínios do rodízio de links (super admin). pt-BR. */
export const linkDomainsAdminStrings = {
  navLabel: 'Domínios de links',
  pageTitle: 'Domínios de links',
  pageSubtitle:
    'Domínios base onde os clientes criam os subdomínios do rodízio de links. Cada domínio novo tem custo na hospedagem: cadastre só o necessário.',
  retry: 'Tentar de novo',
  add: 'Adicionar domínio',
  listTitle: 'Domínios cadastrados',
  empty: 'Nenhum domínio cadastrado',
  emptyHint: 'Configure o DNS seguindo o passo a passo abaixo e depois cadastre o domínio aqui.',

  columns: {
    hostname: 'Domínio',
    status: 'Ativo',
    landing: 'Domínio puro abre',
    probe: 'Último teste',
    actions: 'Ações',
  },
  status: {
    ACTIVE: 'Ativo',
    PAUSED: 'Pausado',
    toggle: (hostname: string) => `Ativar ou pausar ${hostname}`,
    pausedHint: 'Pausado: os clientes não criam links novos neste domínio.',
  },
  landingNone: 'Página 404 da marca',
  reservedCount: (n: number) => (n === 1 ? '1 nome reservado' : `${n} nomes reservados`),

  probe: {
    never: 'Nunca testado',
    ok: 'Funcionando',
    failed: 'Falhou',
    run: 'Testar DNS, certificado e roteamento',
    running: 'Testando…',
    okToast: (hostname: string) => `${hostname} respondeu corretamente.`,
    failedPrefix: 'Motivo:',
    statusSuffix: (status: number) => ` (resposta HTTP ${status})`,
    reasons: {
      REDIRECT:
        'O subdomínio respondeu com redirecionamento. Confira se o proxy da Cloudflare está desligado (DNS only) e se não há regra de redirect na zona.',
      UNEXPECTED_STATUS:
        'O subdomínio respondeu, mas não pelo serviço da API. Confira o wildcard (*) na Render e o CNAME * na Cloudflare.',
      TIMEOUT: 'O subdomínio não respondeu a tempo. A delegação de DNS ou o certificado podem ainda estar propagando.',
      NETWORK_ERROR:
        'Não foi possível conectar. Normalmente é certificado ainda não emitido na Render ou registro DNS faltando.',
      BLOCKED_ADDRESS: 'O domínio aponta para um endereço interno ou proibido. Confira os registros A e CNAME.',
      UNRESOLVABLE: 'O DNS não resolve o subdomínio. Confira os nameservers no registrador e o CNAME * na Cloudflare.',
    } as Record<string, string>,
    unknownReason: 'Falha sem motivo identificado.',
  },

  actions: {
    edit: 'Editar',
    remove: 'Excluir',
  },

  form: {
    createTitle: 'Adicionar domínio',
    editTitle: (hostname: string) => `Editar ${hostname}`,
    hostname: 'Domínio',
    hostnamePlaceholder: 'exemplo.com.br',
    hostnameHelp: 'Só o domínio raiz, sem https:// nem subdomínio. Não pode ser alterado depois.',
    hostnameLocked: 'O domínio não muda. Para trocar, exclua e cadastre de novo.',
    hostnameInvalid: 'Informe um domínio válido, como exemplo.com.br.',
    landingUrl: 'Endereço do domínio puro (opcional)',
    landingPlaceholder: 'https://www.exemplo.com.br',
    landingHelp: 'Para onde vai quem abre o domínio sem subdomínio. Vazio mostra a página 404 da marca.',
    landingInvalid: 'Use um endereço completo começando com https://.',
    reservedNames: 'Nomes reservados extras',
    reservedPlaceholder: 'Digite e tecle Enter',
    reservedHelp: 'Subdomínios que nenhum cliente pode usar, além dos já reservados pela plataforma.',
    reservedInvalid: (name: string) => `"${name}" não é válido: use letras minúsculas, números e hífen.`,
    reservedTooMany: 'No máximo 100 nomes reservados.',
    cancel: 'Cancelar',
    save: 'Salvar',
    create: 'Adicionar',
  },

  removeDialog: {
    title: 'Excluir domínio?',
    description: (hostname: string) =>
      `${hostname} deixa de aceitar links novos. Se algum cliente ainda tiver link neste domínio, a exclusão é recusada: pause o domínio em vez de excluir.`,
    confirm: 'Excluir',
    cancel: 'Cancelar',
  },

  dns: {
    title: 'Como preparar um domínio novo',
    subtitle: 'Faça uma vez por domínio, antes de cadastrar aqui.',
    toggle: 'Mostrar ou esconder o passo a passo',
    steps: [
      'Cloudflare: adicione o domínio no plano Free. Em "AI training & search policies", bloqueie Search, Agent e Training.',
      'Registrador (ex.: registro.br): troque os nameservers pelo par que a Cloudflare indicar. Não ative DNSSEC. Domínio .br leva cerca de 2 horas.',
      'Render, serviço da API, Custom Domains: adicione o domínio raiz e o wildcard (*.dominio). A Render exige os dois juntos.',
      'Cloudflare DNS: crie os 5 registros abaixo, todos como DNS only (nuvem cinza). A Cloudflare liga o proxy sozinha em registro novo: confira.',
      'Render: aguarde "Verified" e "Certificate Issued". Com o DNS certo sai sozinho em minutos.',
      'Cadastre o domínio nesta tela e rode o teste. Só libere aos clientes com o teste "Funcionando".',
    ],
    tableCaption: 'Registros DNS (todos DNS only)',
    tableType: 'Tipo',
    tableName: 'Nome',
    tableContent: 'Conteúdo',
    records: [
      { type: 'A', name: '@', content: '216.24.57.1' },
      { type: 'CNAME', name: 'www', content: 'copysync-ithg.onrender.com' },
      { type: 'CNAME', name: '*', content: 'copysync-ithg.onrender.com' },
      { type: 'CNAME', name: '_acme-challenge', content: 'copysync-ithg.verify.renderdns.com' },
      { type: 'CNAME', name: '_cf-custom-hostname', content: 'copysync-ithg.hostname.renderdns.com' },
    ],
    notes: 'Sem registro AAAA. Sem CAA (ou libere letsencrypt.org e pki.goog). Os dois registros com "_" ficam sempre DNS only.',
    copy: 'Copiar',
    copied: 'Copiado',
  },

  relative: {
    justNow: 'agora há pouco',
  },

  errors: {
    LINK_DOMAIN_INVALID: 'Domínio, endereço ou nome reservado inválido. Confira os campos.',
    LINK_DOMAIN_TAKEN: 'Este domínio já está cadastrado.',
    LINK_DOMAIN_IN_USE: 'Há clientes com links neste domínio. Pause o domínio em vez de excluir.',
    LINK_ROTATION_NOT_CONFIGURED:
      'O rodízio de links não está configurado no servidor (segredo do teste ausente). Configure o servidor e tente de novo.',
    NOT_FOUND: 'Este domínio não existe mais. Recarregue a lista.',
    UNAUTHORIZED: 'Só o administrador da plataforma acessa esta tela.',
    FORBIDDEN: 'Só o administrador da plataforma acessa esta tela.',
    VALIDATION_ERROR: 'Confira os campos e tente de novo.',
    generic: 'Não foi possível concluir a ação. Tente de novo.',
  } as Record<string, string>,
} as const;
