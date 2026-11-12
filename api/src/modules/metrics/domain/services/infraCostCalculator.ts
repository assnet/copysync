/**
 * Conta dos custos da infraestrutura (COST-02a/04/05/06a/06b). Função pura: sem env, I/O nem relógio.
 * P1 = `basis: 'snapshot'`: o mês inteiro com as quantidades de agora. Precisão cheia nas somas;
 * só a saída é arredondada a 4 casas (USD e BRL). Divisão por zero → `null`.
 * Ver `.specs/features/infra-costs/design.md` §5.
 */
import { LIMIT_CHANNELS, limitKeyOfChannel, type LimitChannel } from '../../../tenants/domain/channelLimits';
import { PLAN_PRESETS, PLAN_SLUGS, type PlanSlug } from '../../../tenants/domain/planPresets';
import type { WorkerCapacityPlanRow } from '../../../sessions/domain/contracts/IWorkerCapacityReader';
import { OCCUPANCY_SAMPLE_MAX_AGE_MS } from '../../../sessions/domain/services/capacityPlan';
import type { ResolvedFxRate } from './fxRate';
import type {
  InfraCostAllocation,
  InfraCostBilling,
  InfraCostCategory,
  InfraCostItem,
  InfraCostSettings,
  InfraRenderKey,
  InfraRenderResourceType,
} from './infraCostSettings';

// ── Entrada ───────────────────────────────────────────────────────────────────

/** Leitura de um recurso da Render (plano, instâncias, disco). Vazia na P1; o job da P2 preenche. */
export interface InfraResourceReading {
  renderKey: InfraRenderKey;
  /** Plano como a Render devolve; `null` = não lido (vale o cadastro). */
  plan: string | null;
  instances: number | null;
  diskGb: number | null;
  suspended: boolean;
}

/** Leitura de uma hora cheia (P2, `infra_resource_hours`). A T14 implementa `basis: 'hours'`. */
export interface InfraResourceHourReading extends InfraResourceReading {
  hour: Date;
}

export interface InfraCostHourlyInput {
  resourceHours: readonly InfraResourceHourReading[];
}

export interface InfraCostCalculationInput {
  settings: InfraCostSettings;
  /** Cotação já resolvida (`resolveFxRate`); `null` = só USD + aviso `fx_missing`. */
  fx: ResolvedFxRate | null;
  /**
   * Foto do momento (`IInfraCostLiveReader`); `null` = sem amostra. `sessionsSampledAt` = hora da
   * amostra de sessões: mais velha que 10 min (critério de `stale` da capacidade) → não alocadas `null`.
   */
  live: { sessionsConnected: number | null; workerInstances: number | null; sessionsSampledAt: Date | null };
  /** Instante da conta (passado pelo use case; a função não lê relógio). */
  now: Date;
  /** `IWorkerCapacityReader.readByPlan()` (só tenants `ACTIVE`). */
  capacityByPlan: readonly WorkerCapacityPlanRow[];
  /** Configuração de escala lida a cada chamada (nunca guardada). */
  scaling: { maxSessionsPerWorker: number; alertOccupancyRatio: number };
  /** Leitura atual de cada recurso da Render (vazia na P1). */
  resources?: readonly InfraResourceReading[];
  /** Entradas por hora (vazias na P1; a T14 só preenche). */
  hourly?: InfraCostHourlyInput;
}

// ── Saída ─────────────────────────────────────────────────────────────────────
// Mesmos nomes e estrutura de `InfraCostSummary` do painel (`app/src/features/infraCosts/types.ts`):
// o presenter só acrescenta `month`/`generatedAt`, data ISO e `planLabel`/`note` como texto.

/** Valor em USD e BRL, 4 casas. `brl` = `null` sem cotação. */
export interface InfraMoney {
  usd: number;
  brl: number | null;
}

/** `measured_hours` é da P2 (T14). */
export type InfraQuantitySource = 'manual' | 'measured_now' | 'measured_hours';

export interface InfraNeighborPlan {
  plan: string;
  monthly: InfraMoney;
  /** Plano vizinho − atual (negativo = mais barato). */
  diff: InfraMoney;
}

export interface InfraCostItemResult {
  key: string;
  label: string;
  category: InfraCostCategory;
  billing: InfraCostBilling;
  renderKey: InfraRenderKey | null;
  planLabel: string | null;
  /** Plano lido na Render (`null` sem leitura). */
  plan: string | null;
  quantity: number;
  quantitySource: InfraQuantitySource;
  allocation: InfraCostAllocation;
  /** Computação/plano; `null` = plano lido sem preço. */
  compute: InfraMoney | null;
  /** Armazenamento; `null` = não se aplica ou a confirmar. */
  storage: InfraMoney | null;
  storageToConfirm: boolean;
  /** compute + storage; `null` = sem preço (fora do total; `totalIsPartial`). */
  cost: InfraMoney | null;
  /** Usa quantidade manual (selo "estimado"). */
  estimated: boolean;
  /** Plano imediatamente abaixo/acima em `renderPlanPrices` (COST-02a); `null` sem tipo de plano. */
  neighbors: { lower: InfraNeighborPlan | null; upper: InfraNeighborPlan | null } | null;
}

export interface InfraWorkspaceUsageResult {
  included: number;
  /** Manual na P1; `null` = sem valor (excedente 0). */
  consumed: number | null;
  /** `measured` é da P2. */
  source: 'manual' | 'measured' | null;
  overage: number;
  cost: InfraMoney;
}

export interface InfraWorkspaceResult {
  planLabel: string;
  /** GB. */
  bandwidth: InfraWorkspaceUsageResult;
  /** Minutos. */
  build: InfraWorkspaceUsageResult;
  total: InfraMoney;
}

export interface InfraCostPlanResult {
  planSlug: string | null;
  tenants: number;
  /** Contratadas efetivas (ilimitado pelo preset do canal). */
  contractedSessions: number;
  connectedSessions: number;
  /** Parte do plano na base contratadas. */
  share: InfraMoney | null;
  /** Tenant médio = parte ÷ tenants `ACTIVE` do plano (0 → `null`). */
  costPerTenant: InfraMoney | null;
  connectedShare: InfraMoney | null;
  connectedCostPerTenant: InfraMoney | null;
}

export type InfraCostWarning =
  | { code: 'storage_to_confirm'; key: string }
  | { code: 'plan_without_price'; resourceKey: InfraRenderKey; plan: string }
  | { code: 'unlimited_contracted'; count: number }
  | { code: 'fx_missing' }
  /** Amostra de sessões com mais de 10 min: não alocadas sem número (dois relógios não se comparam). */
  | { code: 'sessions_sample_stale' };

export interface InfraCostCalculation {
  basis: 'snapshot';
  fx: ResolvedFxRate | null;
  /** Hora da amostra de sessões usada (`null` = sem amostra). */
  sessionsSampledAt: Date | null;
  /** Algum item sem preço ficou fora do total. */
  totalIsPartial: boolean;
  totals: {
    total: InfraMoney;
    /** Itens `fixed` e armazenamento. */
    fixed: InfraMoney;
    /** Computação `per_instance`, itens `usage` e excedente do workspace. */
    variable: InfraMoney;
    /** Base do rateio: itens `shared` (exceto IA) + excedente do workspace. */
    shared: InfraMoney;
    /** P2+; `null` na foto. */
    projected: InfraMoney | null;
  };
  items: InfraCostItemResult[];
  workspace: InfraWorkspaceResult;
  perSession: {
    contracted: { sessions: number; perSession: InfraMoney | null; unlimitedTenants: number };
    /** Não alocadas = conectadas do cluster fora dos tenants `ACTIVE`: referência, fora do rateio. */
    connected: { sessions: number; perSession: InfraMoney | null; unallocatedSessions: number | null; unallocatedCost: InfraMoney | null };
  };
  /** Preço da instância do worker ÷ (teto × ratio de alerta). */
  marginalPerSession: InfraMoney | null;
  plans: InfraCostPlanResult[];
  warnings: InfraCostWarning[];
}

// ── Conta ─────────────────────────────────────────────────────────────────────

const RESOURCE_TYPE_OF: Record<InfraRenderKey, InfraRenderResourceType | null> = {
  api: 'service',
  worker: 'service',
  redis: 'key_value',
  postgres: 'postgres',
  static: null, // site estático não tem plano de computação
};

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

function money(usd: number, fx: ResolvedFxRate | null): InfraMoney {
  return { usd: round4(usd), brl: fx ? round4(usd * fx.rate) : null };
}

function maybeMoney(usd: number | null, fx: ResolvedFxRate | null): InfraMoney | null {
  return usd === null ? null : money(usd, fx);
}

/** Limite de sessões do preset no canal para tenant ilimitado; sem plano/preset numérico = 1. */
function presetSessions(planSlug: string | null, channel: LimitChannel): number {
  if (planSlug === null || !(PLAN_SLUGS as readonly string[]).includes(planSlug)) return 1;
  const value = PLAN_PRESETS[planSlug as PlanSlug][limitKeyOfChannel('sessions', channel)];
  return typeof value === 'number' ? value : 1;
}

/** Contratadas efetivas do plano (COST-05). */
export function effectiveContractedSessions(row: WorkerCapacityPlanRow): number {
  return LIMIT_CHANNELS.reduce(
    (sum, ch) => sum + row.contracted[ch] + row.unlimitedTenants[ch] * presetSessions(row.planSlug, ch),
    0,
  );
}

const sumChannels = (counts: Record<LimitChannel, number>): number => LIMIT_CHANNELS.reduce((s, ch) => s + counts[ch], 0);

interface ItemCalc {
  result: InfraCostItemResult;
  computeUsd: number | null;
  storageUsd: number | null;
  /** Preço mensal de uma instância (marginal). */
  unitUsd: number | null;
}

function priceOf(settings: InfraCostSettings, type: InfraRenderResourceType, plan: string): number | null {
  return settings.renderPlanPrices.find((p) => p.resourceType === type && p.plan === plan)?.monthlyUsd ?? null;
}

function neighborsOf(
  settings: InfraCostSettings,
  type: InfraRenderResourceType,
  currentUsd: number,
  fx: ResolvedFxRate | null,
): InfraCostItemResult['neighbors'] {
  const prices = settings.renderPlanPrices.filter((p) => p.resourceType === type);
  const lower = prices.filter((p) => p.monthlyUsd < currentUsd).sort((a, b) => b.monthlyUsd - a.monthlyUsd)[0];
  const upper = prices.filter((p) => p.monthlyUsd > currentUsd).sort((a, b) => a.monthlyUsd - b.monthlyUsd)[0];
  const toNeighbor = (p: (typeof prices)[number] | undefined): InfraNeighborPlan | null =>
    p ? { plan: p.plan, monthly: money(p.monthlyUsd, fx), diff: money(p.monthlyUsd - currentUsd, fx) } : null;
  return { lower: toNeighbor(lower), upper: toNeighbor(upper) };
}

function calculateItem(
  item: InfraCostItem,
  input: InfraCostCalculationInput,
  warnings: InfraCostWarning[],
): ItemCalc {
  const { settings, fx } = input;
  const reading = item.renderKey ? input.resources?.find((r) => r.renderKey === item.renderKey) : undefined;
  const type = item.renderKey ? RESOURCE_TYPE_OF[item.renderKey] : null;

  // Preço mensal da computação: plano lido (se houver) vence o cadastrado.
  let unitUsd: number | null = item.monthlyUsd;
  if (reading?.plan && type) {
    unitUsd = priceOf(settings, type, reading.plan);
    if (unitUsd === null) warnings.push({ code: 'plan_without_price', resourceKey: item.renderKey!, plan: reading.plan });
  }

  // Quantidade: worker pelas amostras, depois a leitura da Render, senão o manual.
  let quantity = item.quantity;
  let quantitySource: InfraQuantitySource = 'manual';
  if (item.billing === 'per_instance') {
    const measured = item.renderKey === 'worker' && input.live.workerInstances !== null ? input.live.workerInstances : reading?.instances ?? null;
    if (measured !== null) {
      quantity = measured;
      quantitySource = 'measured_now';
    }
  }

  let computeUsd: number | null;
  if (unitUsd === null) computeUsd = null;
  else if (reading?.suspended) computeUsd = 0;
  else if (item.billing === 'usage') computeUsd = unitUsd;
  else computeUsd = unitUsd * quantity;

  // Armazenamento: não multiplica por instância; disco lido vence o cadastrado.
  let storageUsd: number | null = null;
  let storageToConfirm = false;
  if (item.storage) {
    const gb = reading?.diskGb ?? item.storage.gb;
    if (gb === null || item.storage.usdPerGb === null) {
      storageToConfirm = true;
      warnings.push({ code: 'storage_to_confirm', key: item.key });
    } else {
      storageUsd = gb * item.storage.usdPerGb;
    }
  }

  const totalUsd = computeUsd === null ? null : computeUsd + (storageUsd ?? 0);
  const neighbors = type && unitUsd !== null ? neighborsOf(settings, type, unitUsd, fx) : null;

  return {
    computeUsd,
    storageUsd,
    unitUsd,
    result: {
      key: item.key,
      label: item.label,
      category: item.category,
      billing: item.billing,
      renderKey: item.renderKey,
      planLabel: item.planLabel,
      plan: reading?.plan ?? null,
      quantity,
      quantitySource,
      allocation: item.allocation,
      compute: maybeMoney(computeUsd, fx),
      storage: maybeMoney(storageUsd, fx),
      storageToConfirm,
      cost: maybeMoney(totalUsd, fx),
      estimated: quantitySource === 'manual',
      neighbors,
    },
  };
}

function workspaceUsage(
  included: number,
  manual: number | null,
  usdPerUnit: number,
  fx: ResolvedFxRate | null,
): { view: InfraWorkspaceUsageResult; costUsd: number } {
  const overage = manual === null ? 0 : Math.max(0, manual - included);
  const costUsd = overage * usdPerUnit;
  return {
    view: { included, consumed: manual, source: manual === null ? null : 'manual', overage, cost: money(costUsd, fx) },
    costUsd,
  };
}

function planShare(sessions: number, perSessionUsd: number | null, tenants: number, fx: ResolvedFxRate | null) {
  const shareUsd = perSessionUsd === null ? null : sessions * perSessionUsd;
  return {
    share: maybeMoney(shareUsd, fx),
    perTenant: maybeMoney(shareUsd === null ? null : div(shareUsd, tenants), fx),
  };
}

/** Custos do mês (P1: foto do momento). */
export function calculateInfraCosts(input: InfraCostCalculationInput): InfraCostCalculation {
  const { settings, fx } = input;
  const warnings: InfraCostWarning[] = [];
  const calcs = settings.items.map((item) => calculateItem(item, input, warnings));

  const ws = settings.workspace;
  const bandwidth = workspaceUsage(ws.includedBandwidthGb, ws.manualBandwidthGb, ws.bandwidthUsdPerGb, fx);
  const build = workspaceUsage(ws.includedBuildMinutes, ws.manualBuildMinutes, ws.buildUsdPer1000Min / 1000, fx);
  const workspaceUsd = bandwidth.costUsd + build.costUsd;

  let totalUsd = workspaceUsd;
  let fixedUsd = 0;
  let variableUsd = workspaceUsd;
  let sharedUsd = workspaceUsd;
  for (const { result, computeUsd, storageUsd } of calcs) {
    if (computeUsd === null) continue;
    const itemUsd = computeUsd + (storageUsd ?? 0);
    totalUsd += itemUsd;
    fixedUsd += storageUsd ?? 0;
    if (result.billing === 'fixed') fixedUsd += computeUsd;
    else variableUsd += computeUsd;
    if (result.allocation === 'shared' && result.category !== 'ai') sharedUsd += itemUsd;
  }

  // Rateio (COST-05).
  const rows = input.capacityByPlan;
  const contractedTotal = rows.reduce((s, r) => s + effectiveContractedSessions(r), 0);
  const connectedTotal = rows.reduce((s, r) => s + sumChannels(r.connected), 0);
  const unlimited = rows.reduce((s, r) => s + sumChannels(r.unlimitedTenants), 0);
  if (unlimited > 0) warnings.push({ code: 'unlimited_contracted', count: unlimited });
  const perContracted = div(sharedUsd, contractedTotal);
  const perConnected = div(sharedUsd, connectedTotal);

  const plans: InfraCostPlanResult[] = rows.map((row) => {
    const contractedSessions = effectiveContractedSessions(row);
    const connectedSessions = sumChannels(row.connected);
    const contracted = planShare(contractedSessions, perContracted, row.tenants, fx);
    const connected = planShare(connectedSessions, perConnected, row.tenants, fx);
    return {
      planSlug: row.planSlug,
      tenants: row.tenants,
      contractedSessions,
      connectedSessions,
      share: contracted.share,
      costPerTenant: contracted.perTenant,
      connectedShare: connected.share,
      connectedCostPerTenant: connected.perTenant,
    };
  });

  // Σ conectadas vem do lease agora; o cluster, da amostra: só compara com amostra recente.
  const sampledAt = input.live.sessionsSampledAt;
  const sampleStale = sampledAt !== null && input.now.getTime() - sampledAt.getTime() > OCCUPANCY_SAMPLE_MAX_AGE_MS;
  if (sampleStale) warnings.push({ code: 'sessions_sample_stale' });
  const clusterConnected = sampleStale || sampledAt === null ? null : input.live.sessionsConnected;
  const unallocatedSessions = clusterConnected === null ? null : Math.max(0, clusterConnected - connectedTotal);
  const unallocatedUsd = unallocatedSessions === null || perConnected === null ? null : unallocatedSessions * perConnected;

  const worker = calcs.find((c) => c.result.renderKey === 'worker');
  const marginalUsd =
    worker?.unitUsd != null ? div(worker.unitUsd, input.scaling.maxSessionsPerWorker * input.scaling.alertOccupancyRatio) : null;

  if (!fx) warnings.push({ code: 'fx_missing' });

  return {
    basis: 'snapshot',
    fx,
    sessionsSampledAt: input.live.sessionsSampledAt,
    totalIsPartial: calcs.some((c) => c.computeUsd === null),
    totals: {
      total: money(totalUsd, fx),
      fixed: money(fixedUsd, fx),
      variable: money(variableUsd, fx),
      shared: money(sharedUsd, fx),
      projected: null,
    },
    items: calcs.map((c) => c.result),
    workspace: { planLabel: ws.planLabel, bandwidth: bandwidth.view, build: build.view, total: money(workspaceUsd, fx) },
    perSession: {
      contracted: { sessions: contractedTotal, perSession: maybeMoney(perContracted, fx), unlimitedTenants: unlimited },
      connected: {
        sessions: connectedTotal,
        perSession: maybeMoney(perConnected, fx),
        unallocatedSessions,
        unallocatedCost: maybeMoney(unallocatedUsd, fx),
      },
    },
    marginalPerSession: maybeMoney(marginalUsd, fx),
    plans,
    warnings,
  };
}
