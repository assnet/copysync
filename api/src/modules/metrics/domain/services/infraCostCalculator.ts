/**
 * Conta dos custos da infraestrutura (COST-02a/04/05/06a/06b). Função pura: sem env, I/O nem relógio.
 * P1 = `basis: 'snapshot'`: o mês inteiro com as quantidades de agora. P2 = `basis: 'hours'` (com `hourly`):
 * Σ por hora cheia do mês (COST-11) e rateio por contratadas médias e sessão-hora (COST-12). Precisão cheia nas somas;
 * só a saída é arredondada a 4 casas (USD e BRL). Divisão por zero → `null`.
 * Ver `.specs/features/infra-costs/design.md` §5.
 */
import { LIMIT_CHANNELS, limitKeyOfChannel, type LimitChannel } from '../../../tenants/domain/channelLimits';
import { PLAN_PRESETS, PLAN_SLUGS, type PlanSlug } from '../../../tenants/domain/planPresets';
import type { WorkerCapacityPlanRow } from '../../../sessions/domain/contracts/IWorkerCapacityReader';
import { OCCUPANCY_SAMPLE_MAX_AGE_MS } from '../../../sessions/domain/services/capacityPlan';
import type { ResolvedFxRate } from './fxRate';
import { infraResourceDriftFields } from './infraResourceDrift';
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

/** Leitura de uma hora cheia (P2, `infra_resource_hours`). */
export interface InfraResourceHourReading extends InfraResourceReading {
  hour: Date;
}

/** Um tenant no mês (`tenant_session_hours`): plano do último dia, sessão-hora e contratadas médias. */
export interface InfraTenantMonthUsage {
  tenantId: string;
  planSlug: string | null;
  connectedHours: number;
  /** Média horária das contratadas efetivas (Σ `contractedSessions` ÷ Σ `contractedSamples`). */
  contractedAvg: number;
}

/** Entradas da conta por hora (P2): `IInfraCostUsageReader.readMonth`. */
export interface InfraCostHourlyInput {
  /** Início (incl.) e fim (excl.) do mês em UTC; horas do mês = (fim − início) ÷ 1 h. */
  monthStart: Date;
  monthEnd: Date;
  resourceHours: readonly InfraResourceHourReading[];
  /** Σ `infra_usage_daily` do mês; `null` = sem medição. */
  bandwidthGb: number | null;
  /**
   * Horas do mês com linha de banda (Σ por dia do maior `hours` entre os serviços). Ausente = não avisa
   * `bandwidth_missing_hours`.
   */
  bandwidthHours?: number;
  buildMinutes: number | null;
  tenants: readonly InfraTenantMonthUsage[];
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
  /** Entradas por hora (P2): presente = `basis: 'hours'`. */
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

/** `measured_hours` = alguma hora do mês lida (P2). */
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
  /**
   * Horas: parte e tenant médio na base contratadas com o compartilhado **projetado** para o mês cheio (base
   * da margem do mês corrente); `null` na foto.
   */
  projectedShare: InfraMoney | null;
  projectedCostPerTenant: InfraMoney | null;
}

export type InfraCostWarning =
  | { code: 'storage_to_confirm'; key: string }
  | { code: 'plan_without_price'; resourceKey: InfraRenderKey; plan: string }
  | { code: 'unlimited_contracted'; count: number }
  /** Horas do mês sem leitura do recurso: usam a quantidade manual. */
  | { code: 'missing_hours'; resourceKey: InfraRenderKey; count: number }
  /** Cadastro diferente do lido (plano pelo preço, instâncias, disco). */
  | { code: 'config_drift'; resourceKey: InfraRenderKey; field: 'plan' | 'instances' | 'diskGb' }
  | { code: 'fx_missing' }
  /** Amostra de sessões com mais de 10 min: não alocadas sem número (dois relógios não se comparam). */
  | { code: 'sessions_sample_stale' }
  /** Horas do mês sem banda lida (a soma medida fica abaixo do real). */
  | { code: 'bandwidth_missing_hours'; count: number }
  /** Horas do mês sem leitura do worker: a ociosidade cobre só as horas lidas. */
  | { code: 'idle_partial'; count: number };

export interface InfraCostCalculation {
  basis: 'snapshot' | 'hours';
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
    /** P2: realizado + última hora × horas restantes + excedente projetado; `null` na foto. */
    projected: InfraMoney | null;
  };
  items: InfraCostItemResult[];
  workspace: InfraWorkspaceResult;
  perSession: {
    contracted: { sessions: number; perSession: InfraMoney | null; unlimitedTenants: number };
    /** Não alocadas = conectadas do cluster fora dos tenants `ACTIVE`: referência, fora do rateio. */
    /**
     * Foto: `sessions` = conectadas agora. Horas: média de conectadas no período, `perSession` = sessão-mês
     * (sessão-hora × 730), mais `sessionHours` e `perSessionHour`.
     */
    connected: {
      sessions: number;
      perSession: InfraMoney | null;
      unallocatedSessions: number | null;
      unallocatedCost: InfraMoney | null;
      sessionHours?: number;
      perSessionHour?: InfraMoney | null;
    };
  };
  /** Horas: compartilhado × (1 − sessão-hora ÷ capacidade instalada-hora); `null` na foto ou sem leitura do worker. */
  idleCapacity: InfraMoney | null;
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
export function presetSessions(planSlug: string | null, channel: LimitChannel): number {
  if (planSlug === null || !(PLAN_SLUGS as readonly string[]).includes(planSlug)) return 1;
  const value = PLAN_PRESETS[planSlug as PlanSlug][limitKeyOfChannel('sessions', channel)];
  return typeof value === 'number' ? value : 1;
}

/** Contratadas efetivas de um tenant: limite numérico por canal; `null` (ilimitado) = preset do plano (COST-05). */
export function effectiveTenantContractedSessions(planSlug: string | null, limits: Record<LimitChannel, number | null>): number {
  return LIMIT_CHANNELS.reduce((sum, ch) => sum + (limits[ch] ?? presetSessions(planSlug, ch)), 0);
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
  /** Horas: realizado + última hora × horas restantes; `null` = sem preço ou foto. */
  projectedUsd: number | null;
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
    projectedUsd: null,
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
    view: { included, consumed: manual === null ? null : round4(manual), source: manual === null ? null : 'manual', overage: round4(overage), cost: money(costUsd, fx) },
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

const HOUR_MS = 3_600_000;
/** Horas médias de um mês (sessão-hora → sessão-mês, COST-12). */
export const INFRA_SESSION_MONTH_HOURS = 730;

/** Plano esperado pelo cadastro: o plano de mesmo tipo com o preço do item (o rótulo é só texto). */
function expectedPlan(settings: InfraCostSettings, item: InfraCostItem, type: InfraRenderResourceType, readPlan: string | null): string | null {
  const same = settings.renderPlanPrices.filter((p) => p.resourceType === type && p.monthlyUsd === item.monthlyUsd).map((p) => p.plan);
  if (readPlan !== null && same.includes(readPlan)) return readPlan;
  return same[0] ?? null;
}

/**
 * `config_drift`: plano (pelo preço do cadastro), instâncias (só `per_instance`, fora o worker, que escala
 * sozinho) e disco. Plano lido sem preço já sai como `plan_without_price`, não como divergência.
 */
function pushDrift(
  item: InfraCostItem,
  reading: InfraResourceReading | undefined,
  settings: InfraCostSettings,
  warnings: InfraCostWarning[],
): void {
  if (!item.renderKey || !reading) return;
  const type = RESOURCE_TYPE_OF[item.renderKey];
  const readPriced = type && reading.plan !== null && priceOf(settings, type, reading.plan) !== null;
  const fields = infraResourceDriftFields(
    { plan: readPriced ? reading.plan : null, instances: reading.instances, diskGb: reading.diskGb },
    {
      plan: type ? expectedPlan(settings, item, type, reading.plan) : null,
      instances: item.billing === 'per_instance' && item.renderKey !== 'worker' ? item.quantity : null,
      diskGb: item.storage?.gb ?? null,
    },
  );
  for (const field of fields) warnings.push({ code: 'config_drift', resourceKey: item.renderKey, field });
}

interface HoursContext {
  hoursInMonth: number;
  /** Horas cheias já terminadas no mês (as que deveriam ter leitura). */
  elapsed: number;
  /** Leitura por recurso e índice da hora no mês. */
  byKey: Map<InfraRenderKey, Map<number, InfraResourceHourReading>>;
}

function hoursContext(input: InfraCostCalculationInput, hourly: InfraCostHourlyInput): HoursContext {
  const start = hourly.monthStart.getTime();
  const hoursInMonth = Math.max(1, Math.round((hourly.monthEnd.getTime() - start) / HOUR_MS));
  const elapsed = Math.min(hoursInMonth, Math.max(0, Math.floor((input.now.getTime() - start) / HOUR_MS)));
  const byKey = new Map<InfraRenderKey, Map<number, InfraResourceHourReading>>();
  for (const r of hourly.resourceHours) {
    const idx = Math.floor((r.hour.getTime() - start) / HOUR_MS);
    if (idx < 0 || idx >= elapsed) continue;
    if (!byKey.has(r.renderKey)) byKey.set(r.renderKey, new Map());
    byKey.get(r.renderKey)!.set(idx, r);
  }
  return { hoursInMonth, elapsed, byKey };
}

/** Item por hora (COST-11): hora lida = preço do plano lido × instâncias; hora sem leitura = manual. */
function calculateItemHours(
  item: InfraCostItem,
  input: InfraCostCalculationInput,
  ctx: HoursContext,
  warnings: InfraCostWarning[],
): ItemCalc {
  const { settings, fx } = input;
  const H = ctx.hoursInMonth;
  const type = item.renderKey ? RESOURCE_TYPE_OF[item.renderKey] : null;
  const readings = item.renderKey ? ctx.byKey.get(item.renderKey) : undefined;
  const unpricedPlans = new Set<string>();
  let missing = 0;
  let computeUsd = 0;
  let storageUsd = 0;
  let storageToConfirm = false;
  let last: InfraResourceHourReading | undefined;

  const slot = (r: InfraResourceHourReading | undefined) => {
    let unit: number | null = item.monthlyUsd;
    if (r?.plan && type) {
      unit = priceOf(settings, type, r.plan);
      if (unit === null) unpricedPlans.add(r.plan);
    }
    const qty = item.billing === 'per_instance' && r && r.instances !== null ? r.instances : item.quantity;
    let compute: number | null;
    if (unit === null) compute = null;
    else if (r?.suspended) compute = 0;
    else if (item.billing === 'usage') compute = unit / H;
    else compute = (unit * qty) / H;
    let storage = 0;
    if (item.storage) {
      const gb = r?.diskGb ?? item.storage.gb;
      if (gb === null || item.storage.usdPerGb === null) storageToConfirm = true;
      else storage = (gb * item.storage.usdPerGb) / H;
    }
    return { unit, qty, compute, storage };
  };

  for (let i = 0; i < ctx.elapsed; i++) {
    const r = readings?.get(i);
    if (item.renderKey && !r) missing++;
    if (r) last = r;
    const s = slot(r);
    computeUsd += s.compute ?? 0;
    storageUsd += s.storage;
  }
  const lastSlot = slot(ctx.elapsed > 0 ? readings?.get(ctx.elapsed - 1) : undefined);

  const compute: number | null = unpricedPlans.size > 0 ? null : computeUsd;
  for (const plan of unpricedPlans) warnings.push({ code: 'plan_without_price', resourceKey: item.renderKey!, plan });
  if (storageToConfirm) warnings.push({ code: 'storage_to_confirm', key: item.key });
  if (item.renderKey && missing > 0) warnings.push({ code: 'missing_hours', resourceKey: item.renderKey, count: missing });
  pushDrift(item, last, settings, warnings);

  const remaining = H - ctx.elapsed;
  const projectedUsd =
    compute === null || lastSlot.compute === null ? null : compute + storageUsd + (lastSlot.compute + lastSlot.storage) * remaining;
  const storage = item.storage && !storageToConfirm ? storageUsd : null;
  const totalUsd = compute === null ? null : compute + (storage ?? 0);
  const unitUsd = lastSlot.unit;
  const measured = readings !== undefined && readings.size > 0;
  const quantitySource: InfraQuantitySource = measured ? 'measured_hours' : 'manual';

  return {
    computeUsd: compute,
    storageUsd: storage,
    unitUsd,
    projectedUsd,
    result: {
      key: item.key,
      label: item.label,
      category: item.category,
      billing: item.billing,
      renderKey: item.renderKey,
      planLabel: item.planLabel,
      plan: last?.plan ?? null,
      quantity: lastSlot.qty,
      quantitySource,
      allocation: item.allocation,
      compute: maybeMoney(compute, fx),
      storage: maybeMoney(storage, fx),
      storageToConfirm,
      cost: maybeMoney(totalUsd, fx),
      estimated: !measured || missing > 0,
      neighbors: type && unitUsd !== null ? neighborsOf(settings, type, unitUsd, fx) : null,
    },
  };
}

/** Atraso do tick do job: até 5 min depois da virada a hora `F - 2h` ainda pode não ter sido lida. */
const BANDWIDTH_TICK_GRACE_MS = 5 * 60_000;

/**
 * Horas de banda que já deveriam estar gravadas. O job lê até `floorHour(now) - 2h` inclusive (às 10:05 lê
 * 00..08 = 9 horas = decorridas - 1); nos primeiros 5 min da hora o tick pode não ter rodado (decorridas - 2).
 * Mês passado = todas.
 */
function expectedBandwidthHours(now: Date, hourly: InfraCostHourlyInput, ctx: HoursContext): number {
  const sinceStart = now.getTime() - hourly.monthStart.getTime();
  const raw = Math.floor(sinceStart / HOUR_MS);
  const lag = sinceStart - raw * HOUR_MS < BANDWIDTH_TICK_GRACE_MS ? 2 : 1;
  return Math.min(ctx.hoursInMonth, Math.max(0, raw - lag));
}

/** Excedente do workspace com consumo medido (manual vence); projeção pela média diária do período. */
function workspaceUsageHours(
  included: number,
  manual: number | null,
  measured: number | null,
  usdPerUnit: number,
  ctx: HoursContext,
  fx: ResolvedFxRate | null,
): { view: InfraWorkspaceUsageResult; costUsd: number; projectedUsd: number } {
  const consumed = manual ?? measured;
  const source = manual !== null ? 'manual' : measured !== null ? 'measured' : null;
  const overage = consumed === null ? 0 : Math.max(0, consumed - included);
  const costUsd = overage * usdPerUnit;
  const projectedConsumed =
    source === 'measured' && consumed !== null && ctx.elapsed > 0 ? (consumed / ctx.elapsed) * ctx.hoursInMonth : consumed;
  const projectedUsd = projectedConsumed === null ? 0 : Math.max(0, projectedConsumed - included) * usdPerUnit;
  // Soma de float (6,6 + 0,2 + 0,2 = 6,999…): 4 casas na saída, como o dinheiro
  return {
    view: { included, consumed: consumed === null ? null : round4(consumed), source, overage: round4(overage), cost: money(costUsd, fx) },
    costUsd,
    projectedUsd,
  };
}

/** Parte de um tenant no compartilhado nas duas bases (COST-12). */
export interface InfraTenantShare {
  tenantId: string;
  planSlug: string | null;
  contractedAvg: number;
  connectedHours: number;
  /** Base contratadas: contratadas médias × custo por contratada. */
  contractedShareUsd: number | null;
  /** Sessão-hora: horas conectadas × custo por sessão-hora. */
  sessionHourShareUsd: number | null;
}

/** Rateio por tenant do compartilhado (as duas bases); por plano = soma dos tenants. */
export function allocateInfraTenantShares(sharedUsd: number, tenants: readonly InfraTenantMonthUsage[]) {
  const contractedTotal = tenants.reduce((s, t) => s + t.contractedAvg, 0);
  const sessionHours = tenants.reduce((s, t) => s + t.connectedHours, 0);
  const perContracted = div(sharedUsd, contractedTotal);
  const perSessionHour = div(sharedUsd, sessionHours);
  const shares: InfraTenantShare[] = tenants.map((t) => ({
    tenantId: t.tenantId,
    planSlug: t.planSlug,
    contractedAvg: t.contractedAvg,
    connectedHours: t.connectedHours,
    contractedShareUsd: perContracted === null ? null : t.contractedAvg * perContracted,
    sessionHourShareUsd: perSessionHour === null ? null : t.connectedHours * perSessionHour,
  }));
  return { contractedTotal, sessionHours, perContracted, perSessionHour, shares };
}

/** Custos do mês: foto do momento (P1) ou Σ por hora com `hourly` (P2). */
export function calculateInfraCosts(input: InfraCostCalculationInput): InfraCostCalculation {
  const { settings, fx } = input;
  const warnings: InfraCostWarning[] = [];
  const hourly = input.hourly;
  const ctx = hourly ? hoursContext(input, hourly) : null;
  const calcs = settings.items.map((item) => {
    if (ctx) return calculateItemHours(item, input, ctx, warnings);
    pushDrift(item, item.renderKey ? input.resources?.find((r) => r.renderKey === item.renderKey) : undefined, settings, warnings);
    return calculateItem(item, input, warnings);
  });

  const ws = settings.workspace;
  const bwPrice = ws.bandwidthUsdPerGb;
  const buildPrice = ws.buildUsdPer1000Min / 1000;
  const bandwidth = ctx
    ? workspaceUsageHours(ws.includedBandwidthGb, ws.manualBandwidthGb, hourly!.bandwidthGb, bwPrice, ctx, fx)
    : { ...workspaceUsage(ws.includedBandwidthGb, ws.manualBandwidthGb, bwPrice, fx), projectedUsd: 0 };
  const build = ctx
    ? workspaceUsageHours(ws.includedBuildMinutes, ws.manualBuildMinutes, hourly!.buildMinutes, buildPrice, ctx, fx)
    : { ...workspaceUsage(ws.includedBuildMinutes, ws.manualBuildMinutes, buildPrice, fx), projectedUsd: 0 };
  const workspaceUsd = bandwidth.costUsd + build.costUsd;

  let totalUsd = workspaceUsd;
  let fixedUsd = 0;
  let variableUsd = workspaceUsd;
  let sharedUsd = workspaceUsd;
  let projectedUsd = bandwidth.projectedUsd + build.projectedUsd;
  /** Compartilhado projetado (mesma regra do `shared`): base do rateio projetado. */
  let projectedSharedUsd = projectedUsd;
  for (const { result, computeUsd, storageUsd, projectedUsd: itemProjected } of calcs) {
    if (computeUsd === null) continue;
    const itemUsd = computeUsd + (storageUsd ?? 0);
    totalUsd += itemUsd;
    projectedUsd += itemProjected ?? 0;
    fixedUsd += storageUsd ?? 0;
    if (result.billing === 'fixed') fixedUsd += computeUsd;
    else variableUsd += computeUsd;
    if (result.allocation === 'shared' && result.category !== 'ai') {
      sharedUsd += itemUsd;
      projectedSharedUsd += itemProjected ?? 0;
    }
  }

  // Rateio: foto pela capacidade de agora (COST-05); horas pelo mês de `tenant_session_hours` (COST-12).
  const rows = input.capacityByPlan;
  const unlimited = rows.reduce((s, r) => s + sumChannels(r.unlimitedTenants), 0);
  if (unlimited > 0) warnings.push({ code: 'unlimited_contracted', count: unlimited });
  if (ctx && hourly?.bandwidthHours !== undefined && ws.manualBandwidthGb === null) {
    const missing = expectedBandwidthHours(input.now, hourly, ctx) - hourly.bandwidthHours;
    if (missing > 0) warnings.push({ code: 'bandwidth_missing_hours', count: missing });
  }

  let contractedTotal: number;
  let connectedTotal: number;
  let perContracted: number | null;
  /** Custo de uma sessão conectada no mês (foto: ÷ conectadas; horas: sessão-hora × 730). */
  let perConnected: number | null;
  let plans: InfraCostPlanResult[];
  let hoursView: { sessionHours: number; perSessionHour: InfraMoney | null } | null = null;
  let idleUsd: number | null = null;

  if (ctx && hourly) {
    const alloc = allocateInfraTenantShares(sharedUsd, hourly.tenants);
    contractedTotal = alloc.contractedTotal;
    perContracted = alloc.perContracted;
    perConnected = alloc.perSessionHour === null ? null : alloc.perSessionHour * INFRA_SESSION_MONTH_HOURS;
    const avgConnected = (hours: number) => (ctx.elapsed > 0 ? hours / ctx.elapsed : 0);
    connectedTotal = avgConnected(alloc.sessionHours);
    hoursView = { sessionHours: alloc.sessionHours, perSessionHour: maybeMoney(alloc.perSessionHour, fx) };
    const projectedPerContracted = div(projectedSharedUsd, alloc.contractedTotal);

    const byPlan = new Map<string | null, InfraTenantShare[]>();
    for (const t of alloc.shares) byPlan.set(t.planSlug, [...(byPlan.get(t.planSlug) ?? []), t]);
    const order = (slug: string | null) => (slug === null ? Infinity : (PLAN_SLUGS as readonly string[]).indexOf(slug) >>> 0);
    plans = [...byPlan.entries()]
      .sort(([a], [b]) => order(a) - order(b) || String(a).localeCompare(String(b)))
      .map(([planSlug, list]) => {
        const sum = (f: (t: InfraTenantShare) => number | null) =>
          list.some((t) => f(t) === null) ? null : list.reduce((s, t) => s + (f(t) ?? 0), 0);
        const share = sum((t) => t.contractedShareUsd);
        const connectedShare = sum((t) => t.sessionHourShareUsd);
        const projectedShare = sum((t) => (projectedPerContracted === null ? null : t.contractedAvg * projectedPerContracted));
        return {
          planSlug,
          tenants: list.length,
          contractedSessions: round4(list.reduce((s, t) => s + t.contractedAvg, 0)),
          connectedSessions: round4(avgConnected(list.reduce((s, t) => s + t.connectedHours, 0))),
          share: maybeMoney(share, fx),
          costPerTenant: maybeMoney(share === null ? null : div(share, list.length), fx),
          connectedShare: maybeMoney(connectedShare, fx),
          connectedCostPerTenant: maybeMoney(connectedShare === null ? null : div(connectedShare, list.length), fx),
          projectedShare: maybeMoney(projectedShare, fx),
          projectedCostPerTenant: maybeMoney(projectedShare === null ? null : div(projectedShare, list.length), fx),
        };
      });

    // Ociosidade (estimativa): só nas horas com leitura do worker. Numerador e denominador na mesma janela:
    // a sessão-hora do mês (só tenants ACTIVE, gravada por dia) entra proporcional às horas lidas, e o
    // compartilhado também. Horas sem leitura ficam fora → `idle_partial`.
    const workerHours = ctx.byKey.get('worker');
    const readHours = workerHours?.size ?? 0;
    const capacityHours = workerHours
      ? [...workerHours.values()].reduce((s, r) => s + (r.instances ?? 0) * input.scaling.maxSessionsPerWorker, 0)
      : 0;
    if (capacityHours > 0 && ctx.elapsed > 0) {
      const window = readHours / ctx.elapsed;
      idleUsd = sharedUsd * window * (1 - Math.min(1, (alloc.sessionHours * window) / capacityHours));
      if (readHours < ctx.elapsed) warnings.push({ code: 'idle_partial', count: ctx.elapsed - readHours });
    }
  } else {
    contractedTotal = rows.reduce((s, r) => s + effectiveContractedSessions(r), 0);
    connectedTotal = rows.reduce((s, r) => s + sumChannels(r.connected), 0);
    perContracted = div(sharedUsd, contractedTotal);
    const perNow = div(sharedUsd, connectedTotal);
    perConnected = perNow;
    plans = rows.map((row) => {
      const contractedSessions = effectiveContractedSessions(row);
      const connectedSessions = sumChannels(row.connected);
      const contracted = planShare(contractedSessions, perContracted, row.tenants, fx);
      const connected = planShare(connectedSessions, perNow, row.tenants, fx);
      return {
        planSlug: row.planSlug,
        tenants: row.tenants,
        contractedSessions,
        connectedSessions,
        share: contracted.share,
        costPerTenant: contracted.perTenant,
        connectedShare: connected.share,
        connectedCostPerTenant: connected.perTenant,
        projectedShare: null,
        projectedCostPerTenant: null,
      };
    });
  }

  // Σ conectadas vem do lease agora; o cluster, da amostra: só compara com amostra recente.
  const connectedNow = rows.reduce((s, r) => s + sumChannels(r.connected), 0);
  const sampledAt = input.live.sessionsSampledAt;
  const sampleStale = sampledAt !== null && input.now.getTime() - sampledAt.getTime() > OCCUPANCY_SAMPLE_MAX_AGE_MS;
  if (sampleStale) warnings.push({ code: 'sessions_sample_stale' });
  const clusterConnected = sampleStale || sampledAt === null ? null : input.live.sessionsConnected;
  const unallocatedSessions = clusterConnected === null ? null : Math.max(0, clusterConnected - connectedNow);
  const unallocatedUsd = unallocatedSessions === null || perConnected === null ? null : unallocatedSessions * perConnected;

  const worker = calcs.find((c) => c.result.renderKey === 'worker');
  const marginalUsd =
    worker?.unitUsd != null ? div(worker.unitUsd, input.scaling.maxSessionsPerWorker * input.scaling.alertOccupancyRatio) : null;

  if (!fx) warnings.push({ code: 'fx_missing' });

  return {
    basis: ctx ? 'hours' : 'snapshot',
    fx,
    sessionsSampledAt: input.live.sessionsSampledAt,
    totalIsPartial: calcs.some((c) => c.computeUsd === null),
    totals: {
      total: money(totalUsd, fx),
      fixed: money(fixedUsd, fx),
      variable: money(variableUsd, fx),
      shared: money(sharedUsd, fx),
      projected: ctx ? money(projectedUsd, fx) : null,
    },
    items: calcs.map((c) => c.result),
    workspace: { planLabel: ws.planLabel, bandwidth: bandwidth.view, build: build.view, total: money(workspaceUsd, fx) },
    perSession: {
      contracted: { sessions: round4(contractedTotal), perSession: maybeMoney(perContracted, fx), unlimitedTenants: unlimited },
      connected: {
        sessions: round4(connectedTotal),
        perSession: maybeMoney(perConnected, fx),
        unallocatedSessions,
        unallocatedCost: maybeMoney(unallocatedUsd, fx),
        ...(hoursView ?? {}),
      },
    },
    marginalPerSession: maybeMoney(marginalUsd, fx),
    idleCapacity: maybeMoney(idleUsd, fx),
    plans,
    warnings,
  };
}
