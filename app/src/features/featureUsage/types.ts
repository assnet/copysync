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
  | 'TOKEN_CHANGE_ONLY';
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
  /** Teto do período em vigor (90 na P1; 400 com o agregado). */
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
  /** P3. */
  eligibleTenants: number | null;
  adoption: number | null;
  recurringTenants: number | null;
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

export type UsagePeriodPreset = 'today' | '7d' | '30d' | '90d' | 'custom';
export type UsageSort = 'tenants' | 'uses' | 'trend';

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
}

/** Query enviada à API: todo filtro explícito (`toUsageQuery`). */
export type UsageQuery = Record<string, string>;
