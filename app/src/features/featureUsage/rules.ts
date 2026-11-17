import { featureUsageStrings as S } from './strings';
import type {
  UsageCoverageReason, UsageDay, UsageFeatureItem, UsageFeatureKey, UsageFilters, UsageGranularity, UsageKind,
  UsagePeriodPreset, UsagePlan, UsagePlanFamily, UsageProduct, UsageQuery, UsageSort, UsageSummary,
  UsageTenantStatusFilter,
} from './types';

/**
 * Regras puras do uso dos recursos. Nada de relógio aqui: quem chama passa `now` (no painel, `serverNow()`).
 * Datas em `America/Sao_Paulo` via `Intl`, sem biblioteca de data. As telas só consomem estas funções.
 */

/* ── Constantes ────────────────────────────────────────────────────── */

export const USAGE_TIME_ZONE = 'America/Sao_Paulo';
/** Teto do período no painel antes da primeira resposta (P1). O teto em vigor vem de `range.maxDays`. */
export const USAGE_MAX_DAYS = 90;
/** "Dia" só até este número de dias (acima, semana ou mês). */
export const USAGE_DAY_GRANULARITY_MAX_DAYS = 90;
/** Até aqui o padrão é "Dia"; acima, "Semana" (mesma regra do schema da API). */
export const USAGE_DAY_DEFAULT_MAX_DAYS = 31;
/** Barras no ranking antes do "ver todos". */
export const USAGE_RANKING_MAX_BARS = 12;

export const USAGE_FILTERS_KEY = 'usage.filters';
export const USAGE_FILTERS_VERSION = 1;

export const USAGE_PRESETS: UsagePeriodPreset[] = ['today', '7d', '30d', '90d', 'custom'];
const PRESET_DAYS: Record<Exclude<UsagePeriodPreset, 'custom'>, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 };
export const USAGE_GRANULARITIES: UsageGranularity[] = ['day', 'week', 'month'];
export const USAGE_PRODUCTS: UsageProduct[] = ['AFFILIATES', 'CHAT', 'SAVER', 'SESSION', 'ACCESS'];
export const USAGE_KINDS: UsageKind[] = ['ACTION', 'AUTOMATIC', 'AUDIENCE', 'ACCESS'];
export const USAGE_PLAN_FAMILIES: UsagePlanFamily[] = ['AFFILIATES', 'SAVER'];
/** Planos de cada família, na ordem das colunas (mesma de `PLAN_SLUGS` e `SAVER_PLAN_SLUGS` da API). */
export const USAGE_FAMILY_PLANS: Record<UsagePlanFamily, Exclude<UsagePlan, 'NONE'>[]> = {
  AFFILIATES: ['COPYSYNC_LITE', 'COPYSYNC_PRO', 'COPYSYNC_MAX'],
  SAVER: ['SAVER_LITE', 'SAVER_PRO', 'SAVER_MAX'],
};
export const USAGE_PLANS: UsagePlan[] = [...USAGE_FAMILY_PLANS.AFFILIATES, ...USAGE_FAMILY_PLANS.SAVER, 'NONE'];
export const USAGE_TENANT_STATUSES: UsageTenantStatusFilter[] = ['ACTIVE', 'SUSPENDED', 'CANCELLED', 'ALL'];
export const USAGE_SORTS: UsageSort[] = ['tenants', 'uses', 'trend'];

/** Padrões iguais aos do schema da rota (`design.md` §5). */
export const DEFAULT_USAGE_FILTERS: UsageFilters = {
  preset: '30d',
  from: null,
  to: null,
  granularity: 'day',
  product: 'all',
  kinds: ['ACTION', 'AUTOMATIC'],
  plan: 'all',
  tenantStatus: 'ACTIVE',
  includeInternal: false,
  tenantId: null,
  sort: 'tenants',
};

/* ── Datas ─────────────────────────────────────────────────────────── */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Dia `YYYY-MM-DD` válido no calendário. */
export function isUsageDay(value: unknown): value is UsageDay {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Dia de Brasília do instante `nowMs`. */
export function todayInZone(nowMs: number): UsageDay {
  return new Intl.DateTimeFormat('en-CA', { timeZone: USAGE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(nowMs));
}

function dayToUtcMs(day: UsageDay): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(day: UsageDay, n: number): UsageDay {
  return new Date(dayToUtcMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Dias do período, contando as duas pontas. */
export function daysInclusive(from: UsageDay, to: UsageDay): number {
  return Math.round((dayToUtcMs(to) - dayToUtcMs(from)) / DAY_MS) + 1;
}

/** Período concreto dos filtros, no dia de Brasília de `nowMs`. Preset não guarda data: "30 dias" é sempre até hoje. */
export function resolvePeriod(filters: Pick<UsageFilters, 'preset' | 'from' | 'to'>, nowMs: number): { from: UsageDay; to: UsageDay; days: number } {
  if (filters.preset === 'custom' && filters.from && filters.to) {
    return { from: filters.from, to: filters.to, days: daysInclusive(filters.from, filters.to) };
  }
  const preset = filters.preset === 'custom' ? DEFAULT_USAGE_FILTERS.preset : filters.preset;
  const days = PRESET_DAYS[preset as Exclude<UsagePeriodPreset, 'custom'>];
  const to = todayInZone(nowMs);
  return { from: addDays(to, -(days - 1)), to, days };
}

/** Dias que o preset cobre (o `custom` usa as datas). */
export function presetDays(preset: UsagePeriodPreset, from: UsageDay | null = null, to: UsageDay | null = null): number | null {
  if (preset !== 'custom') return PRESET_DAYS[preset];
  return from && to && isUsageDay(from) && isUsageDay(to) ? daysInclusive(from, to) : null;
}

/** Presets que cabem no teto em vigor (o `custom` sempre aparece). */
export function presetsWithin(maxDays: number): UsagePeriodPreset[] {
  return USAGE_PRESETS.filter((p) => p === 'custom' || PRESET_DAYS[p] <= maxDays);
}

export type UsageRangeError = 'invalid' | 'order' | 'future' | 'tooLong';

/** Valida o personalizado. `null` = válido. */
export function validateCustomRange(from: unknown, to: unknown, maxDays: number, nowMs: number): UsageRangeError | null {
  if (!isUsageDay(from) || !isUsageDay(to)) return 'invalid';
  if (from > to) return 'order';
  if (to > todayInZone(nowMs)) return 'future';
  if (daysInclusive(from, to) > maxDays) return 'tooLong';
  return null;
}

export function rangeErrorText(error: UsageRangeError, maxDays: number): string {
  return error === 'tooLong' ? S.periodErrors.tooLong(maxDays) : S.periodErrors[error];
}

/* ── Granularidade ─────────────────────────────────────────────────── */

export function defaultGranularity(days: number): UsageGranularity {
  return days <= USAGE_DAY_DEFAULT_MAX_DAYS ? 'day' : 'week';
}

/** Por que a opção está desabilitada: "Dia" acima de 90 dias; "Semana"/"Mês" com um dia só (gráfico de um ponto). */
export type UsageGranularityBlock = 'dayTooLong' | 'singleDay';

/** "Dia" desabilitado acima de 90 dias; com período de 1 dia só "Dia" fica. */
export function granularityOptions(days: number): { value: UsageGranularity; disabled: boolean; reason: UsageGranularityBlock | null }[] {
  return USAGE_GRANULARITIES.map((value) => {
    const reason: UsageGranularityBlock | null = value === 'day'
      ? (days > USAGE_DAY_GRANULARITY_MAX_DAYS ? 'dayTooLong' : null)
      : (days <= 1 ? 'singleDay' : null);
    return { value, disabled: reason !== null, reason };
  });
}

/** `day` acima de 90 dias vira `week`; período de 1 dia é sempre `day`. */
export function coerceGranularity(granularity: UsageGranularity, days: number): UsageGranularity {
  if (days <= 1) return 'day';
  return granularity === 'day' && days > USAGE_DAY_GRANULARITY_MAX_DAYS ? 'week' : granularity;
}

/**
 * Troca o período: o personalizado guarda as datas, o preset não. A granularidade "Dia" vira "Semana" quando o
 * período novo passa de 90 dias.
 */
export function withPeriod(
  filters: UsageFilters,
  next: { preset: UsagePeriodPreset; from?: UsageDay | null; to?: UsageDay | null },
  nowMs: number,
): UsageFilters {
  const custom = next.preset === 'custom';
  const updated: UsageFilters = {
    ...filters,
    preset: next.preset,
    from: custom ? next.from ?? null : null,
    to: custom ? next.to ?? null : null,
  };
  const { days } = resolvePeriod(updated, nowMs);
  return { ...updated, granularity: coerceGranularity(updated.granularity, days) };
}

/* ── Filtros persistidos ───────────────────────────────────────────── */

function oneOf<T extends string>(value: unknown, list: readonly T[], fallback: T): T {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

const TENANT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `deserialize` de `usage.filters`: valida campo a campo e devolve o padrão no que não servir (JSON inválido, forma
 * antiga, valor fora da lista). Personalizado inválido, no futuro ou acima de `maxDays` volta ao preset padrão.
 */
export function parseUsageFilters(raw: unknown, nowMs: number, maxDays: number = USAGE_MAX_DAYS): UsageFilters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_USAGE_FILTERS, kinds: [...DEFAULT_USAGE_FILTERS.kinds] };
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_USAGE_FILTERS;

  let preset = oneOf(r.preset, USAGE_PRESETS, d.preset);
  let from: UsageDay | null = null;
  let to: UsageDay | null = null;
  if (preset === 'custom') {
    if (validateCustomRange(r.from, r.to, maxDays, nowMs) === null) {
      from = r.from as UsageDay;
      to = r.to as UsageDay;
    } else {
      preset = d.preset;
    }
  } else if (PRESET_DAYS[preset] > maxDays) {
    preset = d.preset;
  }

  const kinds = Array.isArray(r.kinds)
    ? USAGE_KINDS.filter((k) => (r.kinds as unknown[]).includes(k))
    : [];

  const filters: UsageFilters = {
    preset,
    from,
    to,
    granularity: oneOf(r.granularity, USAGE_GRANULARITIES, d.granularity),
    product: r.product === 'all' ? 'all' : oneOf<UsageProduct | 'all'>(r.product, USAGE_PRODUCTS, 'all'),
    kinds: kinds.length > 0 ? kinds : [...d.kinds],
    plan: r.plan === 'all' ? 'all' : oneOf<UsagePlan | 'all'>(r.plan, USAGE_PLANS, 'all'),
    tenantStatus: oneOf(r.tenantStatus, USAGE_TENANT_STATUSES, d.tenantStatus),
    includeInternal: typeof r.includeInternal === 'boolean' ? r.includeInternal : d.includeInternal,
    tenantId: typeof r.tenantId === 'string' && TENANT_ID_RE.test(r.tenantId) ? r.tenantId : null,
    sort: oneOf(r.sort, USAGE_SORTS, d.sort),
  };
  const { days } = resolvePeriod(filters, nowMs);
  return { ...filters, granularity: coerceGranularity(filters.granularity, days) };
}

/** Quantos filtros diferem do padrão (rótulo "Filtros (3)" da gaveta). Ordenação não conta. */
export function activeFiltersCount(filters: UsageFilters): number {
  const d = DEFAULT_USAGE_FILTERS;
  const sameKinds = filters.kinds.length === d.kinds.length && d.kinds.every((k) => filters.kinds.includes(k));
  return [
    filters.preset !== d.preset,
    filters.granularity !== d.granularity,
    filters.product !== d.product,
    !sameKinds,
    filters.plan !== d.plan,
    filters.tenantStatus !== d.tenantStatus,
    filters.includeInternal !== d.includeInternal,
    filters.tenantId !== null,
  ].filter(Boolean).length;
}

/** Limpa os filtros mantendo a ordenação do ranking. */
export function clearUsageFilters(filters: UsageFilters): UsageFilters {
  return { ...DEFAULT_USAGE_FILTERS, kinds: [...DEFAULT_USAGE_FILTERS.kinds], sort: filters.sort };
}

/**
 * "Limpar filtros" do aviso "fora dos filtros de tipo ou plano": libera todos os tipos e todos os planos e mantém o
 * resto (conta, período, status, produto, ordenação). Todos os tipos, não o padrão: recurso só de audiência ficaria
 * fora de novo com o padrão (ação + automático).
 */
export function clearKindAndPlanFilters(filters: UsageFilters): UsageFilters {
  return { ...filters, kinds: [...USAGE_KINDS], plan: DEFAULT_USAGE_FILTERS.plan };
}

/** Liga/desliga um tipo; nunca deixa a lista vazia. */
export function toggleKind(kinds: readonly UsageKind[], kind: UsageKind): UsageKind[] {
  const next = kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind];
  return next.length === 0 ? [...kinds] : USAGE_KINDS.filter((k) => next.includes(k));
}

/**
 * Query da API com **todo** filtro explícito (nunca depende do padrão do servidor). Produto e plano "todos" são a
 * ausência do parâmetro (a API não tem valor "todos" para eles). `kind` vai como lista separada por vírgula.
 */
export function toUsageQuery(filters: UsageFilters, nowMs: number): UsageQuery {
  const { from, to, days } = resolvePeriod(filters, nowMs);
  const query: UsageQuery = {
    from,
    to,
    granularity: coerceGranularity(filters.granularity, days),
    kind: USAGE_KINDS.filter((k) => filters.kinds.includes(k)).join(','),
    tenantStatus: filters.tenantStatus,
    includeInternal: String(filters.includeInternal),
  };
  if (filters.product !== 'all') query.product = filters.product;
  if (filters.plan !== 'all') query.plan = filters.plan;
  if (filters.tenantId) query.tenantId = filters.tenantId;
  return query;
}

/* ── Planos e famílias ─────────────────────────────────────────────── */

export function planFamilyOf(plan: UsagePlan | 'all'): UsagePlanFamily | null {
  if (plan === 'all' || plan === 'NONE') return null;
  return (USAGE_FAMILY_PLANS.SAVER as string[]).includes(plan) ? 'SAVER' : 'AFFILIATES';
}

/** Com um plano de uma família escolhido, só os recursos daquela família (`SAVER_PRO` → só Saver). */
export function featureMatchesPlan(feature: Pick<UsageFeatureItem, 'planFamily'>, plan: UsagePlan | 'all'): boolean {
  const family = planFamilyOf(plan);
  return family === null || feature.planFamily === family;
}

/** Recursos que a tela deve mostrar no recorte (defesa: a API já recorta). */
export function visibleFeatures<T extends Pick<UsageFeatureItem, 'planFamily' | 'product' | 'kinds'>>(features: readonly T[], filters: Pick<UsageFilters, 'plan' | 'product' | 'kinds'>): T[] {
  return features.filter((f) =>
    featureMatchesPlan(f, filters.plan)
    && (filters.product === 'all' || f.product === filters.product)
    && f.kinds.some((k) => filters.kinds.includes(k)));
}

/** Famílias que têm recurso na resposta, na ordem fixa. */
export function familiesInSummary(features: readonly Pick<UsageFeatureItem, 'planFamily'>[]): UsagePlanFamily[] {
  return USAGE_PLAN_FAMILIES.filter((fam) => features.some((f) => f.planFamily === fam));
}

export interface PlanMatrixCell {
  plan: UsagePlan;
  /** Denominador: contas do plano no recorte (`population.byPlan` da mesma família). */
  tenants: number;
  activeTenants: number;
  uses: number;
  /** `null` com 0 contas no plano (a tela mostra "—", não "0%"). */
  share: number | null;
}

export interface PlanMatrix {
  family: UsagePlanFamily;
  /** Planos da família na ordem fixa + `NONE` só quando há conta sem plano nela. */
  columns: { plan: UsagePlan; tenants: number }[];
  rows: { key: UsageFeatureKey; cells: PlanMatrixCell[] }[];
}

/** Matriz recurso × plano de uma família. Nunca soma as duas famílias. */
export function buildPlanMatrix(
  summary: Pick<UsageSummary, 'population' | 'features'>,
  family: UsagePlanFamily,
  sort: UsageSort = 'tenants',
): PlanMatrix {
  const tenantsOf = (plan: UsagePlan) =>
    summary.population.byPlan.find((p) => p.family === family && p.plan === plan)?.tenants ?? 0;
  const plans: UsagePlan[] = [...USAGE_FAMILY_PLANS[family]];
  if (tenantsOf('NONE') > 0) plans.push('NONE');
  const columns = plans.map((plan) => ({ plan, tenants: tenantsOf(plan) }));
  const rows = sortFeatures(summary.features.filter((f) => f.planFamily === family), sort).map((f) => ({
    key: f.key,
    cells: columns.map(({ plan, tenants }) => {
      const line = f.byPlan.find((b) => b.plan === plan);
      const activeTenants = line?.activeTenants ?? 0;
      return { plan, tenants, activeTenants, uses: line?.uses ?? 0, share: tenants > 0 ? activeTenants / tenants : null };
    }),
  }));
  return { family, columns, rows };
}

/* ── Tendência ─────────────────────────────────────────────────────── */

export type UsageTrend =
  | { type: 'noBase' }
  | { type: 'flat' }
  | { type: 'new'; delta: number }
  | { type: 'change'; delta: number; ratio: number };

/** Variação contra o período anterior. `previous` nulo = sem base. */
export function usageTrend(current: number, previous: number | null): UsageTrend {
  if (previous === null) return { type: 'noBase' };
  const delta = current - previous;
  if (delta === 0) return { type: 'flat' };
  if (previous === 0) return { type: 'new', delta };
  return { type: 'change', delta, ratio: delta / previous };
}

/** Número para ordenar pela tendência: novo primeiro, sem base por último. */
export function trendSortValue(trend: UsageTrend): number {
  switch (trend.type) {
    case 'new': return Number.POSITIVE_INFINITY;
    case 'change': return trend.ratio;
    case 'flat': return 0;
    default: return Number.NEGATIVE_INFINITY;
  }
}

const signed = (n: number) => (n > 0 ? `+${formatCount(n)}` : n < 0 ? `-${formatCount(-n)}` : '0');

/** "+18%", "-12%", "novo no período", "igual ao período anterior", "sem base de comparação". */
export function formatTrend(trend: UsageTrend): string {
  switch (trend.type) {
    case 'noBase': return S.comparison.noBase;
    case 'flat': return S.comparison.flat;
    case 'new': return S.comparison.newUse;
    default: {
      const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' })
        .format(trend.ratio);
      return pct;
    }
  }
}

/** Tendência dos usos de um recurso. */
export function featureUsesTrend(f: Pick<UsageFeatureItem, 'uses' | 'usesPrevious'>): UsageTrend {
  return usageTrend(f.uses, f.usesPrevious);
}

/** Tendência das contas de um recurso. */
export function featureTenantsTrend(f: Pick<UsageFeatureItem, 'activeTenants' | 'activeTenantsPrevious'>): UsageTrend {
  return usageTrend(f.activeTenants, f.activeTenantsPrevious);
}

/** Comparação de contas para o KPI: "+2 contas" ou "sem base de comparação". */
export function formatTenantsComparison(current: number, previous: number | null): string {
  if (previous === null) return S.comparison.noBase;
  const delta = current - previous;
  return delta === 0 ? S.comparison.flat : S.comparison.tenantsDelta(signed(delta));
}

/** Comparação de usos: "+40 usos" ou "sem base de comparação". */
export function formatUsesComparison(current: number, previous: number | null): string {
  if (previous === null) return S.comparison.noBase;
  const delta = current - previous;
  return delta === 0 ? S.comparison.flat : S.comparison.usesDelta(signed(delta));
}

/** Tom da tendência (cor do texto): sobe = sucesso, cai = aviso, sem base/igual = neutro. */
export function trendTone(trend: UsageTrend): 'success' | 'warning' | 'neutral' {
  if (trend.type === 'new') return 'success';
  if (trend.type === 'change') return trend.delta > 0 ? 'success' : 'warning';
  return 'neutral';
}

/**
 * Referência do período anterior no gráfico de um recurso: média de usos por intervalo, desenhada tracejada.
 * `null` sem base (a API não devolve a série anterior, só o total).
 */
export function previousUsesPerBucket(f: Pick<UsageFeatureItem, 'usesPrevious'>, buckets: number): number | null {
  if (f.usesPrevious === null || buckets <= 0) return null;
  return f.usesPrevious / buckets;
}

/* ── Ordenação e recortes da tela ──────────────────────────────────── */

/** Ordena o ranking. Desempate estável: contas, usos e, por fim, a chave. Não altera a lista recebida. */
export function sortFeatures<T extends Pick<UsageFeatureItem, 'key' | 'uses' | 'usesPrevious' | 'activeTenants'>>(features: readonly T[], sort: UsageSort): T[] {
  const byKey = (a: T, b: T) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const byTenants = (a: T, b: T) => b.activeTenants - a.activeTenants;
  const byUses = (a: T, b: T) => b.uses - a.uses;
  const byTrend = (a: T, b: T) => {
    const va = trendSortValue(featureUsesTrend(a));
    const vb = trendSortValue(featureUsesTrend(b));
    return va === vb ? 0 : vb > va ? 1 : -1;
  };
  const chain: ((a: T, b: T) => number)[] =
    sort === 'uses' ? [byUses, byTenants, byKey]
      : sort === 'trend' ? [byTrend, byTenants, byUses, byKey]
        : [byTenants, byUses, byKey];
  return [...features].sort((a, b) => {
    for (const cmp of chain) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return 0;
  });
}

/** Primeiras `max` barras + quantos ficaram para o "ver todos". */
export function rankingSlice<T>(features: readonly T[], max: number = USAGE_RANKING_MAX_BARS): { visible: T[]; hidden: number } {
  return { visible: features.slice(0, max), hidden: Math.max(0, features.length - max) };
}

/** Recursos do recorte que nenhuma conta usou, por nome. */
export function neverUsedFeatures<T extends Pick<UsageFeatureItem, 'key' | 'activeTenants'>>(features: readonly T[]): T[] {
  return features.filter((f) => f.activeTenants === 0).sort((a, b) => featureLabel(a.key).localeCompare(featureLabel(b.key), 'pt-BR'));
}

/** Total de recursos do recorte (o "N" de "x de N"). */
export function featuresTotal(totals: Pick<UsageSummary['totals'], 'featuresUsed' | 'featuresNeverUsed'>): number {
  return totals.featuresUsed + totals.featuresNeverUsed;
}

/** Recurso mais usado com o número de contas, ou `null` sem uso. */
export function topFeatureOf(summary: Pick<UsageSummary, 'totals' | 'features'>): UsageFeatureItem | null {
  const key = summary.totals.topFeature;
  return key ? summary.features.find((f) => f.key === key) ?? null : null;
}

/** Menor `firstDataDay` dos recursos visíveis ("dados desde" da linha de contexto). Nunca usa `dataFrom`. */
export function earliestFirstDataDay(features: readonly Pick<UsageFeatureItem, 'firstDataDay'>[]): UsageDay | null {
  return features.reduce<UsageDay | null>((min, f) => (f.firstDataDay && (!min || f.firstDataDay < min) ? f.firstDataDay : min), null);
}

/** Textos de cobertura parcial de um recurso (um por código; retenção ganha o número de dias). */
export function coverageTexts(f: Pick<UsageFeatureItem, 'coverageReasons' | 'retentionDays'>): string[] {
  return f.coverageReasons.map((code) => coverageReasonText(code, f.retentionDays));
}

export function coverageReasonText(code: UsageCoverageReason, retentionDays: number | null = null): string {
  const base = S.coverageReasons[code] ?? code;
  return code === 'RETENTION' && retentionDays ? `${base} ${S.coverage.retentionDays(retentionDays)}` : base;
}

/** "Dados desde DD/MM/AAAA" do recurso, por `firstDataDay` (nunca `dataFrom`). */
export function featureDataSince(f: Pick<UsageFeatureItem, 'firstDataDay'>): string {
  return f.firstDataDay ? S.coverage.dataSince(formatDay(f.firstDataDay, true)) : S.coverage.noData;
}

/* ── Rótulos ───────────────────────────────────────────────────────── */

export function featureLabel(key: string): string {
  return (S.features as Record<string, { label: string } | undefined>)[key]?.label ?? S.unknownFeature(key);
}

export function featureDescription(key: string): string {
  return (S.features as Record<string, { description: string } | undefined>)[key]?.description ?? '';
}

export function kindLabel(kind: UsageKind): string {
  return S.kinds[kind] ?? kind;
}

/** Tipos do recurso em minúsculas, para chip ("ação", "automático"). */
export function kindChipLabels(kinds: readonly UsageKind[]): string[] {
  return USAGE_KINDS.filter((k) => kinds.includes(k)).map((k) => S.kindChip[k]);
}

export function productLabel(product: UsageProduct): string {
  return S.products[product] ?? product;
}

export function planLabel(plan: UsagePlan): string {
  return S.plans[plan] ?? plan;
}

/** Chip da conta filtrada: nome já carregado pela lista do detalhe ou o id curto ("Conta 1a2b3c4d"). */
export function accountChipLabel(tenantId: string, loadedName?: string | null): string {
  return loadedName && loadedName.trim() ? loadedName : S.filters.accountShort(tenantId);
}

/* ── Números e datas para exibição ─────────────────────────────────── */

/** Contagem pt-BR; a partir de 10 mil, compacta ("24 mil"). */
export function formatCount(n: number): string {
  if (Math.abs(n) >= 10_000) {
    return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

/** Contagem sem compactar (tabelas e CSV). */
export function formatInteger(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

/** Alcance 0–1 → "53%" (uma casa abaixo de 10%). `null` → "—". */
export function formatReach(reach: number | null | undefined): string {
  if (reach === null || reach === undefined || !Number.isFinite(reach)) return S.measures.noValue;
  return new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: reach > 0 && reach < 0.1 ? 1 : 0 }).format(reach);
}

/** Célula da matriz por plano: "2 de 5" ou "—" sem contas no plano. */
export function formatPlanCell(cell: Pick<PlanMatrixCell, 'activeTenants' | 'tenants'>): string {
  return cell.tenants > 0 ? S.plansTab.cell(formatInteger(cell.activeTenants), formatInteger(cell.tenants)) : S.plansTab.noTenants;
}

/** `YYYY-MM-DD` → "17/11" ou "17/11/2026". Data guardada como dia: sem fuso a converter. */
export function formatDay(day: UsageDay | null | undefined, withYear = false): string {
  if (!day || !isUsageDay(day)) return S.measures.noValue;
  const [y, m, d] = day.split('-');
  return withYear ? `${d}/${m}/${y}` : `${d}/${m}`;
}

/** Rótulo do intervalo do gráfico: dia "17/11", semana "Semana de 17/11", mês "nov. de 2026". */
export function bucketLabel(bucket: UsageDay, granularity: UsageGranularity): string {
  if (granularity === 'day') return formatDay(bucket);
  if (granularity === 'week') return S.trend.weekOf(formatDay(bucket));
  const [y, m] = bucket.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Rótulo curto do eixo: dia/semana "17/11", mês "nov./26". */
export function bucketTick(bucket: UsageDay, granularity: UsageGranularity): string {
  if (granularity !== 'month') return formatDay(bucket);
  const [y, m] = bucket.split('-').map(Number);
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  return `${month}/${String(y).slice(2)}`;
}

/** Hora de Brasília de um instante ISO ("15:02"), para "atualizado às". */
export function formatClock(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return S.measures.noValue;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: USAGE_TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

/** Linha de contexto: fuso · dados desde · atualizado às. */
export function contextLine(input: { firstDataDay: UsageDay | null; freshAt: string }): string {
  const since = input.firstDataDay ? S.context.dataSince(formatDay(input.firstDataDay, true)) : S.context.noDataYet;
  return [S.context.timeZone, since, S.context.updatedAt(formatClock(input.freshAt))].join(' · ');
}

/* ── Erros da API ──────────────────────────────────────────────────── */

export const USAGE_ERROR_CODES = {
  rangeInvalid: 'USAGE_METRICS_RANGE_INVALID',
  featureNotFound: 'USAGE_METRICS_FEATURE_NOT_FOUND',
  cursorInvalid: 'USAGE_METRICS_CURSOR_INVALID',
  readUnavailable: 'USAGE_METRICS_READ_UNAVAILABLE',
  /** Do painel (fila de `adminUsage.service`): pedido descartado antes de ir à rede por um mais novo. Ignorar. */
  readSuperseded: 'USAGE_READ_SUPERSEDED',
} as const;

/** Teto informado no 400 `USAGE_METRICS_RANGE_INVALID` (`meta.maxDays`), ou `null` quando a API não mandou. */
export function rangeInvalidMaxDays(err: unknown): number | null {
  const max = (err as { meta?: { maxDays?: unknown } } | null)?.meta?.maxDays;
  return typeof max === 'number' && Number.isInteger(max) && max > 0 ? max : null;
}

/** Pedido substituído na fila por um mais novo do mesmo canal: não é erro de tela. */
export const isUsageReadSuperseded = (err: unknown): boolean => usageErrorCode(err) === USAGE_ERROR_CODES.readSuperseded;

/** Código do erro normalizado pelo `apiClient` (`{ code }`). */
export function usageErrorCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/* ── CSV ───────────────────────────────────────────────────────────── */

/** Célula de CSV: neutraliza fórmula (`=`, `+`, `-`, `@`, tab, CR) e escapa `;`, aspas e quebra de linha. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV do resumo carregado (BOM, `;`, CRLF): recurso, produto, tipo, usos, contas que usaram, alcance, tendência,
 * último uso. Sem coluna de conta. Ordem do ranking pela ordenação pedida.
 */
export function summaryToCsv(summary: Pick<UsageSummary, 'features'>, sort: UsageSort = 'tenants'): string {
  const lines = [S.csv.columns.map(csvCell).join(';')];
  for (const f of sortFeatures(summary.features, sort)) {
    lines.push([
      featureLabel(f.key),
      productLabel(f.product),
      USAGE_KINDS.filter((k) => f.kinds.includes(k)).map(kindLabel).join(' + '),
      f.uses,
      f.activeTenants,
      formatReach(f.reach),
      formatTrend(featureUsesTrend(f)),
      f.lastUsedDay ? formatDay(f.lastUsedDay, true) : S.measures.never,
    ].map(csvCell).join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Nome do arquivo do CSV pelo período da resposta. */
export function summaryCsvFileName(range: Pick<UsageSummary['range'], 'from' | 'to'>): string {
  return S.csv.fileName(range.from, range.to);
}
