import type { IFeatureUsageReader } from '../../domain/contracts/IFeatureUsageReader';
import type { IUsageReadGate } from '../../domain/contracts/IUsageReadGate';
import type { IUsageTenantDirectory, UsageTenantDirectoryEntry } from '../../domain/contracts/IUsageTenantDirectory';
import {
  type FeatureUsageAggregate,
  type FeatureUsageFilters,
  type FeatureUsageRow,
  type UsageTenantStatus,
  aggregateFeatureUsage,
  planFamilyOf,
} from '../../domain/services/aggregateFeatureUsage';
import {
  FEATURE_USAGE_CATALOG,
  type FeatureUsageDefinition,
  type FeatureUsageKind,
  type FeatureUsageProduct,
  featuresFor,
} from '../../domain/services/featureUsageCatalog';
import { USAGE_TIME_ZONE, type UsageGranularity, type UsagePeriod, resolveUsagePeriod } from '../../domain/services/featureUsagePeriod';

/** Teto do período sem agregado (P1). Com o agregado da P2 passa a 400. */
export const USAGE_LIVE_MAX_DAYS = 90;

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
  source: 'live';
  freshAt: Date;
  population: FeatureUsageAggregate['population'];
  totals: FeatureUsageAggregate['totals'];
  features: FeatureUsageAggregate['features'];
  series: FeatureUsageAggregate['series'];
}

export interface FeatureUsageDeps {
  reader: IFeatureUsageReader;
  directory: IUsageTenantDirectory;
  gate: IUsageReadGate;
  now?: () => Date;
  catalog?: readonly FeatureUsageDefinition[];
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
}

/**
 * Valida o período (teto da fonte) e lê, numa vaga do gate e com um só orçamento, as linhas do período atual
 * + anterior (janela alargada, uma chamada ao leitor) e depois o diretório de contas, em sequência.
 */
export async function readFeatureUsage(
  deps: FeatureUsageDeps,
  input: FeatureUsageQueryInput,
  features: readonly FeatureUsageDefinition[],
): Promise<FeatureUsageRead> {
  const now = (deps.now ?? (() => new Date()))();
  const period = resolveUsagePeriod({ from: input.from, to: input.to, granularity: input.granularity, now, maxDays: USAGE_LIVE_MAX_DAYS });
  return deps.gate.runExclusive(async (budget) => {
    const read = await deps.reader.read({
      from: period.previousFromInstant,
      toExclusive: period.toExclusive,
      featureKeys: features.map((f) => f.key),
      granularity: period.granularity,
      budget,
    });
    const tenants = await deps.directory.list(budget);
    const firstDataDay: Record<string, string | null> = {};
    for (const f of features) firstDataDay[f.key] = read.firstDataDay[f.key] ?? null;
    return { period, now, rows: read.rows, firstDataDay, tenants };
  });
}

/** Resumo do uso dos recursos (super admin): contas ativas, recursos usados, ranking, série. Sem nome de conta. */
export class GetFeatureUsageSummaryUseCase {
  constructor(private readonly deps: FeatureUsageDeps) {}

  async execute(input: FeatureUsageQueryInput): Promise<FeatureUsageSummaryOutput> {
    const catalog = this.deps.catalog ?? FEATURE_USAGE_CATALOG;
    const filters = toUsageFilters(input);
    const features = scopedFeatures(catalog, filters);
    const read = await readFeatureUsage(this.deps, input, features);
    const agg = aggregateFeatureUsage({
      rows: read.rows,
      firstDataDay: read.firstDataDay,
      tenants: read.tenants,
      catalog,
      period: read.period,
      filters,
      now: read.now,
    });
    return {
      range: rangeOf(read.period, USAGE_LIVE_MAX_DAYS),
      source: 'live',
      freshAt: read.now,
      population: agg.population,
      totals: agg.totals,
      features: agg.features,
      series: agg.series,
    };
  }
}
