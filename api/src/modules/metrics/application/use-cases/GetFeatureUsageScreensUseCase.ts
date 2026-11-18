import type { IPageViewReader, PageViewScope } from '../../domain/contracts/IPageViewReader';
import type { IUsageReadGate } from '../../domain/contracts/IUsageReadGate';
import type { IUsageTenantDirectory } from '../../domain/contracts/IUsageTenantDirectory';
import { type FeatureUsagePlanFamily, type FeatureUsageProduct } from '../../domain/services/featureUsageCatalog';
import { type UsageTenantEntry, planFamilyOf } from '../../domain/services/aggregateFeatureUsage';
import { addDays, resolveUsagePeriod } from '../../domain/services/featureUsagePeriod';
import { SCREEN_VIEW_CATALOG } from '../../domain/services/screenViewCatalog';
import { type FeatureUsageQueryInput, type FeatureUsageRangeOutput, USAGE_DAILY_MAX_DAYS, rangeOf } from './GetFeatureUsageSummaryUseCase';

export interface FeatureUsageScreenItem {
  key: string;
  product: FeatureUsageProduct;
  planFamily: FeatureUsagePlanFamily;
  /** Contas que abriram a tela no período (não número de aberturas). */
  tenants: number;
  /** Pares dia × conta. */
  tenantDays: number;
}

export interface FeatureUsageScreensOutput {
  range: FeatureUsageRangeOutput;
  /** Primeiro dia com visita gravada (início da coleta); `null` sem visita. */
  firstDataDay: string | null;
  /**
   * `tenants`: contas do recorte (união das famílias). `byFamily`: contas do recorte em cada família em escopo
   * (com plano, as que têm o plano nela), para o alcance de cada tela dividir pelas contas da família dela.
   */
  population: { tenants: number; byFamily: { family: FeatureUsagePlanFamily; tenants: number }[] };
  screens: FeatureUsageScreenItem[];
}

export interface FeatureUsageScreensDeps {
  pageViews: IPageViewReader;
  directory: IUsageTenantDirectory;
  gate: IUsageReadGate;
  now?: () => Date;
}

const planIn = (t: UsageTenantEntry, family: FeatureUsagePlanFamily) => (family === 'SAVER' ? t.saverPlan : t.affiliatesPlan);

/**
 * Aba Telas (P3, USAGE-23): ranking das telas por contas que abriram, lido por consulta própria agregada no banco
 * (nunca pelas linhas do resumo), sob o mesmo portão e orçamento das demais leituras de uso. Recorte de contas igual
 * ao do resumo (status, interna, conta, plano por família) e filtro de produto; o filtro de tipo não vale aqui
 * (toda visita é `ACCESS`). Sempre do agregado: teto de 400 dias.
 */
export class GetFeatureUsageScreensUseCase {
  constructor(private readonly deps: FeatureUsageScreensDeps) {}

  async execute(input: FeatureUsageQueryInput): Promise<FeatureUsageScreensOutput> {
    const now = (this.deps.now ?? (() => new Date()))();
    const period = resolveUsagePeriod({ from: input.from, to: input.to, granularity: input.granularity, now, maxDays: USAGE_DAILY_MAX_DAYS });
    const planFamily = input.plan ? planFamilyOf(input.plan) : null;
    const families: FeatureUsagePlanFamily[] = planFamily ? [planFamily] : ['AFFILIATES', 'SAVER'];
    const screens = SCREEN_VIEW_CATALOG.filter((s) => (!input.product || s.product === input.product) && families.includes(s.planFamily));

    return this.deps.gate.runExclusive(async (budget) => {
      const tenants = await this.deps.directory.list(budget);
      const scoped = tenants.filter(
        (t) =>
          (input.tenantStatus === 'ALL' || t.status === input.tenantStatus) &&
          (input.includeInternal || !t.internal) &&
          (!input.tenantId || t.tenantId === input.tenantId),
      );
      const population = new Set<string>();
      const byFamily: { family: FeatureUsagePlanFamily; tenants: number }[] = [];
      const scopes: PageViewScope[] = families.map((family) => {
        const ids = scoped.filter((t) => !input.plan || planIn(t, family) === input.plan).map((t) => t.tenantId);
        for (const id of ids) population.add(id);
        byFamily.push({ family, tenants: ids.length });
        return { keys: screens.filter((s) => s.planFamily === family).map((s) => s.key), tenantIds: ids };
      });
      const read = await this.deps.pageViews.read({ fromDay: period.from, toDayExclusive: addDays(period.to, 1), scopes }, budget);
      const byKey = new Map(read.rows.map((r) => [r.key, r]));
      return {
        range: rangeOf(period, USAGE_DAILY_MAX_DAYS),
        firstDataDay: read.firstDataDay,
        population: { tenants: population.size, byFamily },
        screens: screens
          .map((s) => ({
            key: s.key,
            product: s.product,
            planFamily: s.planFamily,
            tenants: byKey.get(s.key)?.tenants ?? 0,
            tenantDays: byKey.get(s.key)?.tenantDays ?? 0,
          }))
          .sort((a, b) => b.tenants - a.tenants || b.tenantDays - a.tenantDays || (a.key < b.key ? -1 : 1)),
      };
    });
  }
}
