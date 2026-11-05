import type { ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';
import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { ISessionSocketControl, SessionResumeResult } from '../../../messaging/domain/contracts/ISessionSocketControl';
import {
  LEASE_RENEW_INTERVAL_MS,
  LEASE_RENEW_TIMEOUT_MS,
  LEASE_TTL_MS,
  isLeaseFenceExpired,
} from '../../domain/services/sessionLeasePolicy';
import type { SessionLeaseLedger } from '../services/SessionLeaseLedger';
import { logger } from '../../../../shared/logger/logger';

const RENEW_TIMEOUT = Symbol('renew-timeout');

/** Rodadas seguidas com erro transitório ao reabrir uma suspensa antes de desistir (log error). */
export const MAX_RESUME_ATTEMPTS = 10;

export type RenewLeaseLogger = Pick<typeof logger, 'warn' | 'error'>;
/** Porta de status já existente: desistência grava `DISCONNECTED` sem tocar `connectRequestedAt`. */
export type ResumeGiveUpStatus = Pick<ISessionRepository, 'markDisconnectedIfNoLiveLease'>;

/**
 * Rodada de renovação do lease (LEASE-04, D4). Só renova sessões no razão local **e** com
 * socket local. Zero linhas para um id = lease perdido (outro dono) → `abortSession` já (sem
 * gravar status nem chaves). Erro/timeout = vale o fence (`isLeaseFenceExpired`): quem passou
 * de TTL − margem sem renovar é **suspenso** (`suspendSession`: fecha preservando as chaves
 * pendentes, ninguém provou outro dono) e marcado no razão.
 *
 * Retomada (única fonte da nova tentativa): `execute` só devolve as suspensas a reabrir quando a
 * renovação volta a funcionar; o keeper chama `resume` de cada uma fora do tick. O acquire fica
 * dentro de `resumeSession` (tipado no adapter): `resumed`/`gone` limpam a marca; `held` limpa e
 * `forgetSuspension`; erro/timeout conta tentativa (`markFenced(n+1)`) e, no `MAX_RESUME_ATTEMPTS`,
 * desiste: `forgetSuspension`, sai do razão, solta o lease e grava `DISCONNECTED` (log error).
 */
export class RenewSessionLeaseUseCase {
  constructor(
    private readonly repo: ISessionLeaseRepository,
    private readonly ledger: SessionLeaseLedger,
    private readonly sockets: ISessionSocketControl,
    private readonly status: ResumeGiveUpStatus,
    private readonly workerId: string,
    private readonly now: () => Date = () => new Date(),
    private readonly log: RenewLeaseLogger = logger.child({ module: 'RenewSessionLease' }),
    private readonly resumeTimeoutMs: number = LEASE_RENEW_INTERVAL_MS,
  ) {}

  /** Uma rodada; devolve as suspensas a reabrir (vazio se o banco não respondeu). */
  async execute(): Promise<string[]> {
    const local = new Set(this.sockets.listLocalSessionIds());
    const toResume: string[] = [];
    // Suspensa que já tem socket de novo (reconexão manual, retomada que terminou após o timeout):
    // sem lease no razão entra na sonda para provar que o lease ainda é nosso.
    const reclaim: string[] = [];
    for (const id of this.ledger.fencedIds()) {
      if (!local.has(id)) {
        toResume.push(id);
        continue;
      }
      this.ledger.clearFenced(id);
      if (!this.ledger.lastOk(id)) reclaim.push(id);
    }
    const candidates: string[] = [];
    for (const id of this.ledger.ids()) {
      if (local.has(id)) candidates.push(id);
      else this.ledger.drop(id);
    }

    // Fence antes do banco: quem já passou do limite não espera mais uma chamada.
    const ids = await this.suspendFenced(candidates);
    // As suspensas entram na chamada como sonda: renovar sem erro = banco de volta.
    const probe = [...ids, ...reclaim, ...toResume];
    if (probe.length === 0) return [];

    const startedAt = this.now();
    let renewed: string[];
    try {
      renewed = await this.renewWithTimeout(probe);
    } catch (err) {
      this.log.warn({ err, count: probe.length }, 'falha ao renovar lease de sessão');
      // Socket sem lease provado (reclaim) não tem `lastOk`: suspende já
      await this.suspendFenced([...ids, ...reclaim]);
      return [];
    }

    const ok = new Set(renewed);
    const lost: string[] = [];
    for (const id of [...ids, ...reclaim]) {
      if (ok.has(id)) this.ledger.markOk(id, startedAt);
      else lost.push(id);
    }
    if (lost.length > 0) {
      this.log.warn({ sessionIds: lost }, 'lease de sessão perdido; derrubando socket');
      await this.abortAll(lost);
    }
    return toResume;
  }

  /**
   * Reabre uma suspensa (o keeper chama fora do tick, uma por sessão por vez). Timeout de
   * `resumeTimeoutMs` conta a tentativa, mas só devolve quando a reabertura assenta, para a
   * mesma sessão nunca ter duas retomadas em paralelo.
   */
  async resume(id: string): Promise<void> {
    if (!this.ledger.isFenced(id)) return;
    const attempts = this.ledger.fenceAttempts(id);
    const op = this.sockets.resumeSession(id);
    let outcome: SessionResumeResult;
    try {
      outcome = await this.withResumeTimeout(op);
    } catch (err) {
      await this.resumeFailed(id, attempts, err);
      await op.catch(() => undefined);
      return;
    }
    this.ledger.clearFenced(id);
    if (outcome === 'held') {
      await this.forget(id);
      this.log.warn({ sessionId: id }, 'sessão suspensa por fence não reaberta (lease de outro processo)');
    } else if (outcome === 'gone') {
      this.log.warn({ sessionId: id }, 'sessão suspensa por fence não está mais suspensa; retomada descartada');
    }
  }

  private async resumeFailed(id: string, attempts: number, err: unknown): Promise<void> {
    const next = attempts + 1;
    if (next < MAX_RESUME_ATTEMPTS) {
      this.ledger.markFenced(id, next);
      this.log.warn({ err, sessionId: id, attempt: next }, 'falha transitória ao reabrir sessão suspensa; nova tentativa na próxima rodada');
      return;
    }
    const tenantId = await this.forget(id);
    this.ledger.clearFenced(id);
    this.ledger.drop(id);
    try {
      await this.repo.release(id, this.workerId);
      if (tenantId) await this.status.markDisconnectedIfNoLiveLease(id, tenantId);
    } catch (writeErr) {
      this.log.warn({ err: writeErr, sessionId: id }, 'falha ao gravar desistência da sessão suspensa');
    }
    this.log.error({ err, sessionId: id, attempts: next }, 'sessão suspensa por fence não reaberta após o limite de tentativas; marcada DISCONNECTED');
  }

  private async forget(id: string): Promise<string | null> {
    try {
      return await this.sockets.forgetSuspension(id);
    } catch (err) {
      this.log.warn({ err, sessionId: id }, 'falha ao esquecer suspensão da sessão');
      return null;
    }
  }

  private async withResumeTimeout(op: Promise<SessionResumeResult>): Promise<SessionResumeResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`retomada excedeu ${this.resumeTimeoutMs} ms`)), this.resumeTimeoutMs);
    });
    try {
      return await Promise.race([op, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Suspende os ids com fence vencido e devolve os que seguem válidos. */
  private async suspendFenced(ids: readonly string[]): Promise<string[]> {
    const now = this.now();
    const expired: string[] = [];
    const alive: string[] = [];
    for (const id of ids) {
      const last = this.ledger.lastOk(id);
      if (!last || isLeaseFenceExpired(last, now)) expired.push(id);
      else alive.push(id);
    }
    if (expired.length > 0) {
      this.log.warn({ sessionIds: expired }, 'fence de lease vencido sem renovar; suspendendo socket');
      await Promise.all(
        expired.map(async (id) => {
          this.ledger.markFenced(id);
          try {
            await this.sockets.suspendSession(id);
          } catch (err) {
            this.log.warn({ err, sessionId: id }, 'falha ao suspender socket sem lease');
          }
        }),
      );
    }
    return alive;
  }

  private async abortAll(ids: readonly string[]): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        this.ledger.drop(id);
        this.ledger.clearFenced(id);
        try {
          await this.sockets.abortSession(id);
        } catch (err) {
          this.log.warn({ err, sessionId: id }, 'falha ao derrubar socket sem lease');
        }
      }),
    );
  }

  private async renewWithTimeout(ids: readonly string[]): Promise<string[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof RENEW_TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(RENEW_TIMEOUT), LEASE_RENEW_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([this.repo.renew(ids, this.workerId, LEASE_TTL_MS), timeout]);
      if (result === RENEW_TIMEOUT) throw new Error(`renovação de lease excedeu ${LEASE_RENEW_TIMEOUT_MS} ms`);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
}
