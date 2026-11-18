import { navigationStrings } from '@/features/navigation/strings';
import { linkRotationStrings } from '@/features/linkRotation/strings';
import { planEntitlementsAdminStrings } from '@/features/planEntitlementsAdmin/strings';
import { tutorialsStrings } from '@/features/tutorials/strings';
import { plansStrings } from '@/features/plans/strings';
import { saverStrings } from '@/features/saver/strings';
import type {
  UsageCoverageReason, UsageFeatureKey, UsageGranularity, UsageKind, UsagePeriodPreset, UsagePlan, UsagePlanFamily,
  UsageProduct, UsageSort, UsageSource, UsageTenantStatus, UsageTenantStatusFilter,
} from './types';

/**
 * Textos da tela "Uso dos recursos" (super admin). Fonte única de texto da feature: as telas das tarefas seguintes
 * só consomem daqui. Sem nome de marca (white label); frase com variável é função tipada.
 * Rótulo de recurso igual ao do menu quando o menu já tem o item.
 */

const nav = navigationStrings.links;

/** "1 uso", "+1 conta", "2 usos": singular só para 1 (com ou sem sinal). Aceita número já formatado. */
const count = (value: string | number, one: string, many: string) =>
  `${value} ${/^[+-]?1$/.test(String(value)) ? one : many}`;
const uses = (v: string | number) => count(v, 'uso', 'usos');
const accounts = (v: string | number) => count(v, 'conta', 'contas');
const days = (v: string | number) => count(v, 'dia', 'dias');
const planNames = planEntitlementsAdminStrings.planName;

/** Rótulo e descrição de cada chave do catálogo (`contracts/feature-usage/catalog.json`). */
const features: Record<UsageFeatureKey, { label: string; description: string }> = {
  offer_generator: { label: nav.offers, description: 'Ofertas criadas no gerador.' },
  group_monitoring: { label: nav.monitoring, description: 'Ofertas criadas pelo monitoramento de grupos. O envio conta em "Envio aos grupos".' },
  offer_hunter: { label: nav.offerHunter, description: 'Buscas do caçador, manuais ou agendadas. Buscas puladas não contam.' },
  offer_dispatch: { label: 'Envio aos grupos', description: 'Ofertas entregues aos grupos de disparo, de qualquer origem.' },
  ai_rewrite: { label: 'Texto com IA', description: 'Textos de oferta escritos pela IA, inclusive os descartados depois.' },
  link_rotation: { label: linkRotationStrings.menuLabel, description: 'Links criados no gestor.' },
  link_rotation_click: { label: 'Cliques nos links', description: 'Cliques do público nos links do gestor.' },
  storefront: { label: nav.storefront, description: 'Ofertas adicionadas à página, em rascunho ou publicadas.' },
  offer_story: {
    label: nav.offerStory,
    description: 'Artes de story geradas. Antes do início da contagem própria, só as com título escrito pela IA.',
  },
  affiliate_credentials: { label: nav.affiliateCredentials, description: 'Credenciais e etiquetas de afiliado salvas.' },
  extension_sync: { label: 'Extensão do navegador', description: 'Sincronizações da extensão que trocaram o token.' },
  whatsapp_session: { label: 'Sessão WhatsApp', description: 'Sessões de WhatsApp criadas, inclusive as removidas depois.' },
  telegram_session: { label: 'Sessão Telegram', description: 'Sessões de Telegram criadas, inclusive as removidas depois.' },
  saver_extraction: { label: 'Extração de contatos', description: 'Extrações de membros de grupo pedidas no Saver.' },
  saver_export: { label: 'Exportação de contatos', description: 'Exportações em CSV ou vCard concluídas no Saver.' },
  panel_login: { label: 'Entrada no painel', description: 'Logins concluídos no painel.' },
  chat_send: { label: 'Envio pelo chat', description: 'Mensagens enviadas pelo chat do painel.' },
};

const kinds: Record<UsageKind, string> = {
  ACTION: 'Ação',
  AUTOMATIC: 'Automático',
  AUDIENCE: 'Audiência',
  ACCESS: 'Acesso',
};

const products: Record<UsageProduct, string> = {
  AFFILIATES: navigationStrings.products.affiliates.label,
  CHAT: nav.chat,
  SAVER: navigationStrings.products.saver.label,
  SESSION: 'Sessão',
  ACCESS: 'Acesso',
};

const plans: Record<UsagePlan, string> = {
  COPYSYNC_LITE: planNames.COPYSYNC_LITE,
  COPYSYNC_PRO: planNames.COPYSYNC_PRO,
  COPYSYNC_MAX: planNames.COPYSYNC_MAX,
  SAVER_LITE: planNames.SAVER_LITE,
  SAVER_PRO: planNames.SAVER_PRO,
  SAVER_MAX: planNames.SAVER_MAX,
  NONE: 'Sem plano',
};

const planFamilies: Record<UsagePlanFamily, string> = {
  AFFILIATES: navigationStrings.products.affiliates.label,
  SAVER: navigationStrings.products.saver.label,
};

/** Um texto por código de `coverageReasons`. */
const coverageReasons: Record<UsageCoverageReason, string> = {
  EXISTING_ONLY: 'Conta só o que ainda existe: itens apagados pelo cliente saem da conta.',
  RETENTION: 'A fonte apaga registros antigos: o começo do período pode estar incompleto.',
  AI_HEADLINE_ONLY: 'Antes do início da contagem própria, conta só quando a IA escreve o título do story.',
  MIXED_EVENTS: 'Soma credenciais e etiquetas salvas.',
  MIXED_TRIGGERS: 'Conta como automático, mas inclui os disparados à mão: a fonte não separa os dois.',
  TOKEN_CHANGE_ONLY: 'Conta só quando a extensão troca o token: o uso real é maior.',
};

const statuses: Record<UsageTenantStatus, string> = {
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  CANCELLED: 'Cancelada',
};

const statusFilter: Record<UsageTenantStatusFilter, string> = {
  ...statuses,
  ALL: 'Todas',
};

const presets: Record<UsagePeriodPreset, string> = {
  today: 'Hoje',
  '7d': '7 dias',
  '30d': '30 dias',
  '90d': '90 dias',
  '180d': '6 meses',
  '365d': '12 meses',
  custom: 'Personalizado',
};

const granularities: Record<UsageGranularity, string> = {
  day: 'Dia',
  week: 'Semana',
  month: 'Mês',
};

const sorts: Record<UsageSort, string> = {
  tenants: 'Contas',
  uses: 'Usos',
  trend: 'Tendência',
};

const sources: Record<UsageSource, string> = {
  live: 'Lido agora nas tabelas de origem',
  daily: 'Resumo diário',
};

export const featureUsageStrings = {
  navLabel: 'Uso dos recursos',
  pageTitle: 'Uso dos recursos',
  pageSubtitle: 'Quais recursos as contas usam, quanto e em quais planos.',

  tabs: {
    aria: 'Visões do uso dos recursos',
    overview: 'Visão geral',
    plans: 'Por plano',
    screens: 'Telas',
  },

  features,
  kinds,
  /** Rótulo curto do tipo, em minúsculas, para chips ao lado do nome do recurso. */
  kindChip: {
    ACTION: 'ação',
    AUTOMATIC: 'automático',
    AUDIENCE: 'audiência',
    ACCESS: 'acesso',
  } as Record<UsageKind, string>,
  kindHints: {
    ACTION: 'Feito por alguém da conta no painel ou na extensão.',
    AUTOMATIC: 'Feito pelo sistema em nome da conta (monitoramento, agendamento, envio).',
    AUDIENCE: 'Feito pelo público da conta, como cliques nos links.',
    ACCESS: 'Entrada no painel.',
  } as Record<UsageKind, string>,
  products,
  plans,
  planFamilies,
  coverageReasons,
  statuses,
  sources,
  /** Recurso fora do catálogo conhecido pelo painel (versão nova da API). */
  unknownFeature: (key: string) => key,

  actions: {
    refresh: 'Atualizar',
    refreshAria: 'Atualizar os dados',
    retry: 'Tentar de novo',
    clearFilters: 'Limpar filtros',
    back: 'Voltar à visão geral',
    seeAll: (n: number) => `Ver todos (${n})`,
    showLess: 'Ver menos',
    showTable: 'Ver como tabela',
    showChart: 'Ver como gráfico',
    loadMore: 'Carregar mais',
    openDetail: (feature: string) => `Abrir detalhes de ${feature}`,
    filterByAccount: 'Filtrar por esta conta',
    filterByAccountAria: (account: string) => `Filtrar a tela pela conta ${account}`,
  },

  filters: {
    aria: 'Filtros do uso dos recursos',
    open: 'Filtros',
    openWithCount: (n: number) => (n > 0 ? `Filtros (${n})` : 'Filtros'),
    drawerTitle: 'Filtros',
    close: 'Fechar filtros',
    apply: 'Ver resultado',
    reset: 'Voltar ao padrão',

    period: 'Período',
    presets,
    customFrom: 'De',
    customTo: 'Até',
    customApply: 'Aplicar período',
    customHint: (max: number) => `Até ${days(max)}, terminando hoje ou antes.`,

    granularity: 'Agrupar por',
    granularities,
    singleDayHint: 'Com um dia só, o uso fica agrupado por dia.',
    dayDisabledHint: (max: number) => `"Dia" vale para períodos de até ${days(max)}. Acima disso, agrupe por semana ou mês.`,

    product: 'Produto',
    allProducts: 'Todos os produtos',
    productHint: 'Produto ao qual o recurso pertence.',

    kind: 'Tipo de uso',
    allKinds: 'Todos os tipos',
    kindSelected: (n: number) => count(n, 'tipo', 'tipos'),
    kindHint: 'Quem fez o uso. Recurso sem nenhum dos tipos escolhidos sai da tela.',
    kindMinOne: 'Escolha ao menos um tipo.',

    plan: 'Plano',
    allPlans: 'Todos os planos',
    planGroup: (family: string) => `Planos ${family}`,
    planHint: 'Plano de hoje, não o da data do uso. Escolher um plano mostra só os recursos da família dele.',

    status: 'Status da conta',
    statusOptions: statusFilter,
    statusHint: 'Status de hoje.',

    includeInternal: 'Incluir contas internas',
    includeInternalHint: 'Conta interna é a que tem um super admin entre os membros.',

    sort: 'Ordenar por',
    sorts,

    account: 'Conta',
    accountShort: (id: string) => `Conta ${id.slice(0, 8)}`,
    removeAccount: 'Remover filtro de conta',
    accountHint: 'Só esta conta. O nome aparece quando a conta está na lista de detalhes.',
  },

  /** Mensagens do período personalizado, ao lado do campo. */
  periodErrors: {
    invalid: 'Informe as duas datas.',
    order: 'A data inicial é depois da final.',
    future: 'O período não pode terminar depois de hoje.',
    tooLong: (max: number) => `Escolha até ${days(max)}.`,
  },
  /** A API recusou o período (400 `USAGE_METRICS_RANGE_INVALID`): a tela voltou ao preset padrão. */
  rangeReset: (max: number) => `O período passou do limite de ${days(max)}. Voltamos para os últimos 30 dias.`,
  /** Mesmo caso, sem o teto na resposta (`meta.maxDays` ausente). */
  rangeResetNeutral: 'O período passou do limite permitido. Voltamos para os últimos 30 dias.',

  context: {
    aria: 'Sobre os dados',
    timeZone: 'Dias no horário de Brasília',
    dataSince: (day: string) => `dados desde ${day}`,
    noDataYet: 'sem dados ainda',
    updatedAt: (time: string) => `atualizado às ${time}`,
    sourceHint: (source: string) => `Fonte: ${source}.`,
    /** Indicação discreta quando a resposta veio da leitura sob demanda (`source = live`). */
    liveBadge: 'Leitura direta',
    liveHint: 'O resumo diário ainda não cobre este período: os números foram lidos agora nas tabelas de origem, com limite de 90 dias.',
    dailyHint: 'Números do resumo diário, consolidado pelo sistema ao longo do dia. Permite períodos de até 400 dias.',
    /** Agregado diário sem atualizar há mais de 30 min. */
    stale: (age: string) => `O resumo diário não é atualizado há ${age}. Os números podem estar atrasados.`,
    age: (minutes: number) => {
      if (minutes < 60) return `${minutes} min`;
      const hours = Math.floor(minutes / 60);
      return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} ${Math.floor(hours / 24) === 1 ? 'dia' : 'dias'}`;
    },
  },

  kpis: {
    aria: 'Indicadores do período',
    activeTenants: {
      label: 'Contas ativas',
      help: 'Contas distintas com ao menos um uso de qualquer recurso do recorte. Uma conta conta uma vez, mesmo usando vários recursos.',
      value: (active: string, total: string) => `${active} de ${total}`,
    },
    featuresUsed: {
      label: 'Recursos usados',
      help: 'Recursos do recorte com ao menos um uso, sobre o total de recursos do recorte.',
      value: (used: string, total: string) => `${used} de ${total}`,
      neverUsed: (n: number) => (n === 1 ? '1 sem uso no período' : `${n} sem uso no período`),
    },
    topFeature: {
      label: 'Mais usado',
      help: 'Recurso com mais contas que usaram no período.',
      context: (tenants: string) => accounts(tenants),
      none: 'Nenhum uso no período',
    },
  },

  /** Comparação com o período anterior de mesma duração. */
  comparison: {
    noBase: 'sem base de comparação',
    noBaseHint: 'O período anterior começa antes do primeiro dado deste recurso ou da retenção da fonte.',
    flat: 'igual ao período anterior',
    newUse: 'novo no período',
    tenantsDelta: (signed: string) => accounts(signed),
    usesDelta: (signed: string) => uses(signed),
    percent: (signed: string) => `${signed} vs. período anterior`,
    previousLabel: 'Período anterior',
  },

  measures: {
    uses: { label: 'Usos', help: 'Eventos deste recurso no período. Recursos diferentes não se somam.' },
    activeTenants: { label: 'Contas que usaram', help: 'Contas distintas com ao menos um uso no período.' },
    reach: { label: 'Alcance', help: 'Contas que usaram ÷ contas do recorte na família de planos do recurso. Não considera se a conta tem direito ao recurso.' },
    trend: { label: 'Tendência', help: 'Variação dos usos contra o período anterior de mesma duração.' },
    lastUsed: { label: 'Último uso', help: 'Dia mais recente com uso no período.' },
    firstData: { label: 'Dados desde', help: 'Primeiro registro deste recurso na fonte.' },
    kinds: { label: 'Tipo', help: 'Quem fez o uso: ação, automático, audiência ou acesso.' },
    activeDays: { label: 'Dias com uso', help: 'Dias distintos com ao menos um uso no período.' },
    never: 'Nunca',
    noValue: '—',
  },

  ranking: {
    title: 'Ranking de recursos',
    subtitle: 'Por contas que usaram, por usos ou pela tendência.',
    aria: 'Ranking dos recursos no período',
    tableAria: 'Tabela do ranking dos recursos',
    barValue: (tenants: string, n: string) => `${accounts(tenants)} · ${uses(n)}`,
    tenantsAxis: 'Contas que usaram',
    usesAxis: 'Usos',
    trendAxis: 'Tendência dos usos',
    columns: {
      feature: 'Recurso',
      product: 'Produto',
      kinds: 'Tipo',
      uses: 'Usos',
      activeTenants: 'Contas',
      reach: 'Alcance',
      trend: 'Tendência',
      lastUsed: 'Último uso',
      adoption: 'Adoção',
      recurring: 'Recorrência',
      retention: 'Retenção',
    },
    adoptionChip: (value: string) => `adoção ${value}`,
    empty: 'Nenhum recurso no recorte.',
  },

  trend: {
    title: 'Tendência',
    subtitleOverall: 'Contas ativas em cada intervalo.',
    subtitleFeature: (feature: string) => `Usos e contas de ${feature} em cada intervalo.`,
    aria: 'Gráfico de tendência',
    tableAria: 'Tabela da tendência',
    featureSelect: 'Mostrar',
    overallOption: 'Todas as contas ativas',
    activeTenantsSeries: 'Contas ativas',
    usesSeries: 'Usos',
    tenantsSeries: 'Contas',
    previousSeries: 'Média do período anterior',
    previousHint: 'Linha tracejada: média de usos por intervalo no período anterior.',
    bucketColumn: 'Intervalo',
    weekOf: (day: string) => `Semana de ${day}`,
    empty: 'Sem uso no período.',
  },

  neverUsed: {
    title: 'Sem uso no período',
    subtitle: 'Recursos do recorte que nenhuma conta usou.',
    aria: 'Recursos sem uso no período',
    empty: 'Todos os recursos do recorte tiveram uso no período.',
  },

  coverage: {
    partial: 'Parcial',
    partialAria: (feature: string) => `${feature}: contagem parcial`,
    title: 'Contagem parcial',
    dataSince: (day: string) => `Dados desde ${day}.`,
    noData: 'Sem dados ainda.',
    retentionDays: (n: number) => `A fonte guarda ${days(n)}.`,
  },

  /** Adoção, recorrência e retenção (P3). */
  retention: {
    adoptionHelp: 'Contas que usaram ÷ contas com direito ao recurso hoje (produto ativo e recurso liberado no plano).',
    recurringHelp: (n: number) => `Contas que usaram em ${days(n)} distintos ou mais ÷ contas que usaram no período.`,
    retentionHelp: 'Das contas que usaram no período anterior, quantas usaram de novo neste período.',
    adoptionOf: (active: string, eligible: string) => `${active} de ${accounts(eligible)} com direito`,
    recurringOf: (recurring: string, active: string, n: number) => `${recurring} de ${accounts(active)} usaram em ${days(n)} ou mais`,
    retainedOf: (retained: string, previous: string) => `${retained} de ${accounts(previous)} do período anterior voltaram`,
    noEligible: 'Nenhuma conta tem direito a este recurso no recorte.',
    noUse: 'Nenhuma conta usou o recurso no período.',
    noBase: 'Sem base: nenhuma conta usou no período anterior ou ele começa antes do primeiro dado.',
    recurringDays: 'Recorrência',
    recurringOption: (n: number) => `${days(n)} ou mais`,
    recurringDaysHint: 'Quantos dias distintos de uso no período fazem a conta contar como recorrente.',
  },

  /** Aba Telas (P3): visitas às telas do menu. Rótulos iguais aos do menu. */
  screens: {
    title: 'Telas abertas',
    subtitle: 'Contas que abriram cada tela do menu no período. Uma marca por conta e dia, não o número de aberturas.',
    aria: 'Ranking das telas por contas que abriram',
    tableAria: 'Tabela das telas abertas',
    tenantsAxis: 'Contas que abriram',
    barValue: (tenants: string, tenantDays: string) => `${accounts(tenants)} · ${tenantDays} dias-conta`,
    columns: {
      screen: 'Tela',
      product: 'Produto',
      tenants: 'Contas que abriram',
      share: 'Do recorte',
      tenantDays: 'Dias-conta',
      used: 'Usaram o recurso',
    },
    tenantDaysHelp: 'Soma, por conta, dos dias em que ela abriu a tela.',
    shareHelp: (total: string) => `Contas que abriram ÷ ${accounts(total)} do recorte.`,
    usedHelp: 'Contas que usaram o recurso desta tela no período, com os filtros atuais. Abrir não é usar: os dois números contam contas diferentes.',
    usedNone: 'Tela sem um recurso único medido, ou recurso fora dos filtros de tipo.',
    kindIgnored: 'O filtro de tipo não vale para as telas; produto, plano, status e internas valem.',
    collectionNone: 'A coleta de visitas ainda não registrou nenhuma tela.',
    collectionSince: (day: string) => `Visitas coletadas desde ${day}.`,
    collectionPartial: (day: string) => `A coleta de visitas começou em ${day}: o período escolhido começa antes e os números ficam menores.`,
    emptyTitle: 'Nenhuma tela aberta neste recorte',
    emptyDescription: 'Amplie o período ou limpe os filtros. As visitas só são contadas desde o início da coleta.',
    loading: 'Carregando as telas abertas',
    loadFailed: 'Não foi possível carregar as telas abertas.',
    labels: {
      'view:dashboard': navigationStrings.dashboard,
      'view:offers': nav.offers,
      'view:monitoring': nav.monitoring,
      'view:broadcast-groups': nav.broadcastGroups,
      'view:link-rotation': linkRotationStrings.menuLabel,
      'view:storefront': nav.storefront,
      'view:offer-story': nav.offerStory,
      'view:offer-hunter': nav.offerHunter,
      'view:affiliate-credentials': nav.affiliateCredentials,
      'view:affiliate-tutorials': tutorialsStrings.navLabel,
      'view:affiliate-plans': plansStrings.menuLabel,
      'view:saver-groups': saverStrings.menu.groups,
      'view:saver-settings': saverStrings.menu.settings,
      'view:saver-plans': saverStrings.menu.plans,
      'view:settings': nav.settings,
    },
  },

  plansTab: {
    title: 'Uso por plano',
    subtitle: 'Contas que usaram sobre as contas de cada plano, e o total de usos. Uma família de planos por vez.',
    aria: (family: string) => `Uso dos recursos por plano, família ${family}`,
    family: 'Família de planos',
    familyHint: 'Cada conta tem um plano em cada família. As famílias não se somam.',
    featureColumn: 'Recurso',
    cell: (active: string, total: string) => `${active} de ${total}`,
    cellAria: (feature: string, plan: string, active: string, total: string, n: string) =>
      `${feature}, ${plan}: ${active} de ${accounts(total)}, ${uses(n)}`,
    uses: (n: string) => uses(n),
    planTenants: (n: string) => accounts(n),
    noTenants: '—',
    noTenantsHint: 'Nenhuma conta neste plano no recorte.',
    empty: 'Nenhum recurso desta família no recorte.',
    noneColumnHint: 'Contas sem plano ativo nesta família.',
  },

  detail: {
    title: (feature: string) => feature,
    aria: (feature: string) => `Detalhes de ${feature}`,
    measuresTitle: 'Medidas do período',
    seriesTitle: 'Usos e contas no período',
    byKindTitle: 'Por tipo de uso',
    byPlanTitle: 'Por plano',
    notFoundTitle: 'Recurso não encontrado',
    notFoundDescription: 'Este recurso não existe ou saiu do catálogo.',
    outOfScopeTitle: 'Este recurso está fora dos filtros de tipo ou plano',
    outOfScopeDescription: 'Os filtros de tipo de uso ou de plano deixam este recurso de fora. Limpe os filtros para ver o uso dele.',
    loading: 'Carregando detalhes do recurso',
  },

  tenants: {
    title: 'Contas que mais usam',
    subtitle: 'Ordenadas por usos no período.',
    aria: 'Contas que mais usam este recurso',
    columns: {
      account: 'Conta',
      plan: 'Plano',
      status: 'Status',
      uses: 'Usos',
      activeDays: 'Dias com uso',
      lastUsed: 'Último uso',
      actions: 'Ações',
    },
    internal: 'Interna',
    internalHint: 'Conta com um super admin entre os membros.',
    empty: 'Nenhuma conta usou este recurso no período.',
    loading: 'Carregando contas',
    loadingMore: 'Carregando mais contas',
    cursorReset: 'A lista mudou desde a última página. Ela foi recarregada do início.',
    moreFailed: 'Não foi possível carregar mais contas.',
  },

  csv: {
    button: 'Exportar CSV',
    disabledHint: 'Aguarde os dados carregarem para exportar.',
    hint: 'Baixa o resumo da tela, com os filtros atuais. Não inclui nomes de contas.',
    fileName: (from: string, to: string) => `uso-dos-recursos_${from}_${to}.csv`,
    columns: ['Recurso', 'Produto', 'Tipo', 'Usos', 'Contas que usaram', 'Alcance', 'Tendência', 'Último uso'],
  },

  states: {
    loading: 'Carregando o uso dos recursos',
    emptyTitle: 'Nenhum uso neste recorte',
    emptyDescription: 'Amplie o período ou limpe os filtros para ver mais recursos.',
  },

  errors: {
    loadFailed: 'Não foi possível carregar o uso dos recursos.',
    readSlow: 'A leitura demorou mais que o limite ou outra leitura está em andamento. Tente de novo em alguns segundos.',
    detailFailed: 'Não foi possível carregar os detalhes do recurso.',
    /** Com dado anterior na tela: a atualização falhou e o que aparece pode estar desatualizado. */
    staleFailed: 'Não foi possível atualizar. Os dados abaixo são da última leitura e podem estar desatualizados.',
    staleSlow: 'A atualização demorou mais que o limite. Os dados abaixo são da última leitura e podem estar desatualizados.',
  },
} as const;

export type FeatureUsageStrings = typeof featureUsageStrings;
