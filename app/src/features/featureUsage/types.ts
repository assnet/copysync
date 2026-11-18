/**
 * Contrato do uso dos recursos (`GET /admin/usage/*`, só super admin). Espelha `design.md` §5 e as fixtures de
 * `contracts/feature-usage/` (o teste `contract.test.ts` falha com campo a mais ou a menos). A API devolve só chaves
 * e números: rótulo é do painel (`strings.ts`).
 */

/** Chaves do catálogo (`contracts/feature-usage/catalog.json`; `chat_send` entra com o contador da P2). */
export type UsageFeatureKey =
  | 'offer_generator'
  | 'group_monitoring'
  | 'offer_hunter'
  | 'offer_dispatch'
  | 'ai_rewrite'
  | 'link_rotation'
  | 'link_rotation_click'
  | 'storefront'
  | 'offer_story'
  | 'affiliate_credentials'
  | 'extension_sync'
  | 'whatsapp_session'
  | 'telegram_session'
  | 'saver_extraction'
  | 'saver_export'
  | 'panel_login'
  | 'chat_send';

export type UsageProduct = 'AFFILIATES' | 'CHAT' | 'SAVER' | 'SESSION' | 'ACCESS';
export type UsageKind = 'ACTION' | 'AUTOMATIC' | 'AUDIENCE' | 'ACCESS';
export type UsagePlanFamily = 'AFFILIATES' | 'SAVER';
export type UsageAffiliatesPlan = 'COPYSYNC_LITE' | 'COPYSYNC_PRO' | 'COPYSYNC_MAX';
export type UsageSaverPlan = 'SAVER_LITE' | 'SAVER_PRO' | 'SAVER_MAX';
/** Plano numa família; `NONE` = conta sem plano ativo naquela família. */
export type UsagePlan = UsageAffiliatesPlan | UsageSaverPlan | 'NONE';
export type UsageCoverage = 'FULL' | 'PARTIAL';
export type UsageCoverageReason =
  | 'EXISTING_ONLY'
  | 'RETENTION'
  | 'AI_HEADLINE_ONLY'
  | 'MIXED_EVENTS'
  | 'MIXED_TRIGGERS'
  | 'TOKEN_CHANGE_ONLY'
  | 'DROPPED';
export type UsageGranularity = 'day' | 'week' | 'month';
export type UsageSource = 'live' | 'daily';
export type UsageTenantStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
export type UsageTenantStatusFilter = UsageTenantStatus | 'ALL';

/** Dia `YYYY-MM-DD` no fuso da feature (`America/Sao_Paulo`). */
export type UsageDay = string;

export interface UsageRange {
  from: UsageDay;
  to: UsageDay;
  timeZone: string;
  previousFrom: UsageDay;
  previousTo: UsageDay;
  granularity: UsageGranularity;
  /** Teto do período em vigor (90 sem o agregado; 400 quando o agregado cobre o período). */
  maxDays: number;
}

export interface UsagePopulationPlan {
  family: UsagePlanFamily;
  plan: UsagePlan;
  tenants: number;
}

export interface UsagePopulation {
  tenants: number;
  internalExcluded: number;
  /** As duas famílias; em cada uma, cada conta do recorte conta uma vez. As famílias não se somam. */
  byPlan: UsagePopulationPlan[];
}

export interface UsageTotals {
  activeTenants: number;
  activeTenantsPrevious: number | null;
  featuresUsed: number;
  featuresNeverUsed: number;
  topFeature: UsageFeatureKey | null;
}

export interface UsageKindBreakdown {
  kind: UsageKind;
  uses: number;
  activeTenants: number;
}

export interface UsagePlanBreakdown {
  plan: UsagePlan;
  tenants: number;
  activeTenants: number;
  uses: number;
}

export interface UsageFeatureItem {
  key: UsageFeatureKey;
  product: UsageProduct;
  planFamily: UsagePlanFamily;
  kinds: UsageKind[];
  coverage: UsageCoverage;
  coverageReasons: UsageCoverageReason[];
  retentionDays: number | null;
  /** Primeiro dado real (é o "dados desde"); `null` sem dado. */
  firstDataDay: UsageDay | null;
  /** Limite para a tendência (maior entre `firstDataDay` e hoje − retenção). Nunca exibido como "dados desde". */
  dataFrom: UsageDay | null;
  uses: number;
  usesPrevious: number | null;
  activeTenants: number;
  activeTenantsPrevious: number | null;
  /** Contas que usaram ÷ contas do recorte na família do recurso (0–1). */
  reach: number;
  lastUsedDay: UsageDay | null;
  byKind: UsageKindBreakdown[];
  byPlan: UsagePlanBreakdown[];
  /** P3. Contas com direito ao recurso hoje (produto ativo + entitlement). `null` no detalhe. */
  eligibleTenants: number | null;
  /** Contas que usaram ÷ contas com direito (0–1); `null` sem conta com direito (e no detalhe). */
  adoption: number | null;
  /** Contas com uso em ≥ `recurringDays` dias distintos do período. `null` no detalhe. */
  recurringTenants: number | null;
  /** Das contas que usaram no período anterior, quantas usaram de novo; `null` sem base (e no detalhe). */
  retainedTenants: number | null;
}

export interface UsageSummarySeriesPoint {
  bucket: UsageDay;
  activeTenants: number;
}

export interface UsageSummary {
  range: UsageRange;
  source: UsageSource;
  freshAt: string;
  population: UsagePopulation;
  totals: UsageTotals;
  features: UsageFeatureItem[];
  series: UsageSummarySeriesPoint[];
}

export interface UsageFeatureSeriesPoint {
  bucket: UsageDay;
  uses: number;
  activeTenants: number;
}

export interface UsageFeatureDetail {
  range: UsageRange;
  source: UsageSource;
  freshAt: string;
  population: UsagePopulation;
  feature: UsageFeatureItem;
  series: UsageFeatureSeriesPoint[];
}

/**
 * Detalhe como a API responde. `inScope = false`: os filtros de tipo/plano excluem o recurso e os números vêm
 * zerados (404 só para chave fora do catálogo). Ausente vale `true` (fixture antiga do contrato). Fica fora de
 * `UsageFeatureDetail` porque o mapa de forma de `contract.test.ts` exige todo campo do tipo base.
 */
export interface UsageFeatureDetailResponse extends UsageFeatureDetail {
  inScope?: boolean;
}

export interface UsageTenantItem {
  tenantId: string;
  /** Único dado sensível da feature: sempre sob `Blurred` (`usage.tenantName`). Nunca persistido. */
  tenantName: string;
  plan: UsagePlan;
  status: UsageTenantStatus;
  internal: boolean;
  uses: number;
  activeDays: number;
  lastUsedDay: UsageDay | null;
}

export interface UsageTenantsPage {
  items: UsageTenantItem[];
  nextCursor: string | null;
}

/* ── Filtros (estado do painel) ─────────────────────────────────────── */

/** `180d`/`365d` só aparecem quando o teto em vigor (`range.maxDays`) os comporta (agregado diário, P2). */
export type UsagePeriodPreset = 'today' | '7d' | '30d' | '90d' | '180d' | '365d' | 'custom';
export type UsageSort = 'tenants' | 'uses' | 'trend';
/** N da recorrência (contas com uso em ≥ N dias distintos do período). Só 2, 3 ou 5 (a API recusa outro). */
export type UsageRecurringDays = 2 | 3 | 5;

/**
 * Filtros persistidos (`usage.filters`, escopo `tab`). O período guarda o preset; datas só no `custom`.
 * A conta filtrada guarda só o `tenantId` (nome é dado do servidor e nunca é salvo).
 */
export interface UsageFilters {
  preset: UsagePeriodPreset;
  /** Só no `custom`; `null` nos demais. */
  from: UsageDay | null;
  to: UsageDay | null;
  granularity: UsageGranularity;
  product: UsageProduct | 'all';
  /** Nunca vazia. */
  kinds: UsageKind[];
  plan: UsagePlan | 'all';
  tenantStatus: UsageTenantStatusFilter;
  includeInternal: boolean;
  tenantId: string | null;
  sort: UsageSort;
  /** N da recorrência; só o resumo usa (`toUsageSummaryQuery`). Como a ordenação, não conta como filtro. */
  recurringDays: UsageRecurringDays;
}

/** Query enviada à API: todo filtro explícito (`toUsageQuery`). */
export type UsageQuery = Record<string, string>;

/* ── Telas (P3, `GET /admin/usage/screens`) ────────────────────────── */

/** Tela do menu medida por visita (`view:<chave do menu>`; lista em `screenViews.ts`). */
export interface UsageScreenItem {
  key: string;
  product: UsageProduct;
  planFamily: UsagePlanFamily;
  /** Contas distintas que abriram a tela no período (não é número de aberturas). */
  tenants: number;
  /** Soma de dias × conta com a tela aberta (uma marca por dia e conta). */
  tenantDays: number;
}

export interface UsageScreensResponse {
  range: UsageRange;
  /** Primeiro dia com visita registrada (início da coleta); `null` sem nenhuma ainda. */
  firstDataDay: UsageDay | null;
  /**
   * Contas do recorte; `byFamily` (contas com plano em cada família) é o denominador do "Do recorte" de cada tela.
   * Opcional até a API publicar: sem ele, todas as telas dividem por `tenants`.
   */
  population: { tenants: number; byFamily?: { family: UsagePlanFamily; tenants: number }[] };
  screens: UsageScreenItem[];
}
