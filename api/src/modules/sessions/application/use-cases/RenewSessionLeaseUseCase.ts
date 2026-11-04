import type { ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';
import type { ISessionSocketControl } from '../../../messaging/domain/contracts/ISessionSocketControl';
import {
  LEASE_RENEW_TIMEOUT_MS,
  LEASE_TTL_MS,
  isLeaseFenceExpired,
} from '../../domain/services/sessionLeasePolicy';
import type { SessionLeaseLedger } from '../services/SessionLeaseLedger';
import type { AcquireSessionLeaseUseCase } from './AcquireSessionLeaseUseCase';
import { logger } from '../../../../shared/logger/logger';

const RENEW_TIMEOUT = Symbol('renew-timeout');

/** Rodadas seguidas com erro transitório ao reabrir uma suspensa antes de desistir (log error). */
export const MAX_RESUME_ATTEMPTS = 10;

export type RenewLeaseLogger = Pick<typeof logger, 'warn' | 'error'>;
type LeaseAcquirer = Pick<AcquireSessionLeaseUseCase, 'acquireResult'>;

/**
 * Rodada de renovação do lease (LEASE-04, D4). Só renova sessões no razão local **e** com
 * socket local. Zero linhas para um id = lease perdido (outro dono) → `abortSession` já (sem
 * gravar status nem chaves). Erro/timeout = vale o fence (`isLeaseFenceExpired`): quem passou
 * de TTL − margem sem renovar é **suspenso** (`suspendSession`: fecha preservando as chaves
 * pendentes, ninguém provou outro dono) e marcado no razão. Quando uma renovação volta a
 * funcionar, cada suspensa: `acquireResult` (sem `release` antes: o lease já é nosso, soltar
 * abriria janela para outro processo) → `held` limpa a marca; `acquired` → `resumeSession`
 * (reconnect auto). Erro transitório (banco, versão do WhatsApp, auth state) mantém a marca para
 * a próxima rodada, até `MAX_RESUME_ATTEMPTS`; depois limpa e loga error.
 */
export class RenewSessionLeaseUseCase {
  constructor(
    private readonly repo: ISessionLeaseRepository,
    private readonly ledger: SessionLeaseLedger,
    private readonly sockets: ISessionSocketControl,
    private readonly acquirer: LeaseAcquirer,
    private readonly workerId: string,
    private readonly now: () => Date = () => new Date(),
    private readonly log: RenewLeaseLogger = logger.child({ module: 'RenewSessionLease' }),
  ) {}

  async execute(): Promise<void> {
    const local = new Set(this.sockets.listLocalSessionIds());
    // Suspensa que já tem socket de novo (reconexão manual) não precisa reabrir
    const toResume: string[] = [];
    for (const id of this.ledger.fencedIds()) {
      if (local.has(id)) this.ledger.clearFenced(id);
      else toResume.push(id);
    }
    const candidates: string[] = [];
    for (const id of this.ledger.ids()) {
      if (local.has(id)) candidates.push(id);
      else this.ledger.drop(id);
    }

    // Fence antes do banco: quem já passou do limite não espera mais uma chamada.
    const ids = await this.suspendFenced(candidates);
    // As suspensas entram na chamada como sonda: renovar sem erro = banco de volta.
    const probe = [...ids, ...toResume];
    if (probe.length === 0) return;

    const startedAt = this.now();
    let renewed: string[];
    try {
      renewed = await this.renewWithTimeout(probe);
    } catch (err) {
      this.log.warn({ err, count: probe.length }, 'falha ao renovar lease de sessão');
      await this.suspendFenced(ids);
      return;
    }

    const ok = new Set(renewed);
    const lost: string[] = [];
    for (const id of ids) {
      if (ok.has(id)) this.ledger.markOk(id, startedAt);
      else lost.push(id);
    }
    if (lost.length > 0) {
      this.log.warn({ sessionIds: lost }, 'lease de sessão perdido; derrubando socket');
      await this.abortAll(lost);
    }
    if (toResume.length > 0) await this.resumeAll(toResume);
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

  /** Banco de volta: reabre cada suspensa sem soltar o lease antes. */
  private async resumeAll(ids: readonly string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.resumeOne(id)));
  }

  private async resumeOne(id: string): Promise<void> {
    const attempts = this.ledger.fenceAttempts(id);
    const lease = await this.acquirer.acquireResult(id);
    if (lease === 'held') {
      this.ledger.clearFenced(id);
      this.log.warn({ sessionId: id }, 'sessão suspensa por fence não reaberta (lease de outro processo)');
      return;
    }
    let failure: unknown;
    if (lease === 'acquired') {
      try {
        const reopened = await this.sockets.resumeSession(id);
        this.ledger.clearFenced(id);
        if (!reopened) this.log.warn({ sessionId: id }, 'sessão suspensa por fence não reaberta');
        return;
      } catch (err) {
        failure = err;
      }
    }
    const next = attempts + 1;
    if (next >= MAX_RESUME_ATTEMPTS) {
      this.ledger.clearFenced(id);
      this.ledger.drop(id);
      this.log.error({ err: failure, sessionId: id, attempts: next }, 'sessão suspensa por fence não reaberta após o limite de tentativas');
      return;
    }
    this.ledger.markFenced(id, next);
    this.log.warn({ err: failure, sessionId: id, attempt: next }, 'falha transitória ao reabrir sessão suspensa; nova tentativa na próxima rodada');
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
