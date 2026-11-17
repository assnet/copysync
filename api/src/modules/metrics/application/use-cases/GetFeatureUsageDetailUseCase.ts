import { UsageMetricsFeatureNotFoundError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import { type FeatureUsageAggregate, type FeatureUsageItem, aggregateFeatureUsage } from '../../domain/services/aggregateFeatureUsage';
import { FEATURE_USAGE_CATALOG, type FeatureUsageDefinition, findFeature } from '../../domain/services/featureUsageCatalog';
import {
  type FeatureUsageDeps,
  type FeatureUsageQueryInput,
  type FeatureUsageRangeOutput,
  type FeatureUsageResponseSource,
  rangeOf,
  readFeatureUsage,
  resolveUsageRequestPeriod,
  scopedFeatures,
  usageMaxDaysFor,
  toUsageFilters,
} from './GetFeatureUsageSummaryUseCase';

export interface GetFeatureUsageDetailInput extends FeatureUsageQueryInput {
  featureKey: string;
}

export interface FeatureUsageDetailOutput {
  range: FeatureUsageRangeOutput;
  source: FeatureUsageResponseSource;
  freshAt: Date;
  population: FeatureUsageAggregate['population'];
  /** `false` quando tipo ou plano excluem o recurso: resposta zerada, sem ir ao banco. */
  inScope: boolean;
  feature: FeatureUsageItem;
  series: { bucket: string; uses: number; activeTenants: number }[];
}

/**
 * Recurso do catálogo e se cabe no recorte. O filtro de produto não se aplica (a chave já diz o produto); tipo ou
 * plano de outra família excluem o recurso (`inScope: false`). Só chave fora do catálogo = 404.
 */
export function resolveUsageFeature(
  catalog: readonly FeatureUsageDefinition[],
  input: FeatureUsageQueryInput & { featureKey: string },
): { feature: FeatureUsageDefinition; inScope: boolean } {
  const feature = findFeature(input.featureKey, catalog);
  if (!feature) throw new UsageMetricsFeatureNotFoundError();
  return { feature, inScope: scopedFeatures([feature], { kinds: input.kinds, plan: input.plan }).length > 0 };
}

/** Item zerado do recurso fora do recorte (mesmo formato, sem dado lido). */
function emptyFeatureItem(feature: FeatureUsageDefinition): FeatureUsageItem {
  return {
    key: feature.key,
    product: feature.product,
    planFamily: feature.planFamily,
    kinds: [...feature.kinds],
    coverage: 'FULL',
    coverageReasons: [],
    retentionDays: feature.retentionDays ?? null,
    firstDataDay: null,
    dataFrom: null,
    uses: 0,
    usesPrevious: null,
    activeTenants: 0,
    activeTenantsPrevious: null,
    reach: 0,
    lastUsedDay: null,
    byKind: [],
    byPlan: [],
  };
}

/**
 * Detalhe de um recurso: medidas, quebra por plano e tipo, e a série do recurso. Sem nome de conta. Fora do
 * recorte (tipo/plano) responde zerado com `inScope: false`, sem ocupar a vaga de leitura.
 */
export class GetFeatureUsageDetailUseCase {
  constructor(private readonly deps: FeatureUsageDeps) {}

  async execute(input: GetFeatureUsageDetailInput): Promise<FeatureUsageDetailOutput> {
    const catalog = this.deps.catalog ?? FEATURE_USAGE_CATALOG;
    const { feature, inScope } = resolveUsageFeature(catalog, input);
    if (!inScope) {
      // Sem banco (nem o marco): o maior teto possível; nada é lido, então não há fonte a limitar
      const now = (this.deps.now ?? (() => new Date()))();
      const maxDays = usageMaxDaysFor(this.deps);
      const period = resolveUsageRequestPeriod(input, now, maxDays);
      return {
        range: rangeOf(period, maxDays),
        source: 'live',
        freshAt: now,
        population: { tenants: 0, internalExcluded: 0, byPlan: [] },
        inScope: false,
        feature: emptyFeatureItem(feature),
        series: [],
      };
    }
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
      source: read.source,
    });
    const item = agg.features[0];
    if (!item) throw new UsageMetricsFeatureNotFoundError();
    return {
      range: rangeOf(read.period, read.maxDays),
      source: read.source,
      freshAt: read.freshAt,
      population: agg.population,
      inScope: true,
      feature: item,
      series: agg.featureSeries[feature.key] ?? [],
    };
  }
}
