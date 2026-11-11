import type { IWorkerCapacityReader, WorkerCapacityPlanRow } from '../../domain/contracts/IWorkerCapacityReader';
import type { WorkerScalingSettings } from '../../domain/services/workerScalingSettings';
import {
  OCCUPANCY_SAMPLE_MAX_AGE_MS,
  mbPerSession,
  requiredReplicas,
  suggestedMaxSessions,
} from '../../domain/services/capacityPlan';
import type { IOpsMetricsSampleRepository } from '../../../metrics/domain/contracts/IOpsMetricsSampleRepository';
import { OPS_METRIC, type OpsMetricSample } from '../../../metrics/domain/OpsMetric';
import type { LimitChannel } from '../../../tenants/domain/channelLimits';

/** Janela da conta de MB por sessão e da "última amostra" `sessions_*` (WSCALE-09). */
export const CAPACITY_WINDOW_MS = 60 * 60 * 1000;

export interface WorkerCapacityChannelView {
  contracted: number;
  unlimitedTenants: number;
  created: number;
  connected: number;
}

export interface WorkerCapacityPlanView {
  planSlug: string | null;
  tenants: number;
  whatsapp: WorkerCapacityChannelView;
  telegram: WorkerCapacityChannelView;
}

export interface WorkerCapacityClusterView {
  /** Última amostra `sessions_capacity` da janela; 0 sem amostra. */
  capacity: number;
  /** Última amostra `sessions_connected` (contagem do banco: lease vivo + `CONNECTED`); 0 sem amostra. */
  connected: number;
  /** `connected ÷ capacity × 100` (1 casa); 0 com capacidade 0. */
  occupancyPct: number;
  /** `max(0, capacity − connected)`. */
  headroom: number;
  requiredReplicas: number;
  /** Média de memória (MB, instâncias somadas por `at`) ÷ média de conectadas na janela; `null` sem dado. */
  mbPerSession: number | null;
  /** `floor(0,7 × memoryLimitMb ÷ mbPerSession)`; `null` sem dado. */
  suggestedMaxSessions: number | null;
  /** Limite de RAM por instância, derivado de `memory ÷ (memory_pct ÷ 100)` na amostra mais recente. */
  memoryLimitMb: number | null;
  /** ISO da última amostra `sessions_connected`; `null` sem amostra na janela. */
  sampledAt: string | null;
  /**
   * `sampledAt` mais velho que `OCCUPANCY_SAMPLE_MAX_AGE_MS` (10 min): números mantidos, mas não são
   * atuais (coletor parado). `false` sem amostra (`sampledAt: null` já diz isso).
   */
  stale: boolean;
}

/** Resposta de `GET /admin/workers/capacity` (consumida pela aba Capacidade, T18). */
export interface WorkerCapacityView {
  plans: WorkerCapacityPlanView[];
  cluster: WorkerCapacityClusterView;
  settings: Pick<WorkerScalingSettings, 'maxSessionsPerWorker' | 'alertOccupancyRatio'>;
  /** Adoção em vigor no cluster (mesmo `enforced` de `/settings`). */
  enforced: boolean;
}

export interface GetWorkerCapacityDeps {
  reader: IWorkerCapacityReader;
  samples: Pick<IOpsMetricsSampleRepository, 'listSince'>;
  /** Configuração efetiva + `enforced` (o `GetWorkerScalingSettingsUseCase`). */
  settings: () => Promise<{ settings: WorkerScalingSettings; enforced: boolean }>;
  /**
   * IDs `srv-` monitorados (`RENDER_RESOURCE_IDS`). Mais de um: não há como saber qual roda sessões
   * → memória `null` (o filtro por `WORKER_SCALER_SERVICE_ID` é da T23).
   */
  renderServiceIds: readonly string[];
  now?: () => Date;
}

const UNIT_TO_MB: Record<string, number> = {
  b: 1 / (1024 * 1024),
  byte: 1 / (1024 * 1024),
  bytes: 1 / (1024 * 1024),
  kb: 1 / 1024,
  kib: 1 / 1024,
  mb: 1,
  mib: 1,
  gb: 1024,
  gib: 1024,
};

/** Converte `memory` para MB por `meta.unit` (base 1024; a Render grava `bytes`). Sem maiúscula/espaço; ausente ou desconhecida → `null`. */
export function memoryToMb(value: number, unit: unknown): number | null {
  if (typeof unit !== 'string' || !Number.isFinite(value)) return null;
  const factor = UNIT_TO_MB[unit.trim().toLowerCase()];
  return factor === undefined ? null : value * factor;
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const avg = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const latest = (xs: readonly OpsMetricSample[]) =>
  xs.reduce<OpsMetricSample | null>((m, s) => (!m || s.at > m.at ? s : m), null);

function channel(row: WorkerCapacityPlanRow, c: LimitChannel): WorkerCapacityChannelView {
  return { contracted: row.contracted[c], unlimitedTenants: row.unlimitedTenants[c], created: row.created[c], connected: row.connected[c] };
}

interface MemoryStats {
  avgMemoryMb: number | null;
  memoryLimitMb: number | null;
}

/** Só recursos `srv-` da fonte `render`; soma instâncias por `at`; limite da amostra mais recente. */
function memoryStats(memory: readonly OpsMetricSample[], memoryPct: readonly OpsMetricSample[]): MemoryStats {
  const isSrv = (s: OpsMetricSample) => s.source === 'render' && s.resource.startsWith('srv-');
  const pctByKey = new Map(memoryPct.filter(isSrv).map((s) => [`${s.at.getTime()}|${s.resource}`, s.value]));
  const sumByAt = new Map<number, number>();
  const limitsByAt = new Map<number, number[]>();
  for (const s of memory.filter(isSrv)) {
    const mb = memoryToMb(s.value, s.meta?.unit);
    if (mb === null) continue;
    const at = s.at.getTime();
    sumByAt.set(at, (sumByAt.get(at) ?? 0) + mb);
    const pct = pctByKey.get(`${at}|${s.resource}`);
    if (pct !== undefined && pct > 0) limitsByAt.set(at, [...(limitsByAt.get(at) ?? []), mb / (pct / 100)]);
  }
  const lastLimitAt = Math.max(-Infinity, ...limitsByAt.keys());
  const limits = limitsByAt.get(lastLimitAt);
  return {
    avgMemoryMb: avg([...sumByAt.values()]),
    // Instâncias do mesmo serviço têm o mesmo plano; o maior protege de amostra parcial.
    memoryLimitMb: limits ? Math.max(...limits) : null,
  };
}

/**
 * Capacidade contratada × instalada (WSCALE-09). Só tabelas locais (`tenants`/`sessions` agregados e
 * `ops_metrics_samples`): nunca chama a Render nem devolve dado de tenant individual.
 */
export class GetWorkerCapacityUseCase {
  constructor(private readonly deps: GetWorkerCapacityDeps) {}

  async execute(): Promise<WorkerCapacityView> {
    const { reader, samples } = this.deps;
    const nowMs = (this.deps.now?.() ?? new Date()).getTime();
    const since = new Date(nowMs - CAPACITY_WINDOW_MS);
    const memoryKnown = this.deps.renderServiceIds.filter((id) => id.startsWith('srv-')).length <= 1;
    const none = Promise.resolve<OpsMetricSample[]>([]);
    const [rows, view, connectedSamples, capacitySamples, memory, memoryPct] = await Promise.all([
      reader.readByPlan(),
      this.deps.settings(),
      samples.listSince(OPS_METRIC.sessionsConnected, since),
      samples.listSince(OPS_METRIC.sessionsCapacity, since),
      memoryKnown ? samples.listSince(OPS_METRIC.memory, since) : none,
      memoryKnown ? samples.listSince(OPS_METRIC.memoryPct, since) : none,
    ]);

    const fromSessions = (xs: OpsMetricSample[]) => xs.filter((s) => s.source === 'sessions');
    const connectedRows = fromSessions(connectedSamples);
    const lastConnected = latest(connectedRows);
    const connected = Math.round(lastConnected?.value ?? 0);
    const capacity = Math.round(latest(fromSessions(capacitySamples))?.value ?? 0);
    const { maxSessionsPerWorker, alertOccupancyRatio } = view.settings;

    const mem = memoryStats(memory, memoryPct);
    const perSession = mbPerSession(mem.avgMemoryMb, avg(connectedRows.map((s) => s.value)));
    const suggested = suggestedMaxSessions(mem.memoryLimitMb, perSession);

    return {
      plans: rows.map((r) => ({ planSlug: r.planSlug, tenants: r.tenants, whatsapp: channel(r, 'whatsapp'), telegram: channel(r, 'telegram') })),
      cluster: {
        capacity,
        connected,
        occupancyPct: capacity > 0 ? round((connected / capacity) * 100, 1) : 0,
        headroom: Math.max(0, capacity - connected),
        requiredReplicas: requiredReplicas(connected, maxSessionsPerWorker, alertOccupancyRatio),
        mbPerSession: perSession === null ? null : round(perSession, 2),
        suggestedMaxSessions: suggested,
        memoryLimitMb: mem.memoryLimitMb === null ? null : round(mem.memoryLimitMb, 0),
        sampledAt: lastConnected ? lastConnected.at.toISOString() : null,
        stale: lastConnected ? nowMs - lastConnected.at.getTime() > OCCUPANCY_SAMPLE_MAX_AGE_MS : false,
      },
      settings: { maxSessionsPerWorker, alertOccupancyRatio },
      enforced: view.enforced,
    };
  }
}
