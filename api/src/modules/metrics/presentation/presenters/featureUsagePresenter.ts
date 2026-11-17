import type { FeatureUsageItem } from '../../domain/services/aggregateFeatureUsage';
import type { FeatureUsageSummaryOutput } from '../../application/use-cases/GetFeatureUsageSummaryUseCase';
import type { FeatureUsageDetailOutput } from '../../application/use-cases/GetFeatureUsageDetailUseCase';
import type { ListFeatureUsageTenantsOutput } from '../../application/use-cases/ListFeatureUsageTenantsUseCase';

/**
 * Respostas de `/admin/usage` (design §5; contrato em `contracts/feature-usage/`). Só chaves e números: rótulo é
 * do painel. Adoção, recorrência e retenção entram na P3 (`null` até lá).
 */
function presentFeature(item: FeatureUsageItem) {
  return {
    key: item.key,
    product: item.product,
    planFamily: item.planFamily,
    kinds: [...item.kinds],
    coverage: item.coverage,
    coverageReasons: [...item.coverageReasons],
    retentionDays: item.retentionDays,
    firstDataDay: item.firstDataDay,
    dataFrom: item.dataFrom,
    uses: item.uses,
    usesPrevious: item.usesPrevious,
    activeTenants: item.activeTenants,
    activeTenantsPrevious: item.activeTenantsPrevious,
    reach: item.reach,
    lastUsedDay: item.lastUsedDay,
    byKind: item.byKind.map((k) => ({ kind: k.kind, uses: k.uses, activeTenants: k.activeTenants })),
    byPlan: item.byPlan.map((p) => ({ plan: p.plan, tenants: p.tenants, activeTenants: p.activeTenants, uses: p.uses })),
    eligibleTenants: null as number | null,
    adoption: null as number | null,
    recurringTenants: null as number | null,
    retainedTenants: null as number | null,
  };
}

function presentHead(out: Pick<FeatureUsageSummaryOutput, 'range' | 'source' | 'freshAt' | 'population'>) {
  return {
    range: {
      from: out.range.from,
      to: out.range.to,
      timeZone: out.range.timeZone,
      previousFrom: out.range.previousFrom,
      previousTo: out.range.previousTo,
      granularity: out.range.granularity,
      maxDays: out.range.maxDays,
    },
    source: out.source,
    freshAt: out.freshAt.toISOString(),
    population: {
      tenants: out.population.tenants,
      internalExcluded: out.population.internalExcluded,
      byPlan: out.population.byPlan.map((p) => ({ family: p.family, plan: p.plan, tenants: p.tenants })),
    },
  };
}

export function presentFeatureUsageSummary(out: FeatureUsageSummaryOutput) {
  return {
    ...presentHead(out),
    totals: {
      activeTenants: out.totals.activeTenants,
      activeTenantsPrevious: out.totals.activeTenantsPrevious,
      featuresUsed: out.totals.featuresUsed,
      featuresNeverUsed: out.totals.featuresNeverUsed,
      topFeature: out.totals.topFeature,
    },
    features: out.features.map(presentFeature),
    series: out.series.map((s) => ({ bucket: s.bucket, activeTenants: s.activeTenants })),
  };
}

export function presentFeatureUsageDetail(out: FeatureUsageDetailOutput) {
  return {
    ...presentHead(out),
    inScope: out.inScope,
    feature: presentFeature(out.feature),
    series: out.series.map((s) => ({ bucket: s.bucket, uses: s.uses, activeTenants: s.activeTenants })),
  };
}

export function presentFeatureUsageTenants(out: ListFeatureUsageTenantsOutput) {
  return {
    items: out.items.map((i) => ({
      tenantId: i.tenantId,
      tenantName: i.tenantName,
      plan: i.plan,
      status: i.status,
      internal: i.internal,
      uses: i.uses,
      activeDays: i.activeDays,
      lastUsedDay: i.lastUsedDay,
    })),
    nextCursor: out.nextCursor,
  };
}
