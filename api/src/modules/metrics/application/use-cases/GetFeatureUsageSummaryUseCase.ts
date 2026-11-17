import { UsageMetricsRangeInvalidError, UsageMetricsReadUnavailableError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import { logger } from '../../../../shared/logger/logger';
import type { IFeatureEligibilityReader } from '../../domain/contracts/IFeatureEligibilityReader';
import type { IFeatureUsageReader } from '../../domain/contracts/IFeatureUsageReader';
import type { IFeatureUsageRollupStateRepository } from '../../domain/contracts/IFeatureUsageRollupStateRepository';
import type { IUsageReadGate, UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import type { IUsageTenantDirectory, UsageTenantDirectoryEntry } from '../../domain/contracts/IUsageTenantDirectory';
import {
  type FeatureUsageAggregate,
  type FeatureUsageDailyCoverage,
  type FeatureUsageFilters,
  type FeatureUsageRow,
  type UsageTenantStatus,
  aggregateFeatureUsage,
  planFamilyOf,
} from '../../domain/services/aggregateFeatureUsage';
import {
  FEATURE_USAGE_CATALOG,
  type FeatureUsageCutovers,
  type FeatureUsageDefinition,
  type FeatureUsageKey,
  type FeatureUsageKind,
  type FeatureUsageProduct,
  featuresFor,
  isCounted,
  sourceOn,
} from '../../domain/services/featureUsageCatalog';
import { DEFAULT_RECURRING_DAYS, type RecurringDays } from '../../domain/services/featureUsageRetention';
import { USAGE_TIME_ZONE, type UsageGranularity, type UsagePeriod, resolveUsagePeriod } from '../../domain/services/featureUsagePeriod';

/** Teto do período lido sob demanda (tabelas de domínio). */
export const USAGE_LIVE_MAX_DAYS = 90;
/** Teto do período lido do agregado diário (o mesmo teto absoluto do schema). */
export const USAGE_DAILY_MAX_DAYS = 400;
/** Acima disto a leitura nunca é por dia (o schema já recusa `day`; aqui é a segunda trava). */
export const USAGE_DAY_ROWS_MAX_DAYS = 90;
/** O agregado só vale se o último tick bem-sucedido do job tiver menos que isto (job parado ou falhando = velho). */
export const USAGE_DAILY_FRESH_MS = 45 * 60_000;

/** De onde vieram os números dos recursos `LIVE`. */
export type FeatureUsageResponseSource = 'live' | 'daily';

/** Filtros já com os padrões aplicados (o schema da rota resolve os ausentes). */
export interface FeatureUsageQueryInput {
  /** `YYYY-MM-DD` inclusivos, em Brasília. */
  from: string;
  to: string;
  granularity: UsageGranularity;
  product?: FeatureUsageProduct;
  /** Vazio = todos os tipos. */
  kinds: FeatureUsageKind[];
  /** Slug de plano, `NONE` ou ausente (todos). */
  plan?: string;
  tenantStatus: UsageTenantStatus | 'ALL';
  includeInternal: boolean;
  tenantId?: string;
  /** P3, só no resumo: N da recorrência (2, 3 ou 5; padrão 3). Fora do recorte e do cursor. */
  recurringDays?: RecurringDays;
}

export interface FeatureUsageRangeOutput {
  from: string;
  to: string;
  timeZone: string;
  previousFrom: string;
  previousTo: string;
  granularity: UsageGranularity;
  maxDays: number;
}

export interface FeatureUsageSummaryOutput {
  range: FeatureUsageRangeOutput;
  source: FeatureUsageResponseSource;
  freshAt: Date;
  population: FeatureUsageAggregate['population'];
  totals: FeatureUsageAggregate['totals'];
  features: FeatureUsageAggregate['features'];
  series: FeatureUsageAggregate['series'];
}

export interface FeatureUsageDeps {
  /** Leitor sob demanda (tabelas de domínio). */
  reader: IFeatureUsageReader;
  /** Leitor do agregado `feature_usage_daily`. Sem ele (ou sem `rollupState`) tudo é sob demanda e nada é `RECORDED`. */
  dailyReader?: IFeatureUsageReader;
  /** Marco do backfill, lido a cada pedido dentro da vaga e do orçamento. */
  rollupState?: Pick<IFeatureUsageRollupStateRepository, 'get'>;
  directory: IUsageTenantDirectory;
  /** P3: contas com direito a cada recurso (adoção). Sem ele a adoção sai `null`. */
  eligibility?: IFeatureEligibilityReader;
  gate: IUsageReadGate;
  now?: () => Date;
  catalog?: readonly FeatureUsageDefinition[];
  /** Aviso quando o agregado está velho e a leitura cai para a fonte viva. */
  log?: { warn(obj: object, msg: string): void };
}

export function toUsageFilters(input: FeatureUsageQueryInput): FeatureUsageFilters {
  return {
    product: input.product,
    kinds: input.kinds,
    plan: input.plan,
    tenantStatus: input.tenantStatus,
    includeInternal: input.includeInternal,
    tenantId: input.tenantId,
  };
}

/** Recursos do recorte: produto, tipo e família do plano (mesma regra do agregador). */
export function scopedFeatures(
  catalog: readonly FeatureUsageDefinition[],
  filters: Pick<FeatureUsageFilters, 'product' | 'kinds' | 'plan'>,
): FeatureUsageDefinition[] {
  const family = filters.plan ? planFamilyOf(filters.plan) : null;
  return featuresFor({ product: filters.product, kinds: filters.kinds }, catalog).filter((f) => !family || f.planFamily === family);
}

export function rangeOf(period: UsagePeriod, maxDays: number): FeatureUsageRangeOutput {
  return {
    from: period.from,
    to: period.to,
    timeZone: USAGE_TIME_ZONE,
    previousFrom: period.previousFrom,
    previousTo: period.previousTo,
    granularity: period.granularity,
    maxDays,
  };
}

export interface FeatureUsageRead {
  period: UsagePeriod;
  now: Date;
  rows: FeatureUsageRow[];
  firstDataDay: Record<string, string | null>;
  tenants: UsageTenantDirectoryEntry[];
  source: FeatureUsageResponseSource;
  freshAt: Date;
  /** Teto em vigor para a fonte escolhida (`range.maxDays`). */
  maxDays: number;
  /** Cortes gravados pelo contador (lidos com o marco). */
  cutovers: FeatureUsageCutovers;
  /** Cobertura do agregado (do marco), só com `source = daily`. */
  coverage: FeatureUsageDailyCoverage | null;
  /** P3: direito ao recurso hoje, quando pedido. */
  eligibility?: Map<string, Set<string>>;
}

/** Maior teto possível com estas dependências: sem agregado montado, 90 dias; com ele, 400 (o marco decide na vaga). */
export function usageMaxDaysFor(deps: Pick<FeatureUsageDeps, 'dailyReader' | 'rollupState'>): number {
  return deps.dailyReader && deps.rollupState ? USAGE_DAILY_MAX_DAYS : USAGE_LIVE_MAX_DAYS;
}

/**
 * Formato, futuro e o maior teto possível antes de qualquer leitura (sem agregado montado, 91 dias nem abre a
 * vaga); o teto da fonte escolhida é conferido dentro da vaga, depois do marco.
 */
export function resolveUsageRequestPeriod(input: FeatureUsageQueryInput, now: Date, maxDays: number): UsagePeriod {
  return resolveUsagePeriod({ from: input.from, to: input.to, granularity: input.granularity, now, maxDays });
}

/**
 * Fonte do pedido (design §4.4/§4.5). O agregado cobre o período quando o marco do backfill existe e: o backfill
 * parou no primeiro dado (`FIRST_DATA`, nada antes existe: vale qualquer período até 400 dias) ou o período começa em
 * `backfilledFrom` ou depois (`RETENTION`). E só vale fresco:
 * `lastSuccessAt` do job há menos de 45 min. Cobre mas está velho (job desligado ou falhando): até 90 dias cai para a
 * fonte viva com log `warn`; acima, 503 de leitura indisponível — nunca agregado velho em silêncio. Valida o teto da
 * fonte (90 ou 400 dias) e que acima de 90 dias a granularidade não é dia.
 */
export async function chooseUsageSource(
  deps: FeatureUsageDeps,
  period: UsagePeriod,
  budget: UsageReadBudget,
  now: Date = (deps.now ?? (() => new Date()))(),
): Promise<{
  source: FeatureUsageResponseSource;
  maxDays: number;
  freshAt: Date;
  cutovers: FeatureUsageCutovers;
  coverage: FeatureUsageDailyCoverage | null;
}> {
  const state = deps.dailyReader && deps.rollupState ? await deps.rollupState.get(budget) : null;
  const cutovers = state?.cutovers ?? {};
  const covers =
    !!state?.backfillCompletedAt &&
    !!state.backfilledFrom &&
    (state.backfillStopReason === 'FIRST_DATA' || period.from >= state.backfilledFrom);
  const lastSuccessAt = state?.lastSuccessAt ?? null;
  const fresh = lastSuccessAt !== null && now.getTime() - lastSuccessAt.getTime() < USAGE_DAILY_FRESH_MS;
  if (covers && !fresh) {
    if (period.days > USAGE_LIVE_MAX_DAYS) throw new UsageMetricsReadUnavailableError();
    (deps.log ?? logger).warn(
      { lastSuccessAt: lastSuccessAt?.toISOString() ?? null, days: period.days },
      'feature usage daily aggregate stale, reading live sources',
    );
  }
  const daily = covers && fresh;
  const maxDays = daily ? USAGE_DAILY_MAX_DAYS : USAGE_LIVE_MAX_DAYS;
  if (period.days > maxDays) throw new UsageMetricsRangeInvalidError(`range above ${maxDays} days`, maxDays);
  if (period.granularity === 'day' && period.days > USAGE_DAY_ROWS_MAX_DAYS) {
    throw new UsageMetricsRangeInvalidError(`granularity day allows at most ${USAGE_DAY_ROWS_MAX_DAYS} days`, maxDays);
  }
  const coverage = daily ? { backfilledFrom: state!.backfilledFrom!, completedAt: state!.backfillCompletedAt! } : null;
  return { source: daily ? 'daily' : 'live', maxDays, freshAt: daily ? lastSuccessAt! : now, cutovers, coverage };
}

/** Menor dia não nulo. */
const earliest = (a: string | null | undefined, b: string | null | undefined): string | null =>
  a && b ? (a < b ? a : b) : (a ?? b ?? null);

/**
 * Linhas dos recursos na janela `[from, toExclusive)`. Agregado: uma leitura de tudo. Sob demanda: os recursos
 * `LIVE` nas tabelas de domínio (sem os dias a partir do corte gravado) e os do contador no agregado (só os dias do
 * contador): recurso `RECORDED` sempre vem do agregado; `CUTOVER` sem corte gravado é inteiro da fonte viva.
 */
export async function readUsageRows(
  deps: FeatureUsageDeps,
  input: {
    features: readonly FeatureUsageDefinition[];
    from: Date;
    toExclusive: Date;
    currentFrom?: Date;
    granularity: UsageGranularity;
    source: FeatureUsageResponseSource;
    budget: UsageReadBudget;
    cutovers: FeatureUsageCutovers;
  },
): Promise<{ rows: FeatureUsageRow[]; firstDataDay: Record<string, string | null> }> {
  const window = { from: input.from, toExclusive: input.toExclusive, currentFrom: input.currentFrom, granularity: input.granularity, budget: input.budget };
  const firstDataDay: Record<string, string | null> = {};
  for (const f of input.features) firstDataDay[f.key] = null;

  if (input.source === 'daily') {
    const read = await deps.dailyReader!.read({ ...window, featureKeys: input.features.map((f) => f.key) });
    for (const f of input.features) firstDataDay[f.key] = read.firstDataDay[f.key] ?? null;
    return { rows: read.rows, firstDataDay };
  }

  const { cutovers } = input;
  const byKey = new Map<string, FeatureUsageDefinition>(input.features.map((f) => [f.key, f]));
  const liveKeys = input.features.filter((f) => f.source === 'LIVE').map((f) => f.key);
  // `CUTOVER` sem corte gravado: nada do contador a ler
  const counted = deps.dailyReader
    ? input.features.filter((f) => isCounted(f) && (f.recordedFrom !== 'CUTOVER' || cutovers[f.key] !== undefined))
    : [];
  const rows: FeatureUsageRow[] = [];
  if (liveKeys.length > 0 || counted.length === 0) {
    // O leitor sob demanda devolve linha por dia: o dia do contador sai aqui
    const live = await deps.reader.read({ ...window, featureKeys: liveKeys });
    for (const r of live.rows) {
      const f = byKey.get(r.featureKey);
      if (!f || sourceOn(f, r.day, cutovers) === 'LIVE') rows.push(r);
    }
    for (const k of liveKeys) firstDataDay[k] = live.firstDataDay[k] ?? null;
  }
  if (counted.length > 0) {
    // Fonte viva = até 90 dias: linha por dia, e o recorte pelo corte é exato
    const rec = await deps.dailyReader!.read({ ...window, granularity: 'day', featureKeys: counted.map((f) => f.key as FeatureUsageKey) });
    for (const r of rec.rows) {
      const f = byKey.get(r.featureKey);
      if (f && sourceOn(f, r.day, cutovers) === 'RECORDED') rows.push(r);
    }
    for (const f of counted) firstDataDay[f.key] = earliest(firstDataDay[f.key], rec.firstDataDay[f.key]);
  }
  return { rows, firstDataDay };
}

/**
 * Valida o período e lê, numa vaga do gate e com um só orçamento: marco do backfill, linhas do período atual +
 * anterior (janela alargada; o agregado separa os dois lados no SQL) e o diretório de contas, em sequência.
 */
export async function readFeatureUsage(
  deps: FeatureUsageDeps,
  input: FeatureUsageQueryInput,
  features: readonly FeatureUsageDefinition[],
  options: { eligibility?: boolean } = {},
): Promise<FeatureUsageRead> {
  const now = (deps.now ?? (() => new Date()))();
  const period = resolveUsageRequestPeriod(input, now, usageMaxDaysFor(deps));
  return deps.gate.runExclusive(async (budget) => {
    const chosen = await chooseUsageSource(deps, period, budget, now);
    const read = await readUsageRows(deps, {
      features,
      from: period.previousFromInstant,
      toExclusive: period.toExclusive,
      currentFrom: period.fromInstant,
      granularity: period.granularity,
      source: chosen.source,
      budget,
      cutovers: chosen.cutovers,
    });
    const tenants = await deps.directory.list(budget);
    // Mais uma instrução, em sequência, no mesmo orçamento e na mesma vaga
    const eligibility = options.eligibility && deps.eligibility ? await deps.eligibility.read(features, budget) : undefined;
    return {
      eligibility,
      period,
      now,
      rows: read.rows,
      firstDataDay: read.firstDataDay,
      tenants,
      source: chosen.source,
      freshAt: chosen.freshAt,
      maxDays: chosen.maxDays,
      cutovers: chosen.cutovers,
      coverage: chosen.coverage,
    };
  });
}

/** Resumo do uso dos recursos (super admin): contas ativas, recursos usados, ranking, série. Sem nome de conta. */
export class GetFeatureUsageSummaryUseCase {
  constructor(private readonly deps: FeatureUsageDeps) {}

  async execute(input: FeatureUsageQueryInput): Promise<FeatureUsageSummaryOutput> {
    const catalog = this.deps.catalog ?? FEATURE_USAGE_CATALOG;
    const filters = toUsageFilters(input);
    const features = scopedFeatures(catalog, filters);
    const read = await readFeatureUsage(this.deps, input, features, { eligibility: true });
    const agg = aggregateFeatureUsage({
      eligibility: read.eligibility,
      recurringDays: input.recurringDays ?? DEFAULT_RECURRING_DAYS,
      rows: read.rows,
      firstDataDay: read.firstDataDay,
      tenants: read.tenants,
      catalog,
      period: read.period,
      filters,
      now: read.now,
      source: read.source,
      cutovers: read.cutovers,
      coverage: read.coverage,
    });
    return {
      range: rangeOf(read.period, read.maxDays),
      source: read.source,
      freshAt: read.freshAt,
      population: agg.population,
      totals: agg.totals,
      features: agg.features,
      series: agg.series,
    };
  }
}
