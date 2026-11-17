import { UsageMetricsFeatureNotFoundError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import { type FeatureUsageAggregate, type FeatureUsageItem, aggregateFeatureUsage } from '../../domain/services/aggregateFeatureUsage';
import { FEATURE_USAGE_CATALOG, type FeatureUsageDefinition, findFeature } from '../../domain/services/featureUsageCatalog';
import {
  type FeatureUsageDeps,
  type FeatureUsageQueryInput,
  type FeatureUsageRangeOutput,
  USAGE_LIVE_MAX_DAYS,
  rangeOf,
  readFeatureUsage,
  scopedFeatures,
  toUsageFilters,
} from './GetFeatureUsageSummaryUseCase';

export interface GetFeatureUsageDetailInput extends FeatureUsageQueryInput {
  featureKey: string;
}

export interface FeatureUsageDetailOutput {
  range: FeatureUsageRangeOutput;
  source: 'live';
  freshAt: Date;
  population: FeatureUsageAggregate['population'];
  feature: FeatureUsageItem;
  series: { bucket: string; uses: number; activeTenants: number }[];
}

/**
 * Recurso do catálogo dentro do recorte. O filtro de produto não se aplica (a chave já diz o produto); tipo ou
 * plano de outra família que excluem o recurso = 404, como chave fora do catálogo (sem ir ao banco).
 */
export function featureInScope(
  catalog: readonly FeatureUsageDefinition[],
  input: FeatureUsageQueryInput & { featureKey: string },
): FeatureUsageDefinition {
  const feature = findFeature(input.featureKey, catalog);
  if (!feature) throw new UsageMetricsFeatureNotFoundError();
  const inScope = scopedFeatures([feature], { kinds: input.kinds, plan: input.plan }).length > 0;
  if (!inScope) throw new UsageMetricsFeatureNotFoundError();
  return feature;
}

/** Detalhe de um recurso: medidas, quebra por plano e tipo, e a série do recurso. Sem nome de conta. */
export class GetFeatureUsageDetailUseCase {
  constructor(private readonly deps: FeatureUsageDeps) {}

  async execute(input: GetFeatureUsageDetailInput): Promise<FeatureUsageDetailOutput> {
    const catalog = this.deps.catalog ?? FEATURE_USAGE_CATALOG;
    const feature = featureInScope(catalog, input);
    const filters = { ...toUsageFilters(input), product: undefined };
    const read = await readFeatureUsage(this.deps, input, [feature]);
    const agg = aggregateFeatureUsage({
      rows: read.rows,
      firstDataDay: read.firstDataDay,
      tenants: read.tenants,
      catalog: [feature],
      period: read.period,
      filters,
      now: read.now,
    });
    const item = agg.features[0];
    if (!item) throw new UsageMetricsFeatureNotFoundError();
    return {
      range: rangeOf(read.period, USAGE_LIVE_MAX_DAYS),
      source: 'live',
      freshAt: read.now,
      population: agg.population,
      feature: item,
      series: agg.featureSeries[feature.key] ?? [],
    };
  }
}
