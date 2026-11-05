/**
 * Textos do menu lateral (navegação por produtos). Mesmas regras de `features/plans/strings.ts`:
 * chaves semânticas, frase com variável é função tipada, sem nome de marca (white label).
 */
export const navigationStrings = {
  sections: {
    products: 'Produtos',
    platform: 'Plataforma',
  },

  dashboard: 'Dashboard',
  soon: 'Em breve',
  /** Título do Tooltip de produto ainda não lançado: "Em breve · tagline". */
  soonWithTagline: (tagline: string) => `Em breve · ${tagline}`,

  products: {
    affiliates: { label: 'Afiliados', tagline: 'Ofertas, monitoramento e links' },
    crmAutomation: { label: 'CRM & Automação', tagline: 'Atendimento e fluxos automáticos' },
    groupManager: { label: 'Gestor de Grupos', tagline: 'Membros e regras dos seus grupos' },
    saver: { label: 'Saver', tagline: 'Guarde o que passa nos grupos' },
    chipWarmer: { label: 'Aquecedor de Chip', tagline: 'Prepare números novos com segurança' },
    groupFiller: { label: 'Lotar Grupos', tagline: 'Encha seus grupos com novos membros' },
  },

  links: {
    offers: 'Gerador de ofertas',
    monitoring: 'Monitoramento',
    broadcastGroups: 'Grupos de disparo',
    storefront: 'Página de Ofertas',
    offerStory: 'Story de Oferta',
    affiliateCredentials: 'Credenciais de afiliado',
    chat: 'Chat',
    settings: 'Configurações',
  },

  aria: {
    mainNav: 'Navegação principal',
    openSubmenu: (product: string) => `Abrir submenu de ${product}`,
    productSoon: (product: string) => `${product}: em breve`,
    activeChildHint: 'Contém a tela atual',
    /** Nome acessível do produto recolhido que contém a tela atual. */
    productWithActiveChild: (product: string) => `${product} · Contém a tela atual`,
  },

  expandMenu: 'Expandir menu',
  collapseMenu: 'Recolher menu',
  openMenu: 'Abrir menu',
  logout: 'Sair',

  theme: {
    toLight: 'Tema claro',
    toDark: 'Tema escuro',
  },

  user: {
    superAdmin: 'Super Admin',
    regular: 'Usuário',
    fallbackInitial: 'U',
    noEmail: '—',
  },

  tenant: {
    label: 'Tenant:',
    switchError: 'Não foi possível trocar de tenant. Tente novamente.',
  },

  /** Título da aba do navegador: "Tela · Produto". */
  documentTitle: (section: string, appName: string) => `${section} · ${appName}`,
} as const;
