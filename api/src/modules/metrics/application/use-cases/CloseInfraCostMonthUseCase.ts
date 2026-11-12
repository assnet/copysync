import type { IWorkerScalingSettingsProvider } from '../../../sessions/domain/contracts/IWorkerScalingSettingsProvider';
import type { IInfraCostMonthRepository, InfraCostClosedMonthTenant } from '../../domain/contracts/IInfraCostMonthRepository';
import type { IInfraCostSettingsRepository } from '../../domain/contracts/IInfraCostSettingsRepository';
import type { IInfraCostSnapshotRepository, InfraFxRateRecord } from '../../domain/contracts/IInfraCostSnapshotRepository';
import type { IInfraCostUsageReader } from '../../domain/contracts/IInfraCostUsageReader';
import { resolveClosingFxRate, type SavedFxRate } from '../../domain/services/fxRate';
import { allocateInfraTenantShares, calculateInfraAiCosts, calculateInfraCosts, type InfraCostCalculation, type InfraCostWarning } from '../../domain/services/infraCostCalculator';
import { resolveInfraCostSettings, type InfraCostSettings } from '../../domain/services/infraCostSettings';
import { utcDayOf } from '../../domain/services/infraFxFetchState';
import { utcMonthRange } from './GetInfraCostSummaryUseCase';

const DAY_MS = 86_400_000;

/** Medição que não chegou até o fim do prazo do fechamento. */
export type InfraCostMonthUsageMetric = 'bandwidth' | 'build';

export type InfraCostMonthClosingWarning =
  | InfraCostWarning
  | { code: 'fx_fallback' }
  /** Fechado fora do prazo de espera sem a banda da última hora e/ou o build do último dia. */
  | { code: 'usage_incomplete'; metrics: InfraCostMonthUsageMetric[] };

/**
 * Partes do total fora dos tenants (USD, 4 casas): Σ tenants + `unallocatedUsd` + `excludedUsd` = `totalUsd`
 * (até o arredondamento por tenant).
 */
export interface InfraCostClosedMonthAllocation {
  /** Compartilhado sem base de rateio (aviso `shared_unallocated`). */
  unallocatedUsd: number;
  /** Itens fora do rateio: `allocation: 'excluded'` e IA fixa (categoria `ai`). */
  excludedUsd: number;
}

/** JSON congelado em `infra_cost_months.totals`. */
export interface InfraCostClosedMonthTotals {
  version: 1;
  /** Conta do mês inteiro por hora, IA inclusa (avisos inclusive `fx_fallback`). */
  calculation: Omit<InfraCostCalculation, 'warnings'> & { warnings: InfraCostMonthClosingWarning[] };
  allocation: InfraCostClosedMonthAllocation;
  /** Preços e configuração usados (edição posterior não reescreve). */
  settings: InfraCostSettings;
}

export interface CloseInfraCostMonthInput {
  /** `YYYY-MM`, anterior ao mês de `now`. */
  month: string;
  now: Date;
  /** Fechamento forçado no fim do prazo: medições que faltaram (vira `usage_incomplete`). */
  incompleteUsage?: readonly InfraCostMonthUsageMetric[];
}

export type CloseInfraCostMonthResult = 'closed' | 'already_closed' | 'no_data' | 'not_finished';

export interface CloseInfraCostMonthDeps {
  months: IInfraCostMonthRepository;
  fxRates: Pick<IInfraCostSnapshotRepository, 'latestFxRate'>;
  settings: IInfraCostSettingsRepository;
  usage: IInfraCostUsageReader;
  /** Lido a cada chamada, nunca guardado. */
  scaling: IWorkerScalingSettingsProvider;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const toSaved = (r: InfraFxRateRecord): SavedFxRate => ({ rate: r.rate, referenceDate: utcDayOf(r.referenceDate), source: r.source, fetchedAt: r.fetchedAt });

/**
 * Fecha o mês (COST-15): conta por hora do mês inteiro com a configuração e a cotação de fechamento
 * (`closingMethod`, override vence, sem gravada no mês → última antes com `fx_fallback`), rateio por tenant
 * pela base padrão (contratadas, `allocateInfraTenantShares`; Σ contratadas 0 → sessão-hora; sem as duas →
 * `shared_unallocated`, avisos do calculador) + IA direta (`calculateInfraAiCosts`). Σ tenants + não rateado =
 * compartilhado + IA; + fora do rateio (`excluded` e IA fixa) = total. Idempotente: mês já fechado não
 * muda (preço editado depois não reescreve). Mês sem snapshot não fecha (`no_data`).
 */
export class CloseInfraCostMonthUseCase {
  constructor(private readonly deps: CloseInfraCostMonthDeps) {}

  async execute({ month, now, incompleteUsage }: CloseInfraCostMonthInput): Promise<CloseInfraCostMonthResult> {
    const { start, end } = utcMonthRange(month);
    if (now < end) return 'not_finished';
    const { months, fxRates, settings: settingsRepo, usage: usageReader, scaling } = this.deps;
    if (await months.hasClosedMonth(start)) return 'already_closed';

    const usage = await usageReader.readMonth(start, end);
    if (usage.resourceHours.length === 0 && usage.tenants.length === 0) return 'no_data';
    const lastDay = new Date(end.getTime() - DAY_MS);
    const [record, inMonth, before] = await Promise.all([
      settingsRepo.get(),
      months.fxRatesBetween(start, end),
      fxRates.latestFxRate(new Date(start.getTime() - DAY_MS)),
    ]);
    const settings = resolveInfraCostSettings(record).value;
    const closingFx = resolveClosingFxRate({
      fx: settings.fx,
      method: settings.fx.closingMethod,
      lastDay,
      inMonth: inMonth.map(toSaved),
      before: before ? toSaved(before) : null,
    });
    const { maxSessionsPerWorker, alertOccupancyRatio } = scaling.current().value;
    const calculation = calculateInfraCosts({
      settings,
      fx: closingFx.fx,
      live: { sessionsConnected: null, workerInstances: null, sessionsSampledAt: null },
      now: end,
      capacityByPlan: [],
      scaling: { maxSessionsPerWorker, alertOccupancyRatio },
      hourly: { monthStart: start, monthEnd: end, ...usage },
    });
    // Mesma conta de IA do calculador (preços do fechamento): por tenant, só modelos com preço
    const aiByTenant = calculateInfraAiCosts(settings, usage.aiUsage ?? []).byTenant;
    const { tenants, unallocatedUsd } = monthTenants(calculation.totals.shared.usd, usage.tenants, aiByTenant);
    const warnings: InfraCostMonthClosingWarning[] = [...calculation.warnings];
    if (closingFx.fallback) warnings.push({ code: 'fx_fallback' });
    if (incompleteUsage?.length) warnings.push({ code: 'usage_incomplete', metrics: [...incompleteUsage] });
    const t = calculation.totals;
    // Total − compartilhado − IA direta = itens fora do rateio (`excluded` e IA fixa)
    const allocation = {
      unallocatedUsd: round4(unallocatedUsd),
      excludedUsd: round4(Math.max(0, t.total.usd - t.shared.usd - (t.ai?.usd ?? 0))),
    };
    const totals: InfraCostClosedMonthTotals = { version: 1, calculation: { ...calculation, warnings }, allocation, settings };

    const fx = closingFx.fx;
    const saved = await months.saveClosedMonth({
      month: start,
      closingMethod: settings.fx.closingMethod,
      fx: fx
        ? { rate: fx.rate, referenceDate: new Date(`${fx.referenceDate}T00:00:00Z`), // Fechamento nunca devolve `last_known` (não olha a busca de hoje)
          source: fx.source as 'override' | 'ptax' | 'sgs' }
        : null,
      totalUsd: round4(calculation.totals.total.usd),
      totals: JSON.parse(JSON.stringify(totals)) as Record<string, unknown>,
      tenants,
    });
    return saved ? 'closed' : 'already_closed';
  }
}

/**
 * Compartilhado por contratadas (DD6); Σ contratadas 0 → por sessão-hora; sem as duas → não rateado (devolvido
 * para o aviso). + IA; tenant só com IA entra com parte compartilhada 0.
 */
function monthTenants(
  sharedUsd: number,
  usage: Parameters<typeof allocateInfraTenantShares>[1],
  aiByTenant: ReadonlyMap<string, number>,
): { tenants: InfraCostClosedMonthTenant[]; unallocatedUsd: number } {
  const { shares, perContracted, perSessionHour } = allocateInfraTenantShares(sharedUsd, usage, aiByTenant);
  const byContracted = perContracted !== null;
  const unallocatedUsd = byContracted || perSessionHour !== null ? 0 : sharedUsd;
  const rows = new Map<string, InfraCostClosedMonthTenant>();
  for (const s of shares) {
    const shared = round4((byContracted ? s.contractedShareUsd : s.sessionHourShareUsd) ?? 0);
    const aiUsd = round4(s.aiUsd);
    rows.set(s.tenantId, {
      tenantId: s.tenantId,
      planSlug: s.planSlug,
      contractedAvg: s.contractedAvg,
      sessionHours: s.connectedHours,
      sharedUsd: shared,
      aiUsd,
      totalUsd: round4(shared + aiUsd),
    });
  }
  for (const [tenantId, usd] of aiByTenant) {
    if (rows.has(tenantId)) continue;
    const aiUsd = round4(usd);
    rows.set(tenantId, { tenantId, planSlug: null, contractedAvg: 0, sessionHours: 0, sharedUsd: 0, aiUsd, totalUsd: aiUsd });
  }
  return { tenants: [...rows.values()], unallocatedUsd };
}
