import { randomUUID } from 'node:crypto';
import type { IJobLease } from '../../../../shared/jobs/IJobLease';
import { AppError } from '../../../../shared/errors/AppError';
import {
  ScaleRequestIdReusedError,
  ScalerNotConfiguredError,
  ScalerRateLimitedError,
  ScalerUnavailableError,
} from '../../../../shared/errors/internal/WorkerScalingErrors';
import { logger } from '../../../../shared/logger/logger';
import type { IOpsMetricsSampleRepository } from '../../../metrics/domain/contracts/IOpsMetricsSampleRepository';
import { OPS_METRIC, type OpsMetricSample } from '../../../metrics/domain/OpsMetric';
import { SESSIONS_CLUSTER_RESOURCE } from '../../../metrics/domain/services/opsAlertPolicy';
import type { ScaleWorkersInput, ScaleWorkersUseCase } from '../../application/use-cases/ScaleWorkersUseCase';
import type { ISessionAdoptionRepository } from '../../domain/contracts/ISessionAdoptionRepository';
import type { IWorkerScaleEventRepository } from '../../domain/contracts/IWorkerScaleEventRepository';
import type { IWorkerScaler } from '../../domain/contracts/IWorkerScaler';
import type { IWorkerScalingSettingsProvider } from '../../domain/contracts/IWorkerScalingSettingsProvider';
import {
  OCCUPANCY_SAMPLE_MAX_AGE_MS,
  OCCUPANCY_SAMPLE_SECONDS,
  shouldScaleUp,
  type OccupancySample,
  type ScaleUpReason,
} from '../../domain/services/capacityPlan';

export const AUTOSCALER_LEASE = 'worker-autoscaler';
export const AUTOSCALER_REJECTED_LEASE_PREFIX = 'worker-autoscaler:rejected:';
export const AUTOSCALER_CLEANUP_LEASE = 'worker-autoscaler:cleanup';
export const AUTOSCALER_TICK_MS = 60_000;
/** Retenção de `worker_scale_events` (design §6). */
export const SCALE_EVENT_RETENTION_MS = 180 * 24 * 60 * 60_000;
/** Lease da limpeza: não é solto, vence sozinho (no máximo 1 limpeza por dia no cluster). */
const CLEANUP_LEASE_MS = 24 * 60 * 60_000;
/** Recusa do mesmo motivo: no máximo 1 evento por hora no cluster (lease não solto). */
export const REJECTION_SILENCE_MS = 60 * 60_000;
/**
 * Janela do `requestId` do automático: dois donos do lease no mesmo balde de 5 min geram o mesmo id
 * e o segundo vira "já feito" (sem chamada dupla ao escalador nem evento novo). O replay do use case
 * é estrito (alvo + motivo + ator): o motivo é fixo por gatilho (`auto: occupancy|awaiting`, sem
 * número) e o id já gravado é checado antes do alvo, que muda depois que o 1º pedido sobe a réplica.
 */
export const AUTO_REQUEST_BUCKET_MS = OCCUPANCY_SAMPLE_SECONDS * 1000;
/** Código gravado em `error` quando não há amostra `sessions_*` recente. */
export const NO_SAMPLES_ERROR = 'NO_OCCUPANCY_SAMPLES';
const AWAITING_STATEMENT_TIMEOUT_MS = 2_000;

/**
 * Pareia `sessions_connected` e `sessions_capacity` (fonte `sessions`, recurso `cluster`) pelo `at`:
 * o sampler grava as duas no mesmo instante. Conectadas = média dos 5 ticks (`meta.agg: 'avg'`),
 * capacidade = último tick (`'last'`); amostras antigas sem `agg` entram como estão (a capacidade
 * era média, diferença só no balde em que o teto mudou). `at` sem par é descartado.
 */
export function pairOccupancySamples(
  connected: readonly OpsMetricSample[],
  capacity: readonly OpsMetricSample[],
): OccupancySample[] {
  const isCluster = (s: OpsMetricSample) => s.source === 'sessions' && s.resource === SESSIONS_CLUSTER_RESOURCE;
  const capByAt = new Map<number, number>();
  for (const s of capacity) if (isCluster(s)) capByAt.set(s.at.getTime(), s.value);
  const out: OccupancySample[] = [];
  for (const s of connected) {
    if (!isCluster(s)) continue;
    const cap = capByAt.get(s.at.getTime());
    if (cap !== undefined) out.push({ at: s.at, connected: s.value, capacity: cap });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export interface WorkerAutoscalerJobOptions {
  lease: IJobLease;
  settings: Pick<IWorkerScalingSettingsProvider, 'current'>;
  samples: Pick<IOpsMetricsSampleRepository, 'listSince'>;
  adoption: Pick<ISessionAdoptionRepository, 'countAwaitingCapacity'>;
  /** Só `getState` (réplicas atuais para o alvo atual + 1); `scaleTo` fica no use case. */
  scaler: Pick<IWorkerScaler, 'getState'>;
  scale: Pick<ScaleWorkersUseCase, 'checkPreconditions' | 'execute'>;
  events: Pick<IWorkerScaleEventRepository, 'record' | 'deleteOlderThan' | 'findByRequestId'>;
  intervalMs?: number;
  now?: () => Date;
}

/**
 * Subida automática de workers (WSCALE-15/16). Tick de 60 s (`unref`) sob o lease `worker-autoscaler`
 * com TTL menor que o tick (não solto). Só com `scalerMode = auto`; fora disso não consulta amostra,
 * escalador nem grava evento. Sem estado em memória: o "sustentado" sai das amostras do banco e o
 * aguardando é contado ao vivo, então reinício ou troca de dono não zera nem duplica. Nunca reduz.
 */
export class WorkerAutoscalerJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly ownerId = randomUUID();
  private readonly log = logger.child({ module: 'WorkerAutoscalerJob' });

  constructor(private readonly options: WorkerAutoscalerJobOptions) {}

  private get intervalMs(): number {
    return this.options.intervalMs ?? AUTOSCALER_TICK_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runTick(), this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  /** Exposto para teste; nunca lança. */
  runTick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.tickOnce()
      .catch((err) => this.log.warn({ err: (err as Error)?.name }, 'worker autoscaler tick failed'))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async tickOnce(): Promise<void> {
    const now = this.options.now?.() ?? new Date();
    await this.cleanup(now);

    const settings = this.options.settings.current().value;
    if (settings.scalerMode !== 'auto') return;

    const { lease, samples, adoption } = this.options;
    const leaseUntil = new Date(now.getTime() + this.intervalMs - 1_000);
    if (!(await lease.tryAcquire(AUTOSCALER_LEASE, this.ownerId, leaseUntil, now))) return;

    const lookbackMs =
      Math.max(settings.scaleUpSustainSeconds * 1000, OCCUPANCY_SAMPLE_MAX_AGE_MS) + OCCUPANCY_SAMPLE_SECONDS * 1000;
    const since = new Date(now.getTime() - lookbackMs);
    const [connected, capacity, awaiting] = await Promise.all([
      samples.listSince(OPS_METRIC.sessionsConnected, since),
      samples.listSince(OPS_METRIC.sessionsCapacity, since),
      adoption.countAwaitingCapacity(settings.awaitingAlertSeconds * 1000, {
        statementTimeoutMs: AWAITING_STATEMENT_TIMEOUT_MS,
      }),
    ]);
    const occupancy = pairOccupancySamples(connected, capacity);
    const decision = shouldScaleUp({ occupancySamples: occupancy, awaitingOlderThanThreshold: awaiting, settings, now });

    if (decision.scaleUp === null) {
      await this.rejectOnce(now, 'no_samples', NO_SAMPLES_ERROR, 0, 0);
      return;
    }
    if (!decision.scaleUp) return;
    await this.scaleUp(now, decision.reason ?? 'occupancy', occupancy[0]?.connected ?? 0);
  }

  private async scaleUp(now: Date, reason: ScaleUpReason, connected: number): Promise<void> {
    const { scaler, scale } = this.options;
    const state = await scaler.getState();
    if (state.status !== 'ready') {
      const error =
        state.status === 'not_configured'
          ? new ScalerNotConfiguredError(state.missing)
          : state.reason === 'rate_limited'
            ? new ScalerRateLimitedError(state.retryAfterSeconds ?? null, now)
            : new ScalerUnavailableError(state.reason, 'read');
      await this.rejectOnce(now, reason, error.code, 0, 0);
      return;
    }

    const from = state.desiredReplicas;
    const requestId = `auto:${Math.floor(now.getTime() / AUTO_REQUEST_BUCKET_MS)}`;
    // Outro dono do lease já pediu neste balde (o alvo dele era o `from` de agora): já feito.
    if (await this.options.events.findByRequestId(requestId)) {
      this.log.info({ requestId }, 'worker autoscaler already requested in this window');
      return;
    }
    const input: ScaleWorkersInput = {
      replicas: from + 1,
      trigger: 'auto',
      actorUserId: null,
      reason: `auto: ${reason}`,
      requestId,
      connected: Math.round(connected),
    };
    try {
      await scale.checkPreconditions(input);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      await this.rejectOnce(now, reason, err.code, from, input.replicas);
      return;
    }
    try {
      const { event, replayed } = await scale.execute(input);
      this.log.info({ from, to: input.replicas, reason, outcome: event.outcome, replayed }, 'worker autoscaler scale up');
    } catch (err) {
      // Corrida com outro dono no mesmo balde (gravou o id entre a checagem e o lock): já feito.
      if (err instanceof ScaleRequestIdReusedError) {
        this.log.info({ requestId }, 'worker autoscaler already requested in this window');
        return;
      }
      // `execute` já gravou `rejected`/`failed` (corrida entre a checagem e o pedido ou erro do provedor).
      // `failed` incerto (timeout/5xx do POST) conta no intervalo pelo repositório: o próximo tick
      // cai em `SCALE_COOLDOWN_ACTIVE` em vez de pedir de novo.
      this.log.warn({ err: (err as AppError)?.code ?? (err as Error)?.name, from, to: input.replicas }, 'worker autoscaler scale up failed');
    }
  }

  /** 1 evento `rejected` por código a cada hora no cluster (lease `worker-autoscaler:rejected:<código>`). */
  private async rejectOnce(now: Date, reason: ScaleUpReason, code: string, from: number, to: number): Promise<void> {
    const until = new Date(now.getTime() + REJECTION_SILENCE_MS);
    if (!(await this.options.lease.tryAcquire(`${AUTOSCALER_REJECTED_LEASE_PREFIX}${code}`, this.ownerId, until, now))) return;
    await this.options.events.record({
      trigger: 'auto',
      actorUserId: null,
      fromReplicas: from,
      toReplicas: to,
      reason: `auto: ${reason}`,
      outcome: 'rejected',
      error: code,
      requestId: null,
    });
    this.log.info({ code, reason }, 'worker autoscaler rejected');
  }

  /** Retenção de 180 dias, no máximo 1×/24 h no cluster, em qualquer modo. Falha só loga. */
  private async cleanup(now: Date): Promise<void> {
    try {
      const until = new Date(now.getTime() + CLEANUP_LEASE_MS);
      if (!(await this.options.lease.tryAcquire(AUTOSCALER_CLEANUP_LEASE, this.ownerId, until, now))) return;
      const deleted = await this.options.events.deleteOlderThan(new Date(now.getTime() - SCALE_EVENT_RETENTION_MS));
      if (deleted > 0) this.log.info({ deleted }, 'worker scale events cleanup');
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'worker scale events cleanup failed');
    }
  }
}
