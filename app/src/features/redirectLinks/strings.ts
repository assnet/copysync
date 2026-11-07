/** Textos dos links de redirecionamento da plataforma (admin + página pública). pt-BR, sem nome de marca. */

/** Caminho público do painel: `/redirect/<slug>` (fora do login). */
export const REDIRECT_PUBLIC_PATH = '/redirect';

export const redirectLinksStrings = {
  navLabel: 'Links de redirecionamento',
  pageTitle: 'Links de redirecionamento',
  pageSubtitle: 'Links curtos da plataforma para suporte, loja, vídeos e lojas de extensão. Dá para dividir o tráfego entre dois destinos.',
  retry: 'Tentar de novo',
  listTitle: 'Links',
  add: 'Novo link',
  empty: 'Nenhum link cadastrado',
  emptyHint: 'Crie um link para divulgar um endereço curto que você pode trocar de destino quando quiser.',
  copied: 'Link copiado',
  copyFailed: 'Não foi possível copiar. Selecione o endereço e copie manualmente.',

  columns: {
    link: 'Link',
    destination: 'Destino',
    split: 'Divisão',
    status: 'Ativo',
    clicks: 'Cliques',
    actions: 'Ações',
  },

  sideA: 'A',
  sideB: 'B',
  splitAll: '100% A',
  splitLabel: (a: number) => `${a}% A · ${100 - a}% B`,
  clicksTotal: (n: number) => n.toLocaleString('pt-BR'),
  clicksSplit: (a: number, b: number) => `A ${a.toLocaleString('pt-BR')} · B ${b.toLocaleString('pt-BR')}`,
  clicksHint: 'Cada acesso conta um clique no destino sorteado. Robôs e acessos repetidos também contam.',
  inactiveHint: 'Desativado: o endereço mostra "link indisponível".',

  status: {
    toggle: (slug: string) => `Ativar ou desativar ${slug}`,
    active: 'Ativo',
    inactive: 'Desativado',
  },

  actions: {
    copy: 'Copiar link',
    open: 'Abrir em nova aba',
    edit: 'Editar',
    remove: 'Apagar',
  },

  form: {
    createTitle: 'Novo link de redirecionamento',
    editTitle: (slug: string) => `Editar ${slug}`,
    slug: 'Nome do link',
    slugHelp: 'Letras minúsculas, números, ponto e hífen (até 100). Ex.: chrome-web-store-v5.235.2',
    slugInvalid: 'Use só letras minúsculas, números, ponto e hífen, começando e terminando com letra ou número.',
    slugPreview: (url: string) => `Endereço: ${url}`,
    slugChangeWarning: 'Ao trocar o nome, o endereço antigo para de funcionar na hora. Quem já divulgou o link antigo verá "link indisponível".',
    urlA: 'Destino A',
    urlB: 'Destino B (opcional)',
    urlHelp: 'Endereço completo começando com https://',
    urlBHelp: 'Preencha para dividir o tráfego entre dois destinos (teste A/B).',
    urlInvalid: 'Use um endereço https:// válido, sem usuário e senha.',
    split: 'Divisão do tráfego',
    splitHelp: 'Porcentagem dos acessos que vão para o destino A. O resto vai para o B.',
    splitAria: 'Porcentagem para o destino A',
    note: 'Observação (opcional)',
    noteHelp: 'Só aparece aqui. Ex.: onde o link foi divulgado.',
    active: 'Link ativo',
    activeHelp: 'Desativado, o endereço mostra "link indisponível" sem apagar os cliques.',
    cancel: 'Cancelar',
    create: 'Criar link',
    save: 'Salvar',
  },

  removeDialog: {
    title: 'Apagar link?',
    description: (slug: string) => `O endereço "${slug}" para de funcionar e os cliques são perdidos. Para só pausar, desative o link.`,
    confirm: 'Apagar',
    cancel: 'Cancelar',
  },

  errors: {
    generic: 'Não foi possível concluir. Tente de novo.',
    REDIRECT_LINK_SLUG_TAKEN: 'Já existe um link com esse nome.',
    REDIRECT_LINK_NOT_FOUND: 'Este link não existe mais. Recarregue a lista.',
    REDIRECT_LINK_INVALID: 'Confira os campos: nome, destinos https:// e divisão.',
    UNAUTHORIZED: 'Só o administrador da plataforma pode gerenciar estes links.',
  } as Record<string, string>,

  /** Motivos de recusa do destino vindos da API (`meta.reason`). */
  reasons: {
    NOT_HTTPS: 'O destino precisa começar com https://.',
    CREDENTIALS: 'O destino não pode ter usuário e senha.',
    LOOP: 'O destino não pode apontar para outro link de redirecionamento da plataforma.',
    TOO_LONG: 'Endereço longo demais (máximo de 2048 caracteres).',
    MALFORMED: 'Endereço inválido.',
    EMPTY: 'Informe o destino.',
  } as Record<string, string>,

  /** Página pública `/redirect/<slug>`. */
  public: {
    pageTitle: 'Redirecionando…',
    redirecting: 'Redirecionando…',
    redirectingHint: 'Você será levado ao destino em instantes.',
    manualLink: 'Se nada acontecer, toque aqui.',
    unavailableTitle: 'Link indisponível',
    unavailableHint: 'Este link não existe ou foi desativado. Confira o endereço com quem o enviou.',
    errorTitle: 'Não foi possível abrir o link',
    errorHint: 'Verifique sua conexão e tente de novo.',
    retry: 'Tentar de novo',
  },
} as const;
