import { randomUUID } from 'node:crypto';
import type { IJobLease } from '../../../../shared/jobs/IJobLease';
import { logger } from '../../../../shared/logger/logger';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaJobLease } from '../../../../shared/infrastructure/jobs/PrismaJobLease';
import { hunterContainer } from '../hunterContainer';
import type { IOfferHuntRepository, OfferHuntClaim } from '../../domain/contracts/hunter/IOfferHuntRepository';
import type { OfferHuntDefinition } from '../../domain/hunter/OfferHunt';
import { nextHuntRunAt, nextHuntRunNextDay, type HuntSchedule } from '../../domain/services/hunter/huntSchedule';
import { isWithinPostingWindow, resolveStartWithinPostingWindow } from '../../domain/services/postingWindow';
import type { RunOfferHuntInput, RunOfferHuntOutput } from '../../application/use-cases/hunter/RunOfferHuntUseCase';

/** Lease global do tique: 1 processo por vez no cluster (o claim por CAS já evita dobra por caçada). */
export const OFFER_HUNT_SCHEDULER_LEASE = 'offer-hunter-scheduler';
export const OFFER_HUNT_SCHEDULER_TICK_MS = 60_000;
/** Vencimento do lease do tique; solto no fim de cada tique (o `PrismaJobLease` só pega lease vencido). */
export const OFFER_HUNT_SCHEDULER_LEASE_TTL_MS = 10 * 60_000;
/** Posse da caçada (`claimedUntil`); > duração de uma execução. Processo morto: a caçada volta depois disso. */
export const OFFER_HUNT_CLAIM_TTL_MS = 15 * 60_000;
/** No máximo 3 caçadas por tique, 1 por tenant (garantido pelo `claimDue`). */
export const OFFER_HUNT_SCHEDULER_PER_TICK = 3;
/** Atraso sorteado entre tenants do mesmo tique (ms). */
export const OFFER_HUNT_TENANT_DELAY_MS = { min: 1_000, max: 5_000 } as const;
/** Teto do dia zerado (ou guarda de execuções): a próxima vai para o dia seguinte. */
const NEXT_DAY_CODES: ReadonlySet<string> = new Set(['OFFER_HUNT_DAILY_LIMIT', 'OFFER_HUNT_RUN_THROTTLED']);
/** Agenda inválida (não deveria existir: validada na criação): tenta de novo em 1 h. */
const FALLBACK_NEXT_MS = 3_600_000;
const DEFAULT_STOP_TIMEOUT_MS = 20_000;

type HuntsPort = Pick<IOfferHuntRepository, 'claimDue' | 'releaseClaim' | 'findById'>;
type RunPort = { execute(input: RunOfferHuntInput): Promise<RunOfferHuntOutput> };

export interface OfferHuntSchedulerJobOptions {
  lease: IJobLease;
  hunts: HuntsPort;
  /** Resolvido a cada caçada (montagem lazy do container). */
  run: () => RunPort;
  intervalMs?: number;
  leaseTtlMs?: number;
  claimTtlMs?: number;
  perTick?: number;
  stopTimeoutMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
}

const scheduleOf = (h: OfferHuntDefinition): HuntSchedule => ({
  intervalMinutes: h.intervalMinutes,
  startMinute: h.windowStartMinute,
  endMinute: h.windowEndMinute,
  weekdaysMask: h.weekdaysMask,
});

/** Nunca lança: agenda inválida cai no fallback de 1 h. */
function safeNext(compute: () => Date, now: Date): Date {
  try {
    return compute();
  } catch {
    return new Date(now.getTime() + FALLBACK_NEXT_MS);
  }
}

/**
 * Caçadas agendadas do Caçador de Ofertas (T11), só no `worker`/`all` e com `OFFER_HUNTER_JOB_ENABLED`.
 * Tique de 60 s (`unref`) sob o lease `offer-hunter-scheduler`; cada tique reivindica até 3 caçadas vencidas
 * (CAS em `claimToken`, 1 por tenant), roda uma a uma com atraso sorteado entre tenants e solta a posse com
 * o próximo horário:
 * - fora da janela/dia (agenda mudou ou job atrasou): não roda, só recalcula a próxima abertura (não gasta teto);
 * - teto do dia zerado (`OFFER_HUNT_DAILY_LIMIT`, `OFFER_HUNT_RUN_THROTTLED` ou saldo 0 após a execução):
 *   primeira abertura do dia seguinte;
 * - demais casos (inclusive exceção inesperada, logada sem segredo): `nextHuntRunAt`.
 * Agenda relida após a execução (edição no meio vale). `stop()` durante o tique: as caçadas ainda não
 * iniciadas são soltas sem mudar o horário. Nada operacional em memória além do timer. Nunca lança.
 */
export class OfferHuntSchedulerJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopping = false;
  private readonly ownerId = randomUUID();
  private readonly log = logger.child({ module: 'OfferHuntSchedulerJob' });
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly rand: () => number;

  constructor(private readonly options: OfferHuntSchedulerJobOptions) {
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms).unref()));
    this.rand = options.rand ?? Math.random;
  }

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => void this.runTick(), this.options.intervalMs ?? OFFER_HUNT_SCHEDULER_TICK_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.running) return;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
    });
    try {
      // Execução presa não segura o shutdown; a posse vence sozinha (`claimedUntil`)
      if (await Promise.race([this.running.then(() => false), timedOut])) {
        this.log.warn('offer hunt tick still running at stop; giving up waiting');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Exposto para teste; nunca lança. */
  runTick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.tickOnce()
      .catch((err) => this.log.error({ err: (err as Error)?.name }, 'offer hunt tick failed'))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async tickOnce(): Promise<void> {
    const { lease, hunts } = this.options;
    const now = this.now();
    const until = new Date(now.getTime() + (this.options.leaseTtlMs ?? OFFER_HUNT_SCHEDULER_LEASE_TTL_MS));
    let acquired = false;
    try {
      acquired = await lease.tryAcquire(OFFER_HUNT_SCHEDULER_LEASE, this.ownerId, until, now);
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'offer hunt scheduler lease failed');
    }
    if (!acquired) return;
    try {
      const claims = await hunts.claimDue(now, this.options.perTick ?? OFFER_HUNT_SCHEDULER_PER_TICK, this.options.claimTtlMs ?? OFFER_HUNT_CLAIM_TTL_MS);
      // Defesa do contrato (1 por tenant): repetida do mesmo tenant é solta sem mudar o horário
      const seen = new Set<string>();
      for (const [i, claim] of claims.entries()) {
        const { tenantId } = claim.hunt;
        if (this.stopping || seen.has(tenantId)) {
          await this.release(claim, claim.hunt.nextRunAt);
          continue;
        }
        seen.add(tenantId);
        if (i > 0) {
          const { min, max } = OFFER_HUNT_TENANT_DELAY_MS;
          await this.sleep(min + Math.floor(this.rand() * (max - min + 1)));
          if (this.stopping) {
            await this.release(claim, claim.hunt.nextRunAt);
            continue;
          }
        }
        await this.runClaim(claim);
      }
    } finally {
      await lease.release(OFFER_HUNT_SCHEDULER_LEASE, this.ownerId).catch(() => undefined);
    }
  }

  private async runClaim(claim: OfferHuntClaim): Promise<void> {
    const { hunt } = claim;
    const startedAt = this.now();
    const window = scheduleOf(hunt);
    if (!isWithinPostingWindow(startedAt, window)) {
      await this.release(claim, safeNext(() => resolveStartWithinPostingWindow(startedAt, window), startedAt));
      return;
    }
    let output: RunOfferHuntOutput | null = null;
    try {
      output = await this.options.run().execute({ tenantId: hunt.tenantId, huntId: hunt.id, trigger: 'SCHEDULED', now: startedAt });
    } catch (err) {
      const e = err as { name?: string; code?: unknown };
      this.log.error(
        { tenantId: hunt.tenantId, huntId: hunt.id, err: e?.name, code: typeof e?.code === 'string' ? e.code : undefined },
        'offer hunt scheduled run threw',
      );
    }
    const finishedAt = this.now();
    // Agenda relida: edição durante a execução vale; apagada = nada a soltar
    let fresh = hunt;
    try {
      const found = await this.options.hunts.findById(hunt.tenantId, hunt.id);
      if (!found) return;
      fresh = found;
    } catch {
      /* usa a agenda do claim */
    }
    const schedule = scheduleOf(fresh);
    const nextDay = output !== null && (
      (output.errorCode !== null && NEXT_DAY_CODES.has(output.errorCode)) ||
      (output.status === 'SUCCEEDED' && output.remainingToday <= 0)
    );
    const next = safeNext(
      () => (nextDay ? nextHuntRunNextDay(finishedAt, schedule) : nextHuntRunAt(finishedAt, schedule)),
      finishedAt,
    );
    await this.release(claim, next);
  }

  /** Solta a posse; falha só loga (a posse vence sozinha). */
  private async release(claim: OfferHuntClaim, nextRunAt: Date | null): Promise<void> {
    const { tenantId, id } = claim.hunt;
    try {
      const ok = await this.options.hunts.releaseClaim(tenantId, id, claim.claimToken, nextRunAt);
      if (!ok) this.log.warn({ tenantId, huntId: id }, 'offer hunt claim lost before release');
    } catch (err) {
      this.log.warn({ tenantId, huntId: id, err: (err as Error)?.name }, 'offer hunt claim release failed');
    }
  }
}

/** Montagem de produção (lazy: importar não toca banco). Ligar só com a flag (`offerHunterSchedulerStart`). */
export function createOfferHuntSchedulerJob(): OfferHuntSchedulerJob {
  return new OfferHuntSchedulerJob({
    lease: new PrismaJobLease(prisma),
    hunts: hunterContainer.hunts(),
    run: () => hunterContainer.runOfferHunt(),
  });
}
