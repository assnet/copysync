import type { Prisma, PrismaClient, WorkerScaleEvent as Row } from '@prisma/client';
import {
  WORKER_SCALE_TEXT_MAX,
  truncateText,
  type IWorkerScaleEventRepository,
  SCALE_COOLDOWN_OUTCOMES,
  UNCERTAIN_SCALE_FAILURE_ERRORS,
  type NewWorkerScaleEvent,
  type RecordRequestedResult,
  type WorkerScaleEvent,
  type WorkerScaleEventPage,
  type WorkerScaleOutcome,
  type WorkerScaleTrigger,
} from '../../domain/contracts/IWorkerScaleEventRepository';

/** Linhas por DELETE da retenção (mesmo lote de `ops_metrics_samples`). */
export const WORKER_SCALE_RETENTION_BATCH_SIZE = 5_000;
/** Teto de lotes por chamada; o resto sai na limpeza seguinte. */
export const WORKER_SCALE_RETENTION_MAX_BATCHES = 10;
const STATEMENT_TIMEOUT = '2s';
/** Chave fixa do advisory lock que serializa pedidos de escala (recurso único: o serviço worker). */
const SCALE_REQUEST_LOCK_KEY = 'worker-scale-request';
/** Mesmo critério de `countsForScaleCooldown`: `requested|succeeded` ou `failed` incerto. */
const COOLDOWN_WHERE: Prisma.WorkerScaleEventWhereInput = {
  OR: [
    { outcome: { in: [...SCALE_COOLDOWN_OUTCOMES] } },
    { outcome: 'failed', error: { in: [...UNCERTAIN_SCALE_FAILURE_ERRORS] } },
  ],
};

/** Corte por code point (`varchar(200)` conta caracteres, não unidades UTF-16). */
const cut = (s: string) => truncateText(s, WORKER_SCALE_TEXT_MAX);
const cutOrNull = (s: string | null | undefined) => (s == null ? null : cut(s));

const toEvent = (r: Row): WorkerScaleEvent => ({
  id: Number(r.id),
  at: r.at,
  trigger: r.trigger as WorkerScaleTrigger,
  actorUserId: r.actorUserId,
  fromReplicas: r.fromReplicas,
  toReplicas: r.toReplicas,
  reason: r.reason,
  outcome: r.outcome as WorkerScaleOutcome,
  error: r.error,
  requestId: r.requestId,
});

const toData = (e: NewWorkerScaleEvent) => ({
  trigger: e.trigger,
  actorUserId: e.actorUserId,
  fromReplicas: e.fromReplicas,
  toReplicas: e.toReplicas,
  reason: cut(e.reason),
  outcome: e.outcome,
  error: cutOrNull(e.error),
  requestId: e.requestId ?? null,
});

/** `worker_scale_events` (WSCALE-13). `at` gravado em UTC pelo Prisma; sem tenant. */
export class PrismaWorkerScaleEventRepository implements IWorkerScaleEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(e: NewWorkerScaleEvent): Promise<number> {
    const row = await this.prisma.workerScaleEvent.create({
      data: toData(e),
      select: { id: true },
    });
    return Number(row.id);
  }

  /** Transação curta: o lock solta no commit/rollback. */
  async recordRequestedIfIdle({
    evt,
    cooldownSeconds,
    now,
  }: {
    evt: Omit<NewWorkerScaleEvent, 'outcome' | 'error'>;
    cooldownSeconds: number;
    now: Date;
  }): Promise<RecordRequestedResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${SCALE_REQUEST_LOCK_KEY}::text, 0::bigint))`;
      // Replay concorrente: o mesmo `requestId` já gravado sob o lock vence o bloqueio do intervalo.
      if (evt.requestId) {
        const existing = await tx.workerScaleEvent.findUnique({ where: { requestId: evt.requestId } });
        if (existing) return { existing: toEvent(existing) };
      }
      const last = await tx.workerScaleEvent.findFirst({
        where: COOLDOWN_WHERE,
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        select: { at: true },
      });
      if (last) {
        const retryAt = new Date(last.at.getTime() + cooldownSeconds * 1000);
        if (retryAt.getTime() > now.getTime()) return { blocked: retryAt };
      }
      const row = await tx.workerScaleEvent.create({
        data: toData({ ...evt, outcome: 'requested', error: null }),
        select: { id: true },
      });
      return { id: Number(row.id) };
    });
  }

  async updateOutcome(id: number, outcome: WorkerScaleOutcome, error?: string | null): Promise<void> {
    await this.prisma.workerScaleEvent.update({
      where: { id: BigInt(id) },
      data: { outcome, error: cutOrNull(error) },
    });
  }

  async lastSucceededAt(): Promise<Date | null> {
    const row = await this.prisma.workerScaleEvent.findFirst({
      where: COOLDOWN_WHERE,
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      select: { at: true },
    });
    return row?.at ?? null;
  }

  async findByRequestId(requestId: string): Promise<WorkerScaleEvent | null> {
    const row = await this.prisma.workerScaleEvent.findUnique({ where: { requestId } });
    return row ? toEvent(row) : null;
  }

  /** Keyset por `id desc` (crescente com `at`): página estável mesmo com inserções novas no topo. */
  async list({ beforeId, limit }: { beforeId?: number | null; limit: number }): Promise<WorkerScaleEventPage> {
    const rows = await this.prisma.workerScaleEvent.findMany({
      where: beforeId != null ? { id: { lt: BigInt(beforeId) } } : {},
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const items = rows.slice(0, limit).map(toEvent);
    return { items, nextBeforeId: rows.length > limit ? items[items.length - 1]!.id : null };
  }

  /**
   * Lotes de `ctid` com `SET LOCAL statement_timeout` (só vale na transação), como
   * `PrismaOpsMetricsSampleRepository.deleteOlderThan`. Lote que estoura lança; os anteriores ficam.
   */
  async deleteOlderThan(cutoff: Date, batchSize = WORKER_SCALE_RETENTION_BATCH_SIZE): Promise<number> {
    let total = 0;
    for (let i = 0; i < WORKER_SCALE_RETENTION_MAX_BATCHES; i++) {
      const [, deleted] = await this.prisma.$transaction([
        this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`),
        this.prisma.$executeRaw`
          DELETE FROM "worker_scale_events" WHERE ctid IN (
            SELECT ctid FROM "worker_scale_events" WHERE "at" < (${cutoff.toISOString()}::timestamptz AT TIME ZONE 'UTC') LIMIT ${batchSize}
          )`,
      ]);
      total += deleted;
      if (deleted < batchSize) break;
    }
    return total;
  }
}
