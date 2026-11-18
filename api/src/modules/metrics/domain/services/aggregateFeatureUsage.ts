import { PLAN_SLUGS, SAVER_PLAN_SLUGS } from '../../../tenants/domain/planPresets';
import {
  type FeatureUsageCoverageReason,
  type FeatureUsageCutovers,
  type FeatureUsageDefinition,
  type FeatureUsageKind,
  type FeatureUsagePlanFamily,
  type FeatureUsageProduct,
  featuresFor,
  sourceOn,
} from './featureUsageCatalog';
import { type UsagePeriod, addDays, bucketOf, dataFromOf, dayInZone } from './featureUsagePeriod';
import { type RecurringDays, featureRetentionStats } from './featureUsageRetention';

/**
 * Agregação pura do "Uso dos recursos" (docs: .specs/features/usage-metrics, design §3/§4/§5).
 * Linhas de uso + diretório de contas + filtros → resumo. Sem soma de usos entre recursos e sem usuário.
 */

/** Uma linha de uso: `day` é o dia, ou o início do bucket (semana/mês) quando a fonte já agrupou. */
export interface FeatureUsageRow {
  day: string;
  tenantId: string;
  featureKey: string;
  kind: FeatureUsageKind;
  uses: number;
  /** Dias distintos com uso dentro da linha (1 numa linha por dia). */
  activeDays: number;
  /** Dia mais recente com uso dentro da linha. */
  lastDay: string;
}

/** Plano `NONE` = sem plano ativo na família. */
export const NO_PLAN = 'NONE';

export type UsageTenantStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

/** Conta do diretório, com o plano de cada família já resolvido (slug ou `NONE`). */
export interface UsageTenantEntry {
  tenantId: string;
  affiliatesPlan: string;
  saverPlan: string;
  status: UsageTenantStatus;
  internal: boolean;
}

export interface FeatureUsageFilters {
  product?: FeatureUsageProduct;
  /** Tipos pedidos; vazio = todos. */
  kinds: readonly FeatureUsageKind[];
  /** Slug de plano de uma família, `NONE` ou ausente (todos). */
  plan?: string;
  tenantStatus: UsageTenantStatus | 'ALL';
  includeInternal: boolean;
  tenantId?: string;
}

export interface FeatureUsageKindStat {
  kind: FeatureUsageKind;
  uses: number;
  activeTenants: number;
}

export interface FeatureUsagePlanStat {
  plan: string;
  tenants: number;
  activeTenants: number;
  uses: number;
}

export interface FeatureUsageItem {
  key: string;
  product: FeatureUsageProduct;
  planFamily: FeatureUsagePlanFamily;
  kinds: FeatureUsageKind[];
  coverage: 'FULL' | 'PARTIAL';
  coverageReasons: FeatureUsageCoverageReason[];
  retentionDays: number | null;
  firstDataDay: string | null;
  dataFrom: string | null;
  uses: number;
  usesPrevious: number | null;
  activeTenants: number;
  activeTenantsPrevious: number | null;
  reach: number;
  lastUsedDay: string | null;
  byKind: FeatureUsageKindStat[];
  byPlan: FeatureUsagePlanStat[];
  /** P3: contas do recorte com direito hoje (`null` sem leitura de direito). */
  eligibleTenants: number | null;
  /** P3: contas que usaram ÷ contas com direito, limitada a 1 (`null` sem direito lido ou com 0 contas com direito). */
  adoption: number | null;
  /** P3: contas que usaram sem ter direito hoje (contam na adoção; fora da resposta HTTP). */
  usedWithoutEligibility: number;
  /** P3: contas com uso em ≥ N dias distintos (`null` sem `recurringDays`). */
  recurringTenants: number | null;
  /** P3: contas que usaram no anterior e no atual (`null` sem `recurringDays` ou sem base no período anterior). */
  retainedTenants: number | null;
}

export interface FeatureUsageAggregate {
  population: {
    tenants: number;
    internalExcluded: number;
    byPlan: { family: FeatureUsagePlanFamily; plan: string; tenants: number }[];
  };
  totals: {
    activeTenants: number;
    activeTenantsPrevious: number | null;
    featuresUsed: number;
    featuresNeverUsed: number;
    topFeature: string | null;
  };
  features: FeatureUsageItem[];
  series: { bucket: string; activeTenants: number }[];
  featureSeries: Record<string, { bucket: string; uses: number; activeTenants: number }[]>;
  neverUsed: string[];
}

/** Cobertura do agregado tirada do marco do backfill. */
export interface FeatureUsageDailyCoverage {
  /** Primeiro dia coberto pelo agregado. */
  backfilledFrom: string;
  /** Fim do backfill: fonte podada já tinha perdido o que é mais velho que `completedAt − retenção`. */
  completedAt: Date;
}

export interface AggregateFeatureUsageInput {
  rows: readonly FeatureUsageRow[];
  firstDataDay: Readonly<Record<string, string | null>>;
  tenants: readonly UsageTenantEntry[];
  catalog: readonly FeatureUsageDefinition[];
  period: UsagePeriod;
  filters: FeatureUsageFilters;
  now: Date;
  /**
   * Fonte dos recursos `LIVE` (design §4.5). `daily`: `firstDataDay` é o primeiro dia agregado, sem corte de
   * retenção, e `RETENTION`/`EXISTING_ONLY` só valem para período que começa antes dele. Padrão `live`.
   */
  source?: 'live' | 'daily';
  /** Cortes gravados pelo contador (`AI_HEADLINE_ONLY` só vale antes do corte). Ausente = nenhum. */
  cutovers?: FeatureUsageCutovers;
  /**
   * `daily`: início da cobertura do agregado (do marco). `RETENTION`/`EXISTING_ONLY` e `dataFrom` comparam com ela,
   * não com o primeiro dia com uso. Ausente com `daily` = cobertura desde o primeiro dia agregado.
   */
  coverage?: FeatureUsageDailyCoverage | null;
  /** Descartes do contador por dia × recurso (`DROPPED` quando houver no período atual). Ausente = nenhum. */
  dropped?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /**
   * P3: contas com direito a cada recurso hoje (todas as contas; aqui entra só o recorte da família). Ausente =
   * adoção `null`.
   */
  eligibility?: ReadonlyMap<string, ReadonlySet<string>>;
  /** P3: N da recorrência. Ausente = recorrência e retenção `null`. */
  recurringDays?: RecurringDays;
}

const FAMILY_PLANS: Record<FeatureUsagePlanFamily, readonly string[]> = {
  AFFILIATES: PLAN_SLUGS,
  SAVER: SAVER_PLAN_SLUGS,
};
const FAMILIES: readonly FeatureUsagePlanFamily[] = ['AFFILIATES', 'SAVER'];

/** Família de um slug de plano (o prefixo do Saver decide); `NONE` não tem família. */
export function planFamilyOf(plan: string): FeatureUsagePlanFamily | null {
  if (plan === NO_PLAN) return null;
  return plan.startsWith('SAVER_') ? 'SAVER' : 'AFFILIATES';
}

function planIn(tenant: UsageTenantEntry, family: FeatureUsagePlanFamily): string {
  return family === 'SAVER' ? tenant.saverPlan : tenant.affiliatesPlan;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Contas do recorte por família, já com o filtro de plano aplicado. */
function familyMembers(scoped: readonly UsageTenantEntry[], plan: string | undefined) {
  const planFamily = plan ? planFamilyOf(plan) : null;
  const families = planFamily ? [planFamily] : FAMILIES;
  const members = new Map<FeatureUsagePlanFamily, Map<string, string>>();
  for (const family of families) {
    const byTenant = new Map<string, string>();
    for (const t of scoped) {
      const p = planIn(t, family);
      if (plan && p !== plan) continue;
      byTenant.set(t.tenantId, p);
    }
    members.set(family, byTenant);
  }
  return members;
}

/** Linhas do plano da família: planos conhecidos (respeitando o filtro), slugs desconhecidos achados e `NONE` por último. */
function planRows(family: FeatureUsagePlanFamily, byTenant: Map<string, string>, plan: string | undefined): string[] {
  if (plan) return [plan];
  const known = FAMILY_PLANS[family];
  const unknown = [...new Set(byTenant.values())].filter((p) => p !== NO_PLAN && !known.includes(p)).sort();
  return [...known, ...unknown, NO_PLAN];
}

/**
 * Limite efetivo de comparação. Recurso só do contador: o primeiro dia gravado (`MIN(day)`). Agregado: o primeiro dia agregado (o
 * agregado guarda o que a fonte podada já perdeu). Fonte viva: o maior entre o primeiro dado e hoje − retenção.
 */
function dataFromFor(
  feature: FeatureUsageDefinition,
  first: string | null,
  source: 'live' | 'daily',
  now: Date,
  coveredFrom: string | null,
): string | null {
  if (feature.source === 'RECORDED') return first;
  if (source === 'daily') return first !== null && coveredFrom !== null && coveredFrom > first ? coveredFrom : first;
  return dataFromOf(first, feature.retentionDays, now);
}

/**
 * Início da cobertura do agregado para o recurso: `backfilledFrom`; com retenção, nunca antes de
 * `dia(completedAt) − retenção` (o backfill leu a fonte já podada).
 */
function coveredFromFor(feature: FeatureUsageDefinition, coverage: FeatureUsageDailyCoverage | null | undefined): string | null {
  if (!coverage) return null;
  if (feature.retentionDays === undefined) return coverage.backfilledFrom;
  const pruned = addDays(dayInZone(coverage.completedAt), -feature.retentionDays);
  return pruned > coverage.backfilledFrom ? pruned : coverage.backfilledFrom;
}

function coverageReasonsFor(
  feature: FeatureUsageDefinition,
  period: UsagePeriod,
  today: string,
  source: 'live' | 'daily',
  first: string | null,
  cutover: string | undefined,
  coverage: FeatureUsageDailyCoverage | null | undefined,
  coveredFrom: string | null,
  dropped: AggregateFeatureUsageInput['dropped'],
): FeatureUsageCoverageReason[] {
  // Agregado: compara com o início da cobertura (do marco), não com o primeiro dia com uso. Sem marco informado,
  // o primeiro dia agregado (comportamento anterior)
  const coverageStart = coverage ? coverage.backfilledFrom : first;
  const retentionStart = coverage ? coveredFrom : first;
  const beforeCoverage = coverageStart !== null && period.from < coverageStart;
  const beforeRetention = retentionStart !== null && period.from < retentionStart;
  return feature.possibleCoverageReasons.filter((reason) => {
    switch (reason) {
      case 'RETENTION':
        if (source === 'daily') return beforeRetention;
        return feature.retentionDays !== undefined && period.from < addDays(today, -feature.retentionDays);
      case 'AI_HEADLINE_ONLY':
        // Antes do corte só o título da IA conta; sem corte gravado, o período inteiro
        return cutover === undefined || period.from < cutover;
      case 'EXISTING_ONLY':
        return source === 'daily' ? beforeCoverage : true;
      case 'MIXED_EVENTS':
      case 'MIXED_TRIGGERS':
      case 'TOKEN_CHANGE_ONLY':
        return true;
      case 'DROPPED':
        // Só dia do contador (antes do corte a fonte viva conta tudo) dentro do período atual
        return Object.entries(dropped ?? {}).some(
          ([day, keys]) =>
            day >= period.from && day <= period.to && (keys[feature.key] ?? 0) > 0 && sourceOn(feature, day, cutover ? { [feature.key]: cutover } : {}) === 'RECORDED',
        );
    }
  });
}

interface Acc {
  uses: number;
  tenants: Set<string>;
}
const newAcc = (): Acc => ({ uses: 0, tenants: new Set() });
const add = (acc: Acc, row: FeatureUsageRow) => {
  acc.uses += row.uses;
  acc.tenants.add(row.tenantId);
};

export function aggregateFeatureUsage(input: AggregateFeatureUsageInput): FeatureUsageAggregate {
  const { rows, firstDataDay, tenants, catalog, period, filters, now } = input;
  const source = input.source ?? 'live';
  const today = dayInZone(now);
  const kinds = filters.kinds.length > 0 ? filters.kinds : null;

  // ── Recorte de contas ──
  const byStatus = tenants.filter(
    (t) => (filters.tenantStatus === 'ALL' || t.status === filters.tenantStatus) && (!filters.tenantId || t.tenantId === filters.tenantId),
  );
  const scoped = byStatus.filter((t) => filters.includeInternal || !t.internal);
  const internalExcluded = byStatus.length - scoped.length;
  const members = familyMembers(scoped, filters.plan);

  const populationTenants = new Set<string>();
  const populationByPlan: FeatureUsageAggregate['population']['byPlan'] = [];
  for (const [family, byTenant] of members) {
    for (const id of byTenant.keys()) populationTenants.add(id);
    for (const plan of planRows(family, byTenant, filters.plan)) {
      let count = 0;
      for (const p of byTenant.values()) if (p === plan) count += 1;
      populationByPlan.push({ family, plan, tenants: count });
    }
  }

  // ── Recorte de recursos: produto, tipo e família do plano ──
  const features = featuresFor({ product: filters.product, kinds: kinds ?? undefined }, catalog).filter((f) =>
    members.has(f.planFamily),
  );
  const selected = new Map<string, FeatureUsageDefinition>(features.map((f) => [f.key, f]));

  // ── Linhas do recorte, separadas em atual e anterior ──
  const current = new Map<string, FeatureUsageRow[]>();
  const previous = new Map<string, FeatureUsageRow[]>();
  for (const row of rows) {
    const feature = selected.get(row.featureKey);
    if (!feature) continue;
    if (kinds && !kinds.includes(row.kind)) continue;
    if (!members.get(feature.planFamily)!.has(row.tenantId)) continue;
    const target =
      row.lastDay >= period.from && row.lastDay <= period.to
        ? current
        : row.lastDay >= period.previousFrom && row.lastDay <= period.previousTo
          ? previous
          : null;
    if (!target) continue;
    const list = target.get(row.featureKey) ?? [];
    list.push(row);
    target.set(row.featureKey, list);
  }

  const bucketKeys = period.buckets.map((b) => b.key);
  const overallBuckets = new Map(bucketKeys.map((k) => [k, new Set<string>()]));
  const activeTenants = new Set<string>();
  const activeTenantsPrev = new Set<string>();
  // Total anterior só quando TODO recurso do recorte tem base no período anterior (sem corte de retenção nele).
  let everyHasBase = true;
  const featureSeries: FeatureUsageAggregate['featureSeries'] = {};

  const items: FeatureUsageItem[] = features.map((feature) => {
    const cur = current.get(feature.key) ?? [];
    const prev = previous.get(feature.key) ?? [];
    const familyTenants = members.get(feature.planFamily)!;

    const total = newAcc();
    const kindAcc = new Map<FeatureUsageKind, Acc>();
    const planAcc = new Map<string, Acc>();
    const bucketAcc = new Map(bucketKeys.map((k) => [k, newAcc()]));
    let lastUsedDay: string | null = null;
    for (const row of cur) {
      add(total, row);
      if (!kindAcc.has(row.kind)) kindAcc.set(row.kind, newAcc());
      add(kindAcc.get(row.kind)!, row);
      const plan = familyTenants.get(row.tenantId)!;
      if (!planAcc.has(plan)) planAcc.set(plan, newAcc());
      add(planAcc.get(plan)!, row);
      const bucket = bucketOf(row.day, period.granularity);
      const b = bucketAcc.get(bucket);
      if (b) add(b, row);
      overallBuckets.get(bucket)?.add(row.tenantId);
      activeTenants.add(row.tenantId);
      if (lastUsedDay === null || row.lastDay > lastUsedDay) lastUsedDay = row.lastDay;
    }
    const prevAcc = newAcc();
    for (const row of prev) {
      add(prevAcc, row);
      activeTenantsPrev.add(row.tenantId);
    }

    const first = firstDataDay[feature.key] ?? null;
    const coveredFrom = source === 'daily' ? coveredFromFor(feature, input.coverage) : null;
    const dataFrom = dataFromFor(feature, first, source, now, coveredFrom);
    const hasBase = dataFrom !== null && period.previousFrom >= dataFrom;
    // Recurso que nunca teve dado não tira a base do total (ex.: Telegram sem nenhuma conta); só tira quem começou a
    // ter dado dentro do período anterior ou foi cortado pela retenção.
    if (!hasBase && first !== null) everyHasBase = false;
    const reasons = coverageReasonsFor(feature, period, today, source, first, input.cutovers?.[feature.key], input.coverage, coveredFrom, input.dropped);

    const eligibleAll = input.eligibility?.get(feature.key);
    const eligible = eligibleAll ? new Set([...familyTenants.keys()].filter((id) => eligibleAll.has(id))) : null;
    const retention = featureRetentionStats({
      current: cur,
      previous: prev,
      eligible: input.eligibility ? (eligible ?? new Set()) : null,
      recurringDays: input.recurringDays ?? 3,
      hasPreviousBase: hasBase,
    });
    const withRecurrence = input.recurringDays !== undefined;

    featureSeries[feature.key] = bucketKeys.map((k) => ({
      bucket: k,
      uses: bucketAcc.get(k)!.uses,
      activeTenants: bucketAcc.get(k)!.tenants.size,
    }));

    return {
      key: feature.key,
      product: feature.product,
      planFamily: feature.planFamily,
      kinds: [...feature.kinds],
      coverage: reasons.length > 0 ? 'PARTIAL' : 'FULL',
      coverageReasons: reasons,
      retentionDays: feature.retentionDays ?? null,
      firstDataDay: first,
      dataFrom,
      uses: total.uses,
      usesPrevious: hasBase ? prevAcc.uses : null,
      activeTenants: total.tenants.size,
      activeTenantsPrevious: hasBase ? prevAcc.tenants.size : null,
      reach: familyTenants.size === 0 ? 0 : round4(total.tenants.size / familyTenants.size),
      lastUsedDay,
      byKind: feature.kinds
        .filter((k) => !kinds || kinds.includes(k))
        .map((k) => ({ kind: k, uses: kindAcc.get(k)?.uses ?? 0, activeTenants: kindAcc.get(k)?.tenants.size ?? 0 })),
      byPlan: populationByPlan
        .filter((p) => p.family === feature.planFamily)
        .map((p) => ({
          plan: p.plan,
          tenants: p.tenants,
          activeTenants: planAcc.get(p.plan)?.tenants.size ?? 0,
          uses: planAcc.get(p.plan)?.uses ?? 0,
        })),
      eligibleTenants: retention.eligibleTenants,
      adoption: retention.adoption,
      usedWithoutEligibility: retention.usedWithoutEligibility,
      recurringTenants: withRecurrence ? retention.recurringTenants : null,
      retainedTenants: withRecurrence ? retention.retainedTenants : null,
    };
  });

  const used = items.filter((i) => i.activeTenants > 0);
  const top = [...used].sort((a, b) => b.activeTenants - a.activeTenants || b.uses - a.uses || (a.key < b.key ? -1 : 1))[0];


  return {
    population: { tenants: populationTenants.size, internalExcluded, byPlan: populationByPlan },
    totals: {
      activeTenants: activeTenants.size,
      activeTenantsPrevious: everyHasBase ? activeTenantsPrev.size : null,
      featuresUsed: used.length,
      featuresNeverUsed: items.length - used.length,
      topFeature: top?.key ?? null,
    },
    features: items,
    series: bucketKeys.map((k) => ({ bucket: k, activeTenants: overallBuckets.get(k)!.size })),
    featureSeries,
    neverUsed: items.filter((i) => i.activeTenants === 0).map((i) => i.key),
  };
}

export interface FeatureTenantRank {
  tenantId: string;
  uses: number;
  activeDays: number;
  lastUsedDay: string;
}

/**
 * Contas que usaram o recurso, por `(uses desc, tenantId asc)`. As linhas já devem vir recortadas
 * (período, tipo e contas) pelo chamador; aqui só soma por conta.
 */
export function rankFeatureTenants(rows: readonly FeatureUsageRow[], featureKey: string): FeatureTenantRank[] {
  const byTenant = new Map<string, FeatureTenantRank>();
  // Dias ativos por conta × linha de tempo: tipos diferentes no mesmo dia não somam dia (vale o maior).
  const daysByBucket = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.featureKey !== featureKey) continue;
    const r = byTenant.get(row.tenantId) ?? { tenantId: row.tenantId, uses: 0, activeDays: 0, lastUsedDay: row.lastDay };
    r.uses += row.uses;
    if (row.lastDay > r.lastUsedDay) r.lastUsedDay = row.lastDay;
    byTenant.set(row.tenantId, r);
    const days = daysByBucket.get(row.tenantId) ?? new Map<string, number>();
    days.set(row.day, Math.max(days.get(row.day) ?? 0, row.activeDays));
    daysByBucket.set(row.tenantId, days);
  }
  for (const r of byTenant.values()) {
    for (const n of daysByBucket.get(r.tenantId)!.values()) r.activeDays += n;
  }
  return [...byTenant.values()].sort((a, b) => b.uses - a.uses || (a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0));
}
